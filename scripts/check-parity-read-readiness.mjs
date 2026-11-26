// Finite offline Codex readiness evidence for the canonical additive parity read
// profile 1.4.0 (website_audit_lifecycle, website_url_lifecycle,
// website_remediation_list, plus the audit-read availability amendment).
// Verifies the vendored 1.4 tree against its lock, the 1.3 skill pin it relies on,
// semantic conformance, and that the shipped Codex skill carries the capability gates.
// Gated: no host auth, no backend call, no rollout flag is assumed on.
//
// Absent tool => `unsupported`, never an empty page. A discovered tool whose rollout
// flag is off answers `unavailable` (503), which is not an empty history or work queue.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const tree = join(root, 'contract/parity-reads-1.4');
const lock = JSON.parse(readFileSync(join(root, 'contract/parity-reads-1.4.lock.json'), 'utf8'));
assert.equal(lock.contractVersion, '1.4.0');
assert.equal(lock.canonicalCommit, '09a0ba56c175e3e889bfa5a8eacff01666851e39');
assert.equal(lock.canonicalTree, '97ca939759757c7007f2babbccc4da51e4ee6b53');
assert.deepEqual(lock.sourcePRs, [151]);
assert.equal(lock.revisionStatus, 'merged');
assert.match(lock.canonicalRevision, /09a0ba56c175e3e889bfa5a8eacff01666851e39/);
assert.match(lock.sharedSkillSource, /audit-reads-1\.3\.lock\.json/);
assert.deepEqual(lock.activationGates, [
  'exact-head contract review and canonical merge',
  'API deployment with the lifecycle and remediation rollout flags and the database grants enabled independently',
  'three host source/readiness companions at exact canonical merge; runtime support separately verified',
  'fresh tools/list and input-schema discovery on the deployed host',
]);

const expected = [
  'docs/plugin-contract/v1.4/README.md',
  'docs/plugin-contract/v1.4/audit-read-availability.json',
  'docs/plugin-contract/v1.4/conformance.json',
  'docs/plugin-contract/v1.4/parity-reads.json',
  'scripts/audit-read-availability.mjs',
  'scripts/check-parity-read-contract.mjs',
  'scripts/parity-read-contract.mjs',
  'scripts/plugin-contract.mjs',
].sort();
assert.deepEqual(Object.keys(lock.files).sort(), expected, 'lock inventory drift');
const inventory = (dir, base = tree) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isSymbolicLink()) throw new Error(`symlink in vendored tree: ${path}`);
  if (entry.isDirectory()) return inventory(path, base);
  return [path.slice(base.length + 1)];
});
assert.deepEqual(inventory(tree).sort(), expected, 'vendored tree inventory drift');
const hash = (base, path) => createHash('sha256').update(readFileSync(join(base, path))).digest('hex');
for (const path of expected) assert.equal(hash(tree, path), lock.files[path], 'contract drift: ' + path);

