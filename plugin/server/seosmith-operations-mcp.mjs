#!/usr/bin/env node
// Typed local SEOsmith operations binding for Codex.
//
// This is a stdio MCP server that exposes the standalone local SEOsmith
// operations adapter (adapter_version 1, transport "local_cli") as typed
// tools. It is intentionally narrow:
//
//   * The trusted executable and private root come only from the operator
//     environment (SEOSMITH_BIN, SEOSMITH_ROOT). Nothing is hardcoded and no
//     working-directory lookup happens.
//   * Subprocesses run as argv arrays with shell execution disabled and a
//     minimal environment; credentials are neither read nor forwarded.
//   * Every lifecycle call re-discovers capabilities and refuses a missing or
//     incompatible adapter instead of substituting legacy commands.
//   * HTP orchestration and the private worker HTTP API are separate modes and
//     are reported as unavailable by this binding, never silently emulated.
//
// Logs go to stderr; stdout is reserved for MCP protocol messages.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const BINDING_NAME = 'seosmith_local';
const BINDING_VERSION = '0.2.0';
const ADAPTER_OPERATIONS = [
  'seosmith.start',
  'seosmith.status',
  'seosmith.cancel',
  'seosmith.report',
  'seosmith.export',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const OUTPUT_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const REQUEST_LIMIT = 16 * 1024;
const REPORT_LIMIT = 16 * 1024 * 1024;
// Documented adapter-v1 accepted ranges. These are enforced by the binding
// before the adapter is invoked so a bad bound can never reach a live crawl.
const START_BOUNDS = {
  max_pages: [1, 20000],
  max_resources: [0, 20000],
  max_duration_seconds: [10, 7200],
  delay_ms: [1000, 60000],
};
const START_TIMEOUT_GRACE_SEC = 30;
const PROTOCOL_DEFAULT = '2025-06-18';
const SUBPROCESS_ENV = {
  PATH: '/usr/bin:/bin',
  HOME: process.env.HOME ?? '',
};

function log(message) {
  process.stderr.write(`[seosmith-local] ${message}\n`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value) && value.toLowerCase() !== NIL_UUID;
}

// ---------------------------------------------------------------------------
// Adapter discovery
// ---------------------------------------------------------------------------

function resolveBinary() {
  const raw = process.env.SEOSMITH_BIN;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'adapter_not_configured' };
  }
  if (!path.isAbsolute(raw)) {
    return { ok: false, reason: 'binary_not_absolute' };
  }
  let real;
  try {
    real = realpathSync(raw);
    const stat = lstatSync(real);
    if (!stat.isFile()) {
      return { ok: false, reason: 'binary_not_regular' };
    }
  } catch {
    return { ok: false, reason: 'missing_binary' };
  }
  try {
    // Any execute bit for the current user is required; this is not a
    // signature check, and the operator remains responsible for trust.
    const mode = lstatSync(real).mode;
    if ((mode & 0o111) === 0) {
      return { ok: false, reason: 'binary_not_executable' };
    }
  } catch {
    return { ok: false, reason: 'missing_binary' };
  }
  return { ok: true, binary: real };
}

function resolveRoot() {
  const raw = process.env.SEOSMITH_ROOT;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'root_not_configured' };
  }
  if (!path.isAbsolute(raw)) {
    return { ok: false, reason: 'root_not_absolute' };
  }
  let real;
  try {
    real = realpathSync(raw);
    const stat = lstatSync(real);
    if (!stat.isDirectory()) {
      return { ok: false, reason: 'root_not_directory' };
    }
    if ((stat.mode & 0o077) !== 0) {
      return { ok: false, reason: 'root_not_private' };
    }
  } catch {
    return { ok: false, reason: 'root_missing' };
  }
  return { ok: true, root: real };
}

function runCommand(binary, args, timeoutMs, maxBytes) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      shell: false,
      env: SUBPROCESS_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    let overflow = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: null, timedOut: true, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    }, timeoutMs);
    const collect = (chunks, current) => (chunk) => {
      const next = current + chunk.length;
      if (next > maxBytes) {
        overflow = true;
        child.kill('SIGKILL');
        return next;
      }
      chunks.push(chunk);
      return next;
    };
    child.stdout.on('data', (chunk) => {
      outBytes = collect(out, outBytes)(chunk);
    });
    child.stderr.on('data', (chunk) => {
      errBytes = collect(err, errBytes)(chunk);
    });
    child.on('error', () => finish({ code: null, spawnError: true, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }));
    child.on('close', (code) =>
      finish({
        code,
        overflow,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err),
      }),
    );
  });
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

