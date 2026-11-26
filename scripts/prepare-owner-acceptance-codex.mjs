#!/usr/bin/env node
// PREPARES (does not perform) the owner-attended Codex installed-agent SEOsmith acceptance (plan 6.2).
// It installs the release ref into a fresh, isolated CODEX_HOME so the owner can run the interactive
// session without touching ~/.codex. It starts no agent turn, makes no HTP call, never signs in, does not
// change approval, sandbox or auth settings, and deletes nothing (--root must not exist).
//
// usage: node scripts/prepare-owner-acceptance-codex.mjs --root <new dir> --ref <tag|sha> \
//          [--source https://github.com/hatchertechnology/htp-codex.git] [--rewrite-to <bare repo>]
// --rewrite-to is for local rehearsal of this script only: the disposable HOME's .gitconfig maps --source to a local mirror.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const rootArg = opt('--root'); const ref = opt('--ref');
const source = opt('--source', 'https://github.com/hatchertechnology/htp-codex.git');
const rewrite = opt('--rewrite-to');
assert.ok(rootArg && ref, 'usage: --root <new dir> --ref <tag|sha> [--source url] [--rewrite-to bare-repo]');
assert.match(ref, /^[A-Za-z0-9._\/-]+$/, 'ref must be a plain tag, branch or sha');
const root = resolve(rootArg);
const home = process.env.HOME || '/nonexistent';
assert.ok(!existsSync(root), '--root must not exist; this script deletes nothing');
assert.ok(!(root === resolve(home, '.codex') || root.startsWith(resolve(home, '.codex') + '/')), 'root must not be inside ~/.codex');
assert.ok(!root.startsWith('/tmp/') && !root.startsWith('/var/tmp/'), 'root must not be under a temporary directory (Codex refuses helper aliases there)');
for (const sub of ['codex-home', 'home', 'work']) mkdirSync(join(root, sub), { recursive: true });
mkdirSync(join(root, 'seosmith-root'), { recursive: true, mode: 0o700 });
chmodSync(join(root, 'seosmith-root'), 0o700);
chmodSync(join(root, 'codex-home'), 0o700);
// OAuth credentials for the isolated profile must be file-backed so the OS keyring cannot share the owner's entry.
writeFileSync(join(root, 'codex-home', 'config.toml'), 'mcp_oauth_credentials_store = "file"\n', { mode: 0o600 });
if (rewrite) writeFileSync(join(root, 'home', '.gitconfig'), `[url "file://${resolve(rewrite)}"]\n\tinsteadOf = ${source}\n`);
const env = {
  PATH: process.env.PATH, HOME: join(root, 'home'), CODEX_HOME: join(root, 'codex-home'),
  GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1',
};
const codex = (...a) => spawnSync('codex', a, { cwd: join(root, 'work'), env, encoding: 'utf8', timeout: 180000 });
const must = (...a) => { const r = codex(...a); assert.equal(r.status, 0, `codex ${a.join(' ')}: ${(r.stderr || r.stdout).trim().replace(/\s+/g, ' ').slice(-400)}`); return r.stdout; };

must('plugin', 'marketplace', 'add', source, '--ref', ref);
const added = JSON.parse(must('plugin', 'add', 'htp@htp-codex', '--json').replace(/^[^{]*/, ''));
const manifest = JSON.parse(readFileSync(join(added.installedPath, '.codex-plugin/plugin.json'), 'utf8'));
assert.equal(manifest.version, added.version);
const minimum = JSON.parse(readFileSync(new URL('../host-minimum.json', import.meta.url), 'utf8'))['codex-cli'];
const hostVersion = spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout.trim();
console.log(`installed htp@htp-codex ${added.version} at ${added.installedPath} into the isolated profile ${root}`);

const template = {
  release: { ref, installedVersion: added.version, installedPath: added.installedPath },
  hostVersion, declaredMinimum: minimum,
  checks: {
    discoverySkillsFive: null, discoveryMcpToolsSix: null, capabilitiesUnconfigured: null, capabilitiesConfigured: null,
    ownerApprovedStart: null, status: null, cancelConfirmedTerminal: null, report: null, export: null,
    reportBytesAndSha256Match: null, exportBytesAndSha256Match: null, transcriptSaved: null,
  },
  notes: 'Record only: pass/fail, sanitized codes, byte counts and SHA-256 receipts. No tokens, cookies or customer data. Approval policy was not changed.',
};
writeFileSync(join(root, 'results.template.json'), JSON.stringify(template, null, 2) + '\n');
console.log(`
Owner steps (separate shell; the profile is isolated from ~/.codex and its remote "htp" 1.1.0 plugin):

  export HOME=${join(root, 'home')} CODEX_HOME=${join(root, 'codex-home')}
  export SEOSMITH_BIN=/absolute/path/to/trusted/seosmith SEOSMITH_ROOT=${join(root, 'seosmith-root')}
  cd ${join(root, 'work')} && codex

Do NOT change approvals, sandbox or auth. Approve each tool call yourself. Follow docs/owner-acceptance-codex.md and fill
${join(root, 'results.template.json')}. Afterwards save the transcript, then remove the profile yourself (this script deletes nothing).
`);
