import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import readline from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'plugin', 'server', 'seosmith-operations-mcp.mjs');
const FIXTURE = join(HERE, 'fixtures', 'seosmith-adapter-fixture.mjs');
const UUID_A = 'b2a844c8-5bc9-49e5-bcf0-8fd1407d69f4';
const UUID_B = '4822f25e-af3c-4c60-a8c6-31bd99d2acda';
const NIL = '00000000-0000-0000-0000-000000000000';

const dirs = [];
function workspace() {
  const base = mkdtempSync(join(tmpdir(), 'seosmith-mcp-'));
  dirs.push(base);
  const root = join(base, 'root');
  const binDir = join(base, 'bin');
  const bin = join(binDir, 'adapter');
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(binDir, { mode: 0o700 });
  chmodSync(root, 0o700);
  chmodSync(binDir, 0o700);
  let source = readFileSync(FIXTURE, 'utf8');
  source = source.replace(/^#!.*\n/, `#!${process.execPath}\n`);
  writeFileSync(bin, source, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return { base, root, bin };
}

class Client {
  constructor(env) {
    this.proc = spawn(process.execPath, [SERVER], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stderr = '';
    this.proc.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
    });
    this.pending = new Map();
    this.nextId = 1;
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async init() {
    await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    this.notify('notifications/initialized');
  }

  async tools() {
    const result = await this.request('tools/list');
    return result.tools;
  }

  async call(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args });
    return result;
  }

  async close() {
    this.proc.stdin.end();
    await new Promise((resolve) => {
      this.proc.once('exit', resolve);
      this.proc.kill('SIGKILL');
    });
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function startArgs(overrides = {}) {
  return {
    request_id: UUID_A,
    website_id: UUID_B,
    url: 'https://example.com/',
    max_pages: 20,
    max_resources: 20,
    max_duration_seconds: 60,
    delay_ms: 1000,
    check_external_links: false,
    ...overrides,
  };
}

test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test('unavailable default is truthful and never a fake success', async () => {
  const client = new Client({ SEOSMITH_BIN: '', SEOSMITH_ROOT: '' });
  await client.init();
  try {
    const tools = await client.tools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ['seosmith_cancel', 'seosmith_capabilities', 'seosmith_export', 'seosmith_report', 'seosmith_start', 'seosmith_status'],
    );
    const caps = await client.call('seosmith_capabilities');
    assert.equal(caps.isError, false);
    assert.equal(caps.structuredContent.available, false);
    assert.equal(caps.structuredContent.reason, 'adapter_not_configured');
    assert.deepEqual(caps.structuredContent.operations, []);
    assert.equal(caps.structuredContent.delivery, 'disabled');
    assert.equal(caps.structuredContent.htp.available, false);
    assert.equal(caps.structuredContent.htp.reason, 'separate_host_connection');
    assert.equal(caps.structuredContent.worker.available, false);
    const start = await client.call('seosmith_start', startArgs());
    assert.equal(start.isError, true);
    assert.equal(start.structuredContent.error, 'unavailable');
    const status = await client.call('seosmith_status', { request_id: UUID_A });
    assert.equal(status.isError, true);
    assert.equal(status.structuredContent.error, 'unavailable');
  } finally {
    await client.close();
  }
});

test('configured binding pairs local capability with separate HTP and worker modes', async () => {
  const { root, bin } = workspace();
  const client = new Client({ SEOSMITH_BIN: bin, SEOSMITH_ROOT: root });
  await client.init();
  try {
    const caps = (await client.call('seosmith_capabilities')).structuredContent;
    assert.equal(caps.available, true);
    assert.equal(caps.reason, null);
    assert.equal(caps.adapter_version, 1);
    assert.equal(caps.transport, 'local_cli');
    assert.deepEqual(caps.operations, [
      'seosmith.start',
      'seosmith.status',
      'seosmith.cancel',
      'seosmith.report',
      'seosmith.export',
    ]);
    assert.equal(caps.advanced.evidence_v2, false);
    assert.equal(caps.htp.available, false);
    assert.equal(caps.worker.available, false);
  } finally {
    await client.close();
  }
});

test('bounded lifecycle returns synthetic saved data and a verified receipt', async () => {
  const { root, bin } = workspace();
  const client = new Client({ SEOSMITH_BIN: bin, SEOSMITH_ROOT: root });
  await client.init();
  try {
    const start = await client.call('seosmith_start', startArgs());
    assert.equal(start.isError, false);
    assert.equal(start.structuredContent.state, 'partial');
    assert.equal(start.structuredContent.request_id, UUID_A);
    assert.equal(start.structuredContent.audit_directory, join(root, UUID_A));

    const status = await client.call('seosmith_status', { request_id: UUID_A });
    assert.equal(status.structuredContent.state, 'partial');
    assert.equal(status.structuredContent.execution_state, 'terminal');

    const cancel = await client.call('seosmith_cancel', { request_id: UUID_A });
    assert.equal(cancel.structuredContent.cancel_accepted, false);
    assert.equal(cancel.structuredContent.cancellation_terminal, false);

    const report = await client.call('seosmith_report', { request_id: UUID_A });
    assert.equal(report.isError, false);
    assert.equal(report.structuredContent.bytes, Buffer.byteLength(report.structuredContent.report));
    assert.equal(report.structuredContent.sha256, sha256(Buffer.from(report.structuredContent.report, 'utf8')));
    assert.equal(JSON.parse(report.structuredContent.report).synthetic, true);

    const exported = await client.call('seosmith_export', { request_id: UUID_A });
    assert.equal(exported.isError, false);
    assert.equal(exported.structuredContent.verified, true);
    assert.equal(exported.structuredContent.sha256, report.structuredContent.sha256);
    const onDisk = readFileSync(exported.structuredContent.output_path);
    assert.equal(sha256(onDisk), exported.structuredContent.sha256);
    assert.equal(onDisk.toString('utf8'), report.structuredContent.report);

    // A retry must reuse the identity rather than create a second audit.
    const retry = await client.call('seosmith_start', startArgs());
    assert.equal(retry.isError, false);
    assert.equal(retry.structuredContent.request_id, UUID_A);

    // A changed payload under the same identity is a conflict.
    const conflict = await client.call('seosmith_start', startArgs({ url: 'https://other.example/' }));
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error, 'request_id_conflict');
  } finally {
    await client.close();
  }
});