async function discoverAdapter() {
  const bin = resolveBinary();
  if (!bin.ok) return { ok: false, reason: bin.reason };
  const root = resolveRoot();
  if (!root.ok) return { ok: false, reason: root.reason };
  const run = await runCommand(bin.binary, ['operations', 'capabilities'], 5000, 64 * 1024);
  if (run.spawnError) return { ok: false, reason: 'missing_binary' };
  if (run.timedOut) return { ok: false, reason: 'adapter_timeout' };
  if (run.overflow || run.code !== 0) return { ok: false, reason: 'adapter_error' };
  const capabilities = parseJson(run.stdout);
  if (capabilities === null) return { ok: false, reason: 'invalid_response' };
  if (capabilities.adapter_version !== 1) return { ok: false, reason: 'incompatible_adapter' };
  if (capabilities.transport !== 'local_cli') return { ok: false, reason: 'incompatible_transport' };
  if (!Array.isArray(capabilities.operations)) return { ok: false, reason: 'invalid_response' };
  return { ok: true, binary: bin.binary, root: root.root, capabilities };
}

function capabilityReport(state) {
  const caps = state.ok ? state.capabilities : null;
  return {
    binding: BINDING_NAME,
    binding_version: BINDING_VERSION,
    mode: 'local_cli',
    available: state.ok,
    reason: state.ok ? null : state.reason,
    adapter_version: caps ? caps.adapter_version : null,
    engine_version: caps ? caps.engine_version ?? null : null,
    report_schema_version: caps ? caps.report_schema_version ?? null : null,
    ruleset_version: caps ? caps.ruleset_version ?? null : null,
    transport: caps ? caps.transport : null,
    operations: caps ? caps.operations : [],
    limits: caps ? caps.limits ?? null : null,
    advanced: caps ? caps.advanced ?? null : null,
    delivery: caps ? caps.delivery ?? 'disabled' : 'disabled',
    authentication: caps ? caps.authentication ?? 'local_os_account' : 'local_os_account',
    // Paired capability semantics: this binding provides the standalone local
    // CLI only. HTP orchestration and the private worker HTTP transport are
    // separate operator surfaces and are never claimed active here.
    htp: {
      mode: 'htp_orchestration',
      available: false,
      reason: 'separate_host_connection',
      note: 'Configure and authorize the HTP MCP connection separately; this local binding grants no HTP access.',
    },
    worker: {
      mode: 'private_worker_http',
      available: false,
      reason: 'not_provided_by_this_binding',
      note: 'The private worker HTTP API is a separate operator-only mode, not this local CLI adapter.',
    },
  };
}

function unavailableReasonFor(state) {
  return state.ok ? null : state.reason;
}

// ---------------------------------------------------------------------------
// Tool result helpers
// ---------------------------------------------------------------------------

function okResult(value, text) {
  return {
    content: [{ type: 'text', text: text ?? JSON.stringify(value) }],
    structuredContent: value,
    isError: false,
  };
}

function errorResult(reason, detail) {
  const value = { error: reason };
  if (detail !== undefined) value.detail = detail;
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Per-operation handlers
// ---------------------------------------------------------------------------

function requireUuid(value) {
  return isUuid(value) ? null : 'invalid_identity';
}

function isValidSeedUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.hostname.length > 0 &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.port === '' &&
    parsed.search === '' &&
    parsed.hash === ''
  );
}

// Writes a request body without ever replacing an existing request file.
// Returns 'written' | 'unchanged' | 'conflict' | 'unsafe'.
function persistRequestFile(file, serialized) {
  let existing = null;
  try {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return 'unsafe';
    const fd = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      existing = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') return 'unsafe';
  }
  if (existing !== null) {
    return existing.equals(serialized) ? 'unchanged' : 'conflict';
  }
  try {
    const fd = openSync(
      file,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, serialized);
    } finally {
      closeSync(fd);
    }
    return 'written';
  } catch (e) {
    if (e.code !== 'EEXIST') return 'unsafe';
    // Lost a creation race; compare against the file that won.
    try {
      const fd = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        existing = readFileSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch {
      return 'unsafe';
    }
    return existing.equals(serialized) ? 'unchanged' : 'conflict';
  }
}

