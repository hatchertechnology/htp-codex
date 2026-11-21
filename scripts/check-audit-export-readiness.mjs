// Finite offline readiness evidence; no installed skills or host adapter.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const tree = join(root, 'contract/audit-export-1.2');
const lock = JSON.parse(readFileSync(join(root, 'contract/audit-export-1.2.lock.json'), 'utf8'));
assert.equal(lock.contractVersion, '1.2.0');
assert.equal(lock.canonicalCommit, '6c065c8327970b0773ba90f163f99a6e56e1e204');
assert.equal(lock.sourcePR, 48);
assert.equal(lock.backendPR, 50);
assert.equal(lock.backendCommit, 'ea8179af3d438f5cc88cf96260b06a23b88cfd18');
assert.deepEqual(lock.activationGates, ["htp#34", "host-package-wave1", "deployed-export-schema-discovery", "host-oauth-live-acceptance", "host-export-live-acceptance", "seosmith-host-adapter-live-acceptance"]);
const expected = [
  "docs/plugin-contract/v1.2/README.md",
  "docs/plugin-contract/v1.2/audit-exports.json",
  "docs/plugin-contract/v1.2/conformance.json",
  "docs/plugin-contract/v1.2/skills.lock.json",
  "plugins/htp/skills/repository-settings/SKILL.md",
  "plugins/htp/skills/seo-review/SKILL.md",
  "plugins/htp/skills/seo-review/references/data.md",
  "plugins/htp/skills/website-management/SKILL.md",
  "scripts/audit-export-contract.mjs",
  "scripts/audit-export-fixtures.mjs",
  "scripts/check-audit-export-contract.mjs",
  "scripts/plugin-contract.mjs"
];
assert.deepEqual(Object.keys(lock.files).sort(), expected, "lock file inventory drift");
function inventory(dir, prefix = '') {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name), relative = prefix + name;
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), 'vendored symlink rejected');
    if (stat.isDirectory()) return inventory(path, relative + '/');
    assert.ok(stat.isFile(), 'regular vendored file required');
    return [relative];
  });
}
assert.deepEqual(inventory(tree).sort(), expected, 'vendored file inventory drift');
const hash = path => createHash('sha256').update(readFileSync(join(tree, path))).digest('hex');
for (const path of expected) assert.equal(hash(path), lock.files[path], 'contract drift: ' + path);

const { exportProfile, exportFixtures, validateExportResults } = await import('../contract/audit-export-1.2/scripts/audit-export-contract.mjs');
const { syntheticExportResults } = await import('../contract/audit-export-1.2/scripts/audit-export-fixtures.mjs');
const skills = JSON.parse(readFileSync(join(tree, 'docs/plugin-contract/v1.2/skills.lock.json')));
assert.equal(skills.contractVersion, lock.contractVersion);
assert.deepEqual(skills.files.map(f=>f.path).sort(), expected.filter(p=>p.startsWith('plugins/')));
for (const f of skills.files) assert.equal(hash(f.path), f.sha256, 'source skill drift');
assert.equal(exportProfile.contractVersion, lock.contractVersion);
assert.equal(exportProfile.backendExportRevision, null, 'canonical checkpoint remains historical');
validateExportResults(syntheticExportResults('codex'));
const args = process.argv.slice(2);
assert.ok(args.length===0 || (args.length===2 && args[0]==='--export-results'), 'usage: node scripts/check-audit-export-readiness.mjs [--export-results results.json]');
let mode='synthetic';
if(args.length) {
  const { statSync } = await import('node:fs');
  assert.ok(statSync(args[1]).size<=32*1024*1024, 'offline evidence file bound, not backend report limit');
  const bytes=readFileSync(args[1]);
  assert.ok(bytes.length<=32*1024*1024, 'offline evidence file bound, not backend report limit');
  const results=JSON.parse(bytes);
  assert.equal(results.host, 'codex', 'Codex results required');
  mode=validateExportResults(results);
}
console.log(mode==='synthetic' ? 'Synthetic offline audit export semantics passed; no backend or host executed.' : 'Measured context semantic assertions passed; evidence provenance, side effects and live support require independent verification.');
console.log(`Codex export profile ${lock.contractVersion}: ${expected.length} canonical artifacts, ${exportFixtures.scenarios.length} synthetic scenarios. HTP and SEOsmith release gates remain open; no installed skill parity or live acceptance.`);