test('start rejects invalid bound types and ranges before invoking the adapter', async () => {
  const { root, bin } = workspace();
  const client = new Client({ SEOSMITH_BIN: bin, SEOSMITH_ROOT: root });
  await client.init();
  const statePath = join(root, UUID_A, 'run.sqlite.fixture-state.json');
  const requestPath = join(root, UUID_A, 'request.json');
  try {
    const badBounds = [
      { max_pages: 'x' },
      { max_pages: 0 },
      { max_pages: 20001 },
      { max_pages: 1.5 },
      { max_resources: -1 },
      { max_resources: 20001 },
      { max_resources: 1e12 },
      { max_duration_seconds: 'x' },
      { max_duration_seconds: 9 },
      { max_duration_seconds: 7201 },
      { max_duration_seconds: 1e12 },
      { delay_ms: 999 },
      { delay_ms: 60001 },
      { delay_ms: 1.5 },
      { check_external_links: 'false' },
      { check_external_links: 0 },
    ];
    for (const overrides of badBounds) {
      const result = await client.call('seosmith_start', startArgs(overrides));
      assert.equal(result.isError, true, JSON.stringify(overrides));
      assert.equal(result.structuredContent.error, 'invalid_bound', JSON.stringify(overrides));
      assert.equal(existsSync(requestPath), false, JSON.stringify(overrides));
      assert.equal(existsSync(statePath), false, JSON.stringify(overrides));
    }
    const badUrls = [
      'not-a-url',
      'ftp://example.com/',
      'https://user:pass@example.com/',
      'https://example.com:8443/',
      'https://example.com/?q=1',
      'https://example.com/#fragment',
    ];
    for (const url of badUrls) {
      const result = await client.call('seosmith_start', startArgs({ url }));
      assert.equal(result.isError, true, url);
      assert.equal(result.structuredContent.error, 'invalid_url', url);
      assert.equal(existsSync(requestPath), false, url);
      assert.equal(existsSync(statePath), false, url);
    }
    assert.equal(existsSync(join(root, UUID_A)), false, 'no audit directory for rejected requests');
  } finally {
    await client.close();
  }
});

