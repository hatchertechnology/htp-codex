import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, cpSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticParityReadResults } from '../contract/parity-reads-1.4/scripts/parity-read-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tmpRoot = mkdtempSync(join(tmpdir(), 'codex-parity-read-'));

function run(results, mutate) {
  const dir = mkdtempSync(join(tmpRoot, 'case-'));
  let cwd = root;
  if (mutate) {
    cwd = join(dir, 'repo');
    for (const p of ['scripts', 'contract', 'plugin', '.agents']) cpSync(join(root, p), join(cwd, p), { recursive: true });
    mutate(cwd);
  }
  const args = [join(cwd, 'scripts/check-parity-read-readiness.mjs')];
  if (results) {
    const file = join(dir, 'results.json');
    writeFileSync(file, JSON.stringify(results));
    args.push('--parity-read-results', file);
  }
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 20000 });
}
const obs = (r, id) => r.observations.find((o) => o.id === id);

test('synthetic CLI checks all 23 scenarios with an explicit label', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Synthetic offline parity read semantics passed/);
  assert.match(r.stdout, /23 synthetic scenarios/);
});

test('measured Codex traces pass and are labelled measured', () => {
  const r = run(syntheticParityReadResults('codex'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Measured Codex parity read traces/);
});

for (const [name, mutate] of [
  ['wrong host', (r) => { r.host = 'pi'; }],
  ['held read erased into an empty page', (r) => {
    obs(r, 'htp.website_audit_lifecycle.held').result = { version: 1, entity_id: 'x', rule: 'missing_title', items: [], has_more: false, next_cursor: null };
  }],
  ['held remediation read erased into an empty work queue', (r) => {
    obs(r, 'htp.website_remediation_list.held').result = { version: 1, delivery_id: '00000000-0000-4000-8000-000000000193', finding_index: 0, items: [], has_more: false, next_cursor: null };
  }],
  ['missing tool substituted as empty success', (r) => {
    obs(r, 'htp.website_url_lifecycle.missing_capability').result = { version: 1, entity_id: 'x', items: [], has_more: false, next_cursor: null };
  }],
  ['non-owner read allowed', (r) => {
    obs(r, 'htp.website_remediation_list.non_owner').result = { code: 'unavailable' };
  }],
  ['unpaired cursor accepted', (r) => {
    obs(r, 'htp.website_audit_lifecycle.unpaired_cursor').result = { version: 1, entity_id: 'x', rule: 'r', items: [], has_more: false, next_cursor: null };
  }],
  ['out-of-range limit accepted', (r) => {
    obs(r, 'htp.website_url_lifecycle.limit_out_of_range').result = { version: 1, entity_id: 'x', items: [], has_more: false, next_cursor: null };
  }],
  ['write effect recorded', (r) => { obs(r, 'htp.website_audit_lifecycle.owner.page').effects.writes = 1; }],
  ['collection registered', (r) => { obs(r, 'htp.website_url_lifecycle.owner.page').effects.collectionRegistered = true; }],
  ['surplus field', (r) => { obs(r, 'htp.website_audit_lifecycle.owner.page').result.extra = 1; }],
  ['dropped scenario', (r) => r.observations.pop()],
]) {
  test('CLI rejects ' + name, () => {
    const results = syntheticParityReadResults('codex');
    mutate(results);
    assert.notEqual(run(results).status, 0);
  });
}

const tree = 'contract/parity-reads-1.4/';
const lockPath = (d) => join(d, 'contract/parity-reads-1.4.lock.json');
for (const [name, mutate] of [
  ['validator drift', (d) => appendFileSync(join(d, tree + 'scripts/parity-read-contract.mjs'), '\n')],
  ['availability validator drift', (d) => appendFileSync(join(d, tree + 'scripts/audit-read-availability.mjs'), '\n')],
  ['conformance drift', (d) => appendFileSync(join(d, tree + 'docs/plugin-contract/v1.4/conformance.json'), '\n')],
  ['extra vendored file', (d) => writeFileSync(join(d, tree + 'scripts/extra.mjs'), 'x')],
  ['shared skill drift against the 1.3 pin', (d) => appendFileSync(join(d, 'plugin/skills/website-management/SKILL.md'), '\ndrift\n')],
  ['lock commit drift', (d) => { const l = JSON.parse(readFileSync(lockPath(d), 'utf8')); l.canonicalCommit = '0'.repeat(40); writeFileSync(lockPath(d), JSON.stringify(l)); }],
  ['gate removal', (d) => { const l = JSON.parse(readFileSync(lockPath(d), 'utf8')); l.activationGates = []; writeFileSync(lockPath(d), JSON.stringify(l)); }],
  ['host skill missing a tool', (d) => {
    const p = join(d, 'plugin/skills/lifecycle-remediation/SKILL.md');
    writeFileSync(p, readFileSync(p, 'utf8').replaceAll('website_remediation_list', 'website_remediation_x'));
  }],
  ['host skill missing the held-is-not-empty gate', (d) => {
    const p = join(d, 'plugin/skills/lifecycle-remediation/SKILL.md');
    writeFileSync(p, readFileSync(p, 'utf8').replaceAll('**not** an empty history', 'an empty history'));
  }],
  ['host skill missing an availability code', (d) => {
    const p = join(d, 'plugin/skills/lifecycle-remediation/SKILL.md');
    writeFileSync(p, readFileSync(p, 'utf8').replaceAll('producer_degraded', 'producer_other'));
  }],
]) {
  test('readiness rejects ' + name, () => assert.notEqual(run(null, mutate).status, 0));
}

test('temporary evidence directory cleanup', () => {
  rmSync(tmpRoot, { recursive: true, force: true });
});