function auditPaths(root, requestId) {
  const dir = path.join(root, requestId);
  return {
    dir,
    database: path.join(dir, 'run.sqlite'),
    request: path.join(dir, 'request.json'),
  };
}

function ensureAuditDir(dir) {
  try {
    lstatSync(dir);
  } catch {
    mkdirSync(dir, { mode: 0o700, recursive: false });
  }
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe_audit_directory');
  if ((stat.mode & 0o077) !== 0) throw new Error('audit_directory_not_private');
  return dir;
}

async function adapterFailure(run) {
  const parsed = parseJson(run.stderr);
  if (parsed && typeof parsed === 'object' && parsed.error) {
    return errorResult(parsed.error, parsed.message ?? undefined);
  }
  if (run.timedOut) return errorResult('adapter_timeout');
  if (run.overflow) return errorResult('output_limit');
  if (run.spawnError) return errorResult('adapter_spawn_failed');
  const text = run.stderr.toString('utf8').trim().slice(0, 1024);
  return errorResult('adapter_error', text || undefined);
}

async function runLifecycle(state, requestId, operation, extraArgs, timeoutMs, maxBytes) {
  const paths = auditPaths(state.root, requestId);
  const args = ['--database', paths.database, 'operations', operation, '--id', requestId, ...extraArgs];
  const run = await runCommand(state.binary, args, timeoutMs, maxBytes);
  if (run.code !== 0) return { failure: await adapterFailure(run) };
  const parsed = parseJson(run.stdout);
  if (parsed === null) return { failure: errorResult('invalid_response') };
  return { value: parsed, raw: run.stdout };
}

async function handleCapabilities() {
  const state = await discoverAdapter();
  return okResult(capabilityReport(state));
}

async function handleStart(args) {
  const state = await discoverAdapter();
  if (!state.ok) return errorResult('unavailable', unavailableReasonFor(state));
  if (!state.capabilities.operations.includes('seosmith.start')) {
    return errorResult('unsupported_capability', 'seosmith.start');
  }
  if (requireUuid(args.request_id) || requireUuid(args.website_id)) {
    return errorResult('invalid_identity');
  }
  const bindingGeneration = args.binding_generation ?? 1;
  if (!Number.isInteger(bindingGeneration) || bindingGeneration < 1) {
    return errorResult('invalid_binding_generation');
  }
  for (const [field, [min, max]] of Object.entries(START_BOUNDS)) {
    const value = args[field];
    if (value === undefined || value === null) return errorResult('explicit_bounds_required', field);
    if (!Number.isInteger(value) || value < min || value > max) {
      return errorResult('invalid_bound', field);
    }
  }
  if (args.check_external_links === undefined || args.check_external_links === null) {
    return errorResult('explicit_bounds_required', 'check_external_links');
  }
  if (typeof args.check_external_links !== 'boolean') {
    return errorResult('invalid_bound', 'check_external_links');
  }
  if (typeof args.url !== 'string' || args.url.length === 0) {
    return errorResult('explicit_bounds_required', 'url');
  }
  if (!isValidSeedUrl(args.url)) {
    return errorResult('invalid_url');
  }
  const request = {
    request_id: args.request_id,
    website_id: args.website_id,
    binding_generation: bindingGeneration,
    url: args.url,
    max_pages: args.max_pages,
    max_resources: args.max_resources,
    max_duration_seconds: args.max_duration_seconds,
    delay_ms: args.delay_ms,
    check_external_links: args.check_external_links,
  };
  const serialized = Buffer.from(JSON.stringify(request), 'utf8');
  if (serialized.length > REQUEST_LIMIT) return errorResult('request_too_large');
  const paths = auditPaths(state.root, args.request_id);
  try {
    ensureAuditDir(paths.dir);
  } catch (e) {
    return errorResult('storage_error', String(e.message || e));
  }
  const persisted = persistRequestFile(paths.request, serialized);
  if (persisted === 'conflict') return errorResult('request_id_conflict');
  if (persisted !== 'written' && persisted !== 'unchanged') {
    return errorResult('storage_error', 'request_write_failed');
  }
  const timeoutMs = (args.max_duration_seconds + START_TIMEOUT_GRACE_SEC) * 1000;
  const run = await runCommand(
    state.binary,
    ['--database', paths.database, 'operations', 'start', '--request', paths.request],
    timeoutMs,
    REPORT_LIMIT + 1024,
  );
  if (run.code !== 0) return adapterFailure(run);
  const parsed = parseJson(run.stdout);
  if (parsed === null) return errorResult('invalid_response');
  return okResult({
    ...parsed,
    binding: BINDING_NAME,
    audit_directory: paths.dir,
  });
}