test('changed-payload retry preserves the original request file', async () => {
  const { root, bin } = workspace();
  const client = new Client({ SEOSMITH_BIN: bin, SEOSMITH_ROOT: root });
  await client.init();
  const requestPath = join(root, UUID_A, 'request.json');
  try {
    const first = await client.call('seosmith_start', startArgs());
    assert.equal(first.isError, false);
    const original = readFileSync(requestPath);

    const conflict = await client.call('seosmith_start', startArgs({ url: 'https://other.example/' }));
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error, 'request_id_conflict');
    assert.deepEqual(readFileSync(requestPath), original, 'conflict must not rewrite the retained request');

    const identical = await client.call('seosmith_start', startArgs());
    assert.equal(identical.isError, false);
    assert.deepEqual(readFileSync(requestPath), original, 'identical retry must not rewrite the retained request');
  } finally {
    await client.close();
  }
});

test('missing capability gates the operation instead of falling back', async () => {
  const { root, bin } = workspace();
  writeFileSync(`${bin}.no-export`, '');
  const client = new Client({ SEOSMITH_BIN: bin, SEOSMITH_ROOT: root });
  await client.init();
  try {
    const caps = (await client.call('seosmith_capabilities')).structuredContent;
    assert.equal(caps.available, true);
    assert.ok(!caps.operations.includes('seosmith.export'));
    const exportResult = await client.call('seosmith_export', { request_id: UUID_A });
    assert.equal(exportResult.isError, true);
    assert.equal(exportResult.structuredContent.error, 'unsupported_capability');
    const start = await client.call('seosmith_start', startArgs());
    assert.equal(start.isError, false);
  } finally {
    await client.close();
  }
});

test('identity and private-root safety fail closed', async () => {
  const { root, bin } = workspace();
  const client = new Client({ SEOSMITH_BIN: bin, SEOSMITH_ROOT: root });
  await client.init();
  try {
    const nil = await client.call('seosmith_status', { request_id: NIL });
    assert.equal(nil.isError, true);
    assert.equal(nil.structuredContent.error, 'invalid_identity');
    const malformed = await client.call('seosmith_start', startArgs({ request_id: 'not-a-uuid' }));
    assert.equal(malformed.isError, true);
    assert.equal(malformed.structuredContent.error, 'invalid_identity');
  } finally {
    await client.close();
  }

  chmodSync(root, 0o755);
  const exposed = new Client({ SEOSMITH_BIN: bin, SEOSMITH_ROOT: root });
  await exposed.init();
  try {
    const caps = (await exposed.call('seosmith_capabilities')).structuredContent;
    assert.equal(caps.available, false);
    assert.equal(caps.reason, 'root_not_private');
  } finally {
    await exposed.close();
  }

  const missing = new Client({ SEOSMITH_BIN: join(root, 'absent-adapter'), SEOSMITH_ROOT: root });
  await missing.init();
  try {
    const caps = (await missing.call('seosmith_capabilities')).structuredContent;
    assert.equal(caps.available, false);
    assert.equal(caps.reason, 'missing_binary');
  } finally {
    await missing.close();
  }
});
