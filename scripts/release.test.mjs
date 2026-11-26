import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const text = (p) => readFileSync(new URL(p, root), 'utf8');
const json = (p) => JSON.parse(text(p));
const manifest = json('plugin/.codex-plugin/plugin.json');
const semver = (v) => v.split('.').map(Number);
const cmp = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

test('release version is 0.3.0 and the binding reports the same version', () => {
  assert.equal(manifest.version, '0.3.0');
  assert.match(text('plugin/server/seosmith-operations-mcp.mjs'), new RegExp(`const BINDING_VERSION = '${manifest.version.replaceAll('.', '\\.')}';`));
});

test('declared host minimum is explicit, honest and consistent in the docs', () => {
  const min = json('host-minimum.json');
  assert.match(min['codex-cli'], /^\d+\.\d+\.\d+$/);
  assert.equal(min.enforcedByHost, false, 'Codex has no enforced manifest minimum field; do not claim host enforcement');
  assert.ok(cmp(min['codex-cli'], '0.171.0') >= 0);
  for (const doc of ['docs/codex-compatibility.md', 'docs/wave1-package.md', 'README.md']) {
    assert.ok(text(doc).includes(min['codex-cli']), `${doc} must state the declared minimum`);
  }
  assert.doesNotMatch(text('docs/codex-compatibility.md'), /This is an observed version, not a minimum supported version/);
  for (const field of ['engines', 'minCodexVersion', 'minimumVersion']) {
    assert.equal(manifest[field], undefined, `${field} is not a Codex manifest field; the host would ignore it`);
  }
});

test('shipped skills: shared pinned set plus two Codex-specific skills', () => {
  const dirs = readdirSync(new URL('plugin/skills/', root)).sort();
  assert.deepEqual(dirs, ['lifecycle-remediation', 'repository-settings', 'seo-review', 'seosmith-operations', 'website-management']);
  const skill = text('plugin/skills/lifecycle-remediation/SKILL.md');
  assert.match(skill, /^---\nname: lifecycle-remediation\n/);
  for (const tool of ['website_audit_lifecycle', 'website_url_lifecycle', 'website_remediation_list']) assert.ok(skill.includes('`' + tool + '`'), tool);
  assert.match(skill, /not listed.*`unsupported`/s);
  assert.doesNotMatch(skill, /\/mcp\b/, 'Codex reconnects with codex mcp login, not /mcp');
});

test('export and report-request references stay gated in the shared skill', () => {
  const skill = text('plugin/skills/website-management/SKILL.md');
  for (const tool of ['website_audit_export_start_v1', 'website_audit_export_chunk_v1', 'website_audit_export_close_v1', 'get_website_report_request', 'cancel_website_report_request']) {
    assert.ok(skill.includes(tool), tool);
  }
  const baseline = skill.slice(0, skill.indexOf('website_audit_events'));
  for (const tool of ['website_audit_lifecycle', 'website_url_lifecycle', 'website_remediation_list']) assert.ok(!baseline.includes(tool), `${tool} must not be a baseline tool`);
});

test('smoke scripts expect five skills and enforce the declared minimum', () => {
  for (const f of ['scripts/host-mcp-smoke.py', 'scripts/host-discovery-smoke.py']) {
    const src = text(f);
    assert.ok(src.includes('htp:lifecycle-remediation'), f);
    assert.ok(src.includes('host-minimum.json'), f + ' must enforce the declared minimum');
  }
});