async function handleStatus(args) {
  const state = await discoverAdapter();
  if (!state.ok) return errorResult('unavailable', unavailableReasonFor(state));
  if (!state.capabilities.operations.includes('seosmith.status')) {
    return errorResult('unsupported_capability', 'seosmith.status');
  }
  const bad = requireUuid(args.request_id);
  if (bad) return errorResult(bad);
  const result = await runLifecycle(state, args.request_id, 'status', [], 30000, 64 * 1024);
  if (result.failure) return result.failure;
  return okResult(result.value);
}

async function handleCancel(args) {
  const state = await discoverAdapter();
  if (!state.ok) return errorResult('unavailable', unavailableReasonFor(state));
  if (!state.capabilities.operations.includes('seosmith.cancel')) {
    return errorResult('unsupported_capability', 'seosmith.cancel');
  }
  const bad = requireUuid(args.request_id);
  if (bad) return errorResult(bad);
  const result = await runLifecycle(state, args.request_id, 'cancel', [], 30000, 64 * 1024);
  if (result.failure) return result.failure;
  return okResult(result.value);
}

async function handleReport(args) {
  const state = await discoverAdapter();
  if (!state.ok) return errorResult('unavailable', unavailableReasonFor(state));
  if (!state.capabilities.operations.includes('seosmith.report')) {
    return errorResult('unsupported_capability', 'seosmith.report');
  }
  const bad = requireUuid(args.request_id);
  if (bad) return errorResult(bad);
  const result = await runLifecycle(state, args.request_id, 'report', [], 30000, REPORT_LIMIT + 1024);
  if (result.failure) return result.failure;
  const bytes = result.raw.length;
  return okResult({
    request_id: args.request_id,
    bytes,
    sha256: sha256(result.raw),
    report: result.raw.toString('utf8'),
    delivery_state: 'disabled',
  });
}