// The shared skills stay pinned by the 1.3 lock: profile 1.4 adds no shared skill text.
// Shipped Codex copies live under plugin/skills/ and must equal the 1.3 pinned bytes.
const lock13 = JSON.parse(readFileSync(join(root, 'contract/audit-reads-1.3.lock.json'), 'utf8'));
const sharedSkills = Object.keys(lock13.files).filter((p) => p.startsWith('plugins/htp/skills/'));
assert.equal(sharedSkills.length, 4);
for (const path of sharedSkills) {
  assert.equal(hash(root, path.replace(/^plugins\/htp\/skills\//, 'plugin/skills/')), lock13.files[path], 'shared skill drift against the 1.3 pin: ' + path);
}
const hostSkills = ['seosmith-operations', 'lifecycle-remediation'];
const shippedInventory = inventory(join(root, 'plugin/skills'), join(root, 'plugin/skills')).filter((p) => !hostSkills.some((h) => p.startsWith(h + '/'))).sort();
assert.deepEqual(shippedInventory, sharedSkills.map((p) => p.replace(/^plugins\/htp\/skills\//, '')).sort(), 'shipped shared skill inventory drift');

const {
  parityReadProfile, parityReadFixtures, validateParityReadResults, syntheticParityReadResults,
} = await import('../contract/parity-reads-1.4/scripts/parity-read-contract.mjs');
const {
  auditAvailabilityProfile, validateAuditAvailability, emptyHistoryMeansNone, syntheticAuditAvailabilityResults,
} = await import('../contract/parity-reads-1.4/scripts/audit-read-availability.mjs');

assert.equal(parityReadProfile.contractVersion, '1.4.0');
assert.deepEqual(parityReadProfile.extends, ['1.0.0', '1.1.0', '1.2.0', '1.3.0']);
assert.equal(parityReadProfile.availability.heldCode, 'unavailable');
assert.equal(parityReadProfile.availability.heldStatus, 503);
assert.match(parityReadProfile.availability.meaning, /not an empty history/i);
assert.match(parityReadProfile.discovery, /unsupported/i);
assert.match(parityReadProfile.discovery, /never substitute/i);
const bindings = ['website_audit_lifecycle', 'website_url_lifecycle', 'website_remediation_list'];
assert.deepEqual(parityReadProfile.operations.map((op) => op.binding).sort(), bindings.slice().sort());
for (const op of parityReadProfile.operations) {
  assert.equal(op.effect, 'read');
  assert.equal(op.authorization, 'htp-owner-oauth');
  assert.equal(op.collection, false, `${op.id} must not collect`);
  assert.equal(op.idempotency, true);
  assert.equal(op.destructive, false);
}
assert.equal(parityReadFixtures.contractVersion, '1.4.0');
assert.equal(parityReadFixtures.evidenceKind, 'synthetic');
assert.equal(parityReadFixtures.scenarios.length, 23);
for (const op of parityReadProfile.operations) {
  for (const suffix of ['owner.page', 'owner.trailing_page', 'held', 'anonymous', 'non_owner', 'missing_capability', 'unpaired_cursor']) {
    assert.ok(parityReadFixtures.scenarios.some((s) => s.id === `${op.id}.${suffix}`), `missing scenario ${op.id}.${suffix}`);
  }
  assert.deepEqual(parityReadFixtures.scenarios.find((s) => s.id === `${op.id}.missing_capability`).expected.result, { code: 'unsupported' });
  assert.deepEqual(parityReadFixtures.scenarios.find((s) => s.id === `${op.id}.held`).expected.result, { code: 'unavailable' });
}
validateParityReadResults(parityReadFixtures, syntheticParityReadResults('codex'));

// Availability amendment: six event codes, two episode codes, only producer_active is non-held.
const { events, episodes } = syntheticAuditAvailabilityResults();
assert.equal(events.length, 6);
assert.equal(episodes.length, 2);
for (const r of events) validateAuditAvailability('htp.website_audit_events', r);
for (const r of episodes) validateAuditAvailability('htp.website_operational_episodes', r);
assert.deepEqual([...events, ...episodes].filter(emptyHistoryMeansNone).map((r) => r.availability), ['producer_active', 'producer_active']);
assert.equal(auditAvailabilityProfile.availability.heldValue, 'producer_unavailable');

// The shipped Codex skill must name every 1.4 tool, every availability code and the gate language.
const skill = readFileSync(join(root, 'plugin/skills/lifecycle-remediation/SKILL.md'), 'utf8');
for (const name of bindings) assert.ok(skill.includes('`' + name + '`'), `Codex skill must name ${name}`);
for (const code of [...auditAvailabilityProfile.availability.codes['htp.website_audit_events'], ...parityReadProfile.errors]) {
  assert.ok(skill.includes('`' + code + '`'), `Codex skill must name ${code}`);
}
for (const phrase of [/not listed.*`unsupported`/s, /Never substitute/i, /\*\*not\*\* an empty history/, /\*\*not\*\* an empty work queue/, /`before` and `before_id`|both\*\* `before` and `before_id`/, /Only `producer_active`/, /read-only|reads stored data only/i]) {
  assert.match(skill, phrase, 'Codex skill gate language: ' + phrase);
}
assert.doesNotMatch(skill, /\b(always|will)\b[^.\n]*\benabled\b/i, 'Codex skill must not claim availability');

let mode = 'synthetic';
const args = process.argv.slice(2);
if (args.length) {
  assert.equal(args.length, 2, 'usage: node scripts/check-parity-read-readiness.mjs [--parity-read-results path]');
  assert.equal(args[0], '--parity-read-results');
  assert.ok(statSync(args[1]).size <= 1024 * 1024, 'evidence file must be at most 1 MiB');
  const evidence = JSON.parse(readFileSync(args[1], 'utf8'));
  assert.equal(evidence.contractVersion, '1.4.0');
  assert.equal(evidence.host, 'codex');
  validateParityReadResults(parityReadFixtures, evidence);
  mode = 'measured';
}
console.log(mode === 'synthetic'
  ? 'Synthetic offline parity read semantics passed. Absent tool is unsupported; unavailable (503) is explicit and never an empty page; only producer_active reads an empty page as none. This is vendored-source readiness, not host or backend evidence.'
  : 'Measured Codex parity read traces passed the canonical semantic validator. Provenance, live auth, discovery and rollout flags remain independent acceptance obligations.');
console.log(`Codex parity read profile ${lock.contractVersion}: ${expected.length} canonical artifacts, ${parityReadFixtures.scenarios.length} synthetic scenarios. Rollout flags and deployed tool discovery remain gated; no host auth, backend or live run.`);
