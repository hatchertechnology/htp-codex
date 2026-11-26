#!/usr/bin/env node
// Behavioral upgrade/rollback rehearsal for the Codex package in DISPOSABLE homes.
//
// For each baseline (baseline-pre-r5-aee2b776 and v0.2.0) it installs the baseline through the real
// `codex plugin` CLI from a LOCAL bare mirror (an https URL rewritten to the mirror through the
// disposable HOME's .gitconfig), upgrades to the target, rolls back by exact SHA and by tag, rolls
// forward by tag, and at every stop compares installed bytes with the git tree and speaks MCP stdio to
// the installed server. Tags exist only in the throwaway mirror. It never touches the owner's ~/.codex,
// contacts no remote, logs in to nothing, starts no agent turn, and deletes nothing: --root must not
// exist yet and is created under a non-temporary directory (Codex refuses helper aliases under /tmp).
//
// usage: node scripts/rehearse-release-codex.mjs --root <new dir> --target <sha> [--log file]
//          [--anchor aee2b776c839c9569599513a9695f68e03e765c5] [--v020 9f35b9f60714f6e3ddf21bd27595d0b7c461af2e]
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const rootArg = opt('--root');
const target = opt('--target');
const ANCHOR = opt('--anchor', 'aee2b776c839c9569599513a9695f68e03e765c5');
const V020 = opt('--v020', '9f35b9f60714f6e3ddf21bd27595d0b7c461af2e');
const logFile = opt('--log');
assert.ok(rootArg && target, 'usage: --root <new dir> --target <sha> [--anchor sha] [--v020 sha] [--log file]');
const root = resolve(rootArg);
assert.ok(!existsSync(root), '--root must not exist; this script deletes nothing');
const home = process.env.HOME || '/nonexistent';
assert.ok(!(root === resolve(home, '.codex') || root.startsWith(resolve(home, '.codex') + '/')), 'root must not be inside ~/.codex');
assert.ok(!root.startsWith('/tmp/') && !root.startsWith('/var/tmp/'), 'root must not be under a temporary directory (Codex refuses helper aliases there)');
mkdirSync(root, { recursive: true });