async function handleExport(args) {
  const state = await discoverAdapter();
  if (!state.ok) return errorResult('unavailable', unavailableReasonFor(state));
  if (!state.capabilities.operations.includes('seosmith.export')) {
    return errorResult('unsupported_capability', 'seosmith.export');
  }
  const bad = requireUuid(args.request_id);
  if (bad) return errorResult(bad);
  const outputName = args.output_name ?? 'export.json';
  if (typeof outputName !== 'string' || !OUTPUT_NAME_RE.test(outputName)) {
    return errorResult('invalid_output_name');
  }
  const paths = auditPaths(state.root, args.request_id);
  const outputPath = path.join(paths.dir, outputName);
  if (path.dirname(outputPath) !== paths.dir) return errorResult('invalid_output_name');
  const result = await runLifecycle(state, args.request_id, 'export', ['--output', outputPath], 30000, 64 * 1024);
  if (result.failure) return result.failure;
  const receipt = result.value;
  let data;
  try {
    // Bound the read to the adapter report limit and reject symlinks.
    const stat = lstatSync(outputPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return errorResult('export_not_regular');
    if (stat.size > REPORT_LIMIT) return errorResult('report_too_large');
    const fd = openSync(outputPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      data = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    return errorResult('export_unavailable');
  }
  const digest = sha256(data);
  if (
    receipt.request_id !== args.request_id ||
    receipt.bytes !== data.length ||
    receipt.sha256 !== digest
  ) {
    return errorResult('receipt_mismatch');
  }
  return okResult({
    request_id: args.request_id,
    bytes: data.length,
    sha256: digest,
    output_path: outputPath,
    receipt,
    verified: true,
  });
}

// ---------------------------------------------------------------------------
// Tool catalog
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'seosmith_capabilities',
    description:
      'Discover the configured standalone local SEOsmith adapter. Reports the exact adapter version, transport, operation IDs, limits, advanced gates and delivery state, and truthfully reports unavailable when no trusted operator-executable/private-root is configured or the adapter is incompatible. Also reports that HTP orchestration and the private worker HTTP API are separate, unavailable modes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'seosmith_start',
    description:
      'Start exactly one explicit bounded standalone local SEOsmith audit using a fresh non-nil request UUID and local website UUID. Requires every execution bound explicitly and validates its integer type, documented range, external-link boolean and HTTP(S) seed shape before the adapter is invoked. Derives the private per-audit database from the request UUID. Start is synchronous; an identical retry returns the existing status, while a changed payload preserves the stored request and is rejected as a conflict. Grants no HTP access.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'Fresh non-nil audit UUID; also names the private per-audit directory.' },
        website_id: { type: 'string', description: 'Non-nil local website UUID; local metadata only, no HTP authorization.' },
        binding_generation: { type: 'integer', minimum: 1, default: 1 },
        url: { type: 'string' },
        max_pages: { type: 'integer', minimum: 1, maximum: 20000 },
        max_resources: { type: 'integer', minimum: 0, maximum: 20000 },
        max_duration_seconds: { type: 'integer', minimum: 10, maximum: 7200 },
        delay_ms: { type: 'integer', minimum: 1000, maximum: 60000 },
        check_external_links: { type: 'boolean' },
      },
      required: [
        'request_id',
        'website_id',
        'url',
        'max_pages',
        'max_resources',
        'max_duration_seconds',
        'delay_ms',
        'check_external_links',
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'seosmith_status',
    description:
      'Read the status of one standalone local audit by request UUID. Status does not resume work, and worker_active is advisory. execution_state=unknown means an ownerless queued/running record.',
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string' } },
      required: ['request_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'seosmith_cancel',
    description:
      'Request cancellation of one standalone local audit. Accepted cancellation is not terminal; require cancellation_terminal before claiming the worker stopped.',
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string' } },
      required: ['request_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'seosmith_report',
    description:
      'Return the retained original UTF-8 report bytes for one standalone local audit, with byte count and SHA-256. Missing or partial reports are not clean audits. Delivery is disabled locally and is independent of crawl success.',
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string' } },
      required: ['request_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'seosmith_export',
    description:
      'Export the retained original report bytes for one standalone local audit to a new file inside the private per-audit directory, then verify the adapter receipt byte count and SHA-256 against the written file. A partial file is never reported as success.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string' },
        output_name: { type: 'string', description: 'Optional safe basename inside the per-audit directory; defaults to export.json.' },
      },
      required: ['request_id'],
      additionalProperties: false,
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'seosmith_capabilities':
      return handleCapabilities();
    case 'seosmith_start':
      return handleStart(args);
    case 'seosmith_status':
      return handleStatus(args);
    case 'seosmith_cancel':
      return handleCancel(args);
    case 'seosmith_report':
      return handleReport(args);
    case 'seosmith_export':
      return handleExport(args);
    default:
      return errorResult('unknown_tool', name);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC / MCP transport (newline-delimited stdio)
// ---------------------------------------------------------------------------

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function dispatch(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    const requested = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_DEFAULT;
    reply(id, {
      protocolVersion: requested || PROTOCOL_DEFAULT,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: BINDING_NAME, version: BINDING_VERSION },
    });
    return;
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return;
  }
  if (method === 'ping') {
    reply(id, {});
    return;
  }
  if (method === 'tools/list') {
    reply(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      const result = await callTool(name, args);
      reply(id, result);
    } catch (e) {
      log(`tool ${name} failed: ${e && e.message ? e.message : e}`);
      reply(id, errorResult('internal_error', String((e && e.message) || e)));
    }
    return;
  }
  if (id !== undefined && id !== null) {
    replyError(id, -32601, 'Method not found');
  }
}

let buffer = '';
const MAX_LINE = 1024 * 1024;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line.length === 0) continue;
    if (line.length > MAX_LINE) {
      log('dropping oversized message');
      continue;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    dispatch(message).catch((e) => log(`dispatch error: ${e && e.message ? e.message : e}`));
  }
  if (buffer.length > MAX_LINE) {
    buffer = '';
    log('dropping oversized partial message');
  }
});
process.stdin.on('end', () => process.exit(0));