const results = [];
const out = (line) => { console.log(line); if (logFile) appendFileSync(logFile, line + '\n'); };
function step(name, fn) {
  try { const detail = fn(); results.push([name, true]); out(`PASS ${name}${detail ? ' :: ' + detail : ''}`); }
  catch (err) { results.push([name, false]); out(`FAIL ${name} :: ${String(err.message).split('\n')[0]}`); }
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
const full = (sha) => git(repo, 'rev-parse', '--verify', sha + '^{commit}');
const fullTarget = full(target);
const fullAnchor = full(ANCHOR);
const fullV020 = full(V020);
const manifestAt = (sha) => JSON.parse(git(repo, 'show', `${sha}:plugin/.codex-plugin/plugin.json`));
const version = (sha) => manifestAt(sha).version;

const MIRROR_URL = 'https://mirror.invalid/htp-codex.git';
const mirror = join(root, 'mirror', 'htp-codex.git');
mkdirSync(join(root, 'mirror'), { recursive: true });
git(root, 'clone', '--bare', '--quiet', repo, mirror);
for (const sha of [fullTarget, fullAnchor, fullV020]) git(mirror, 'cat-file', '-e', sha + '^{commit}');
const setMain = (sha) => git(mirror, 'update-ref', 'refs/heads/main', sha);
git(mirror, 'symbolic-ref', 'HEAD', 'refs/heads/main');
// Throwaway tags in the MIRROR only. The real repository gets no tags here.
git(mirror, 'update-ref', 'refs/tags/baseline-pre-r5-aee2b776', fullAnchor);
git(mirror, 'update-ref', 'refs/tags/v0.2.0', fullV020);
git(mirror, 'update-ref', 'refs/tags/v0.3.0', fullTarget);

const codexBin = spawnSync('which', ['codex'], { encoding: 'utf8' }).stdout.trim();
assert.ok(codexBin, 'codex CLI not found');
const hostVersion = execFileSync(codexBin, ['--version'], { encoding: 'utf8' }).trim();
const declaredMin = JSON.parse(readFileSync(join(repo, 'host-minimum.json'), 'utf8'))['codex-cli'];
const semverCmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const hv = hostVersion.split(/\s+/).pop();
assert.ok(semverCmp(hv, declaredMin) >= 0, `host ${hv} below declared minimum ${declaredMin}`);
out(`# host: ${hostVersion} (declared minimum ${declaredMin}); mirror ${MIRROR_URL} -> ${mirror}`);
out(`# target ${fullTarget} (${version(fullTarget)}); anchor ${fullAnchor} (${version(fullAnchor)}); v0.2.0 ${fullV020} (${version(fullV020)})`);

let profileN = 0;
function profile() {
  const dir = join(root, `profile-${++profileN}`);
  for (const sub of ['codex-home', 'home', 'work']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, 'home', '.gitconfig'), `[url "file://${mirror}"]\n\tinsteadOf = ${MIRROR_URL}\n`);
  // Unrelated sentinel that every transition must preserve.
  writeFileSync(join(dir, 'codex-home', 'sentinel-unrelated.txt'), 'preserve me\n');
  const env = {
    PATH: process.env.PATH, HOME: join(dir, 'home'), CODEX_HOME: join(dir, 'codex-home'),
    GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_SSH_COMMAND: 'false', NO_COLOR: '1',
  };
  const codex = (...args) => spawnSync(codexBin, args, { cwd: join(dir, 'work'), env, encoding: 'utf8', timeout: 180000 });
  const must = (...args) => { const r = codex(...args); assert.equal(r.status, 0, `codex ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim().replace(/\s+/g, ' ').slice(-600)}`); return r.stdout; };
  const json = (...args) => { const text = must(...args, '--json'); return JSON.parse(text.slice(text.indexOf('{'))); };
  const installed = () => {
    const list = json('plugin', 'list').installed.filter((e) => e.pluginId === 'htp@htp-codex');
    assert.equal(list.length, 1, 'exactly one installed htp@htp-codex');
    return list[0];
  };
  return { dir, env, codex, must, json, installed };
}
const filesUnder = (d, base = d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = join(d, e.name);
  return e.isDirectory() ? filesUnder(p, base) : [p.slice(base.length + 1)];
}).sort();
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
function treeHashes(commit) {
  const files = git(repo, 'ls-tree', '-r', '--name-only', commit, '--', 'plugin').split('\n').filter(Boolean);
  return new Map(files.map((f) => [f.replace(/^plugin\//, ''), createHash('sha256').update(execFileSync('git', ['show', `${commit}:${f}`], { cwd: repo, maxBuffer: 64 << 20 })).digest('hex')]));
}
// Every installed byte must equal the plugin/ tree at the exact commit.
function assertInstalledEqualsTree(p, commit, installedPath) {
  const want = treeHashes(commit);
  const have = filesUnder(installedPath);
  assert.deepEqual(have, [...want.keys()].sort(), 'installed file inventory differs from the commit tree');
  for (const [f, h] of want) assert.equal(sha(join(installedPath, f)), h, 'installed bytes differ: ' + f);
  return `${want.size} files byte-equal to ${commit.slice(0, 12)}`;
}
// Behavioral: speak MCP stdio to the installed server; capabilities must be truthfully unavailable by default.
function probeServer(p, installedPath, commit) {
  const server = join(installedPath, 'server/seosmith-operations-mcp.mjs');
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'rehearsal', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'seosmith_capabilities', arguments: {} } },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const env = { PATH: process.env.PATH, HOME: p.env.HOME };
  const r = spawnSync(process.execPath, [server], { input, env, cwd: installedPath, encoding: 'utf8', timeout: 20000 });
  const msgs = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = (id) => msgs.find((m) => m.id === id);
  assert.equal(byId(1).result.serverInfo.name, 'seosmith_local');
  assert.equal(byId(1).result.serverInfo.version, version(commit) === '0.3.0' ? '0.3.0' : '0.2.0');
  assert.equal(byId(2).result.tools.length, 6);
  const caps = JSON.parse(byId(3).result.content[0].text);
  assert.equal(caps.available, false);
  assert.equal(caps.reason, 'adapter_not_configured');
  return `serverInfo ${byId(1).result.serverInfo.version}, 6 tools, default capabilities unavailable (${caps.reason})`;
}
function assertState(p, commit, label) {
  const rec = p.installed();
  assert.equal(rec.version, version(commit), `plugin list version ${rec.version} != manifest ${version(commit)}`);
  assert.equal(rec.enabled, true);
  const installedPath = join(p.env.CODEX_HOME, 'plugins/cache/htp-codex/htp', version(commit));
  assert.ok(existsSync(installedPath), `installed path missing for ${label}: ${installedPath}`);
  const detail = assertInstalledEqualsTree(p, commit, installedPath);
  const probe = probeServer(p, installedPath, commit);
  assert.equal(readFileSync(join(p.env.CODEX_HOME, 'sentinel-unrelated.txt'), 'utf8'), 'preserve me\n', 'unrelated sentinel changed');
  return `${rec.version}; ${detail}; ${probe}`;
}

function lifecycle(label, baselineSha, baselineTag) {
  const p = profile();
  step(`${label}: install baseline ${baselineTag} (${baselineSha.slice(0, 12)}) from the mirror`, () => {
    setMain(baselineSha);
    p.must('plugin', 'marketplace', 'add', MIRROR_URL, '--ref', 'main');
    const added = JSON.parse(p.must('plugin', 'add', 'htp@htp-codex', '--json').replace(/^[^{]*/, ''));
    assert.equal(added.version, version(baselineSha));
    return assertState(p, baselineSha, 'baseline');
  });
  step(`${label}: refresh on an unchanged mirror is a no-op`, () => {
    p.must('plugin', 'marketplace', 'upgrade', 'htp-codex');
    p.must('plugin', 'add', 'htp@htp-codex');
    return assertState(p, baselineSha, 'no-op');
  });
  step(`${label}: upgrade to ${fullTarget.slice(0, 12)} (${version(fullTarget)})`, () => {
    setMain(fullTarget);
    p.must('plugin', 'marketplace', 'upgrade', 'htp-codex');
    p.must('plugin', 'add', 'htp@htp-codex');
    const d = assertState(p, fullTarget, 'upgrade');
    const installedPath = join(p.env.CODEX_HOME, 'plugins/cache/htp-codex/htp', version(fullTarget));
    assert.ok(existsSync(join(installedPath, 'skills/lifecycle-remediation/SKILL.md')), 'lifecycle-remediation skill installed');
    return d;
  });
  step(`${label}: rollback by exact SHA (plugin remove, marketplace remove, re-add --ref ${baselineSha.slice(0, 12)})`, () => {
    p.must('plugin', 'remove', 'htp@htp-codex');
    p.must('plugin', 'marketplace', 'remove', 'htp-codex');
    p.must('plugin', 'marketplace', 'add', MIRROR_URL, '--ref', baselineSha);
    p.must('plugin', 'add', 'htp@htp-codex');
    return assertState(p, baselineSha, 'rollback sha');
  });
  step(`${label}: roll forward by tag v0.3.0`, () => {
    p.must('plugin', 'remove', 'htp@htp-codex');
    p.must('plugin', 'marketplace', 'remove', 'htp-codex');
    p.must('plugin', 'marketplace', 'add', MIRROR_URL, '--ref', 'v0.3.0');
    p.must('plugin', 'add', 'htp@htp-codex');
    return assertState(p, fullTarget, 'forward tag');
  });
  step(`${label}: rollback by tag ${baselineTag}`, () => {
    p.must('plugin', 'remove', 'htp@htp-codex');
    p.must('plugin', 'marketplace', 'remove', 'htp-codex');
    p.must('plugin', 'marketplace', 'add', MIRROR_URL, '--ref', baselineTag);
    p.must('plugin', 'add', 'htp@htp-codex');
    return assertState(p, baselineSha, 'rollback tag');
  });
  step(`${label}: uninstall leaves the unrelated sentinel and no htp install`, () => {
    p.must('plugin', 'remove', 'htp@htp-codex');
    assert.equal(p.json('plugin', 'list').installed.filter((e) => e.pluginId === 'htp@htp-codex').length, 0);
    assert.equal(readFileSync(join(p.env.CODEX_HOME, 'sentinel-unrelated.txt'), 'utf8'), 'preserve me\n');
    return 'removed; sentinel intact';
  });
}

lifecycle('anchor->0.3.0', fullAnchor, 'baseline-pre-r5-aee2b776');
lifecycle('v0.2.0->0.3.0', fullV020, 'v0.2.0');

const failed = results.filter(([, ok]) => !ok);
out(`# ${results.length - failed.length}/${results.length} steps passed; root ${root}`);
process.exit(failed.length ? 1 : 0);
