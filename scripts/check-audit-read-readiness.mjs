// Finite offline Codex readiness for the additive audit read profile 1.3.0.
// Gated: no installed-skill, host, backend or producer run. The two reads are
// absent on the deployed 23-tool host and return explicit producer_unavailable
// only after the reviewed 25-tool source is deployed with the H15 gates on.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const readJson = (p) => JSON.parse(read(p));
const sha = (p) => createHash("sha256").update(readFileSync(join(root, p))).digest("hex");

const lock = readJson("contract/audit-reads-1.3.lock.json");
assert.equal(lock.contractVersion, "1.3.0");
assert.equal(lock.canonicalCommit, "4e7dc94e4f92a30fb57e4061fa1f06d517157c63");
assert.equal(lock.mergedTree, "36a9456c6e2a819e7b4233ef0ae40b30a509efb8");
assert.equal(lock.sourcePR, 82);
assert.equal(lock.revisionStatus, "merged");
assert.match(lock.canonicalRevision, /merged into main/);
assert.deepEqual(lock.activationGates, [
  "exact-head contract review and canonical merge",
  "H15 producer/processor activation is independently gated and disabled",
  "three host source/readiness companions at exact canonical merge; runtime support separately verified",
  "fresh tools/list and input-schema discovery on the deployed host",
]);

const tree = "contract/audit-reads-1.3";
const inventory = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return inventory(full);
    return [full.slice(root.length + tree.length + 2)];
  });
const expected = Object.keys(lock.files).sort();
const actual = inventory(join(root, tree)).sort();
assert.deepEqual(actual, expected, "vendored 1.3 inventory drift");
for (const path of expected) assert.equal(sha(tree + "/" + path), lock.files[path], "contract drift: " + path);

const skillsLock = readJson("contract/audit-reads-1.3/docs/plugin-contract/v1.3/skills.lock.json");
assert.equal(skillsLock.contractVersion, "1.3.0");
assert.equal(skillsLock.owner, "HTP");
assert.equal(skillsLock.source, "plugins/htp/skills");
const skillPaths = skillsLock.files.map((file) => file.path).sort();
assert.deepEqual(skillPaths, [
  "plugins/htp/skills/repository-settings/SKILL.md",
  "plugins/htp/skills/seo-review/SKILL.md",
  "plugins/htp/skills/seo-review/references/data.md",
  "plugins/htp/skills/website-management/SKILL.md",
]);
for (const file of skillsLock.files) {
  assert.equal(sha("contract/audit-reads-1.3/" + file.path), file.sha256, "source-skill drift: " + file.path);
}

// The shipped Codex shared skill must equal the 1.3 source lock bytes.
const shipped = "plugin/skills/website-management/SKILL.md";
assert.equal(sha(shipped), skillsLock.files.find((f) => f.path.endsWith("website-management/SKILL.md")).sha256, "shipped website-management skill drift");
assert.match(read(shipped), /producer_unavailable/);
assert.match(read(shipped), /4,952,756 UTF-8 bytes/);
assert.doesNotMatch(read(shipped), /16 MiB/);

const profile = readJson("contract/audit-reads-1.3/docs/plugin-contract/v1.3/audit-reads.json");
assert.equal(profile.contractVersion, "1.3.0");
assert.deepEqual(profile.extends, ["1.0.0", "1.1.0", "1.2.0"]);
assert.equal(profile.availability.disabledValue, "producer_unavailable");
assert.match(profile.availability.meaning, /not an empty history/i);
assert.match(profile.discovery, /unsupported/i);
assert.equal(profile.limits.limitMin, 1);
assert.equal(profile.limits.limitMax, 100);
assert.equal(profile.limits.defaultLimit, 50);
assert.deepEqual(profile.operations.map((op) => op.id).sort(), [
  "htp.website_audit_events",
  "htp.website_operational_episodes",
]);
for (const op of profile.operations) {
  assert.equal(op.effect, "read");
  assert.equal(op.collection, false);
  assert.equal(op.authorization, "htp-owner-oauth");
}

const conformance = readJson("contract/audit-reads-1.3/docs/plugin-contract/v1.3/conformance.json");
assert.equal(conformance.contractVersion, "1.3.0");
assert.equal(conformance.evidenceKind, "synthetic");
assert.equal(conformance.scenarios.length, 16);
for (const op of ["htp.website_audit_events", "htp.website_operational_episodes"]) {
  for (const suffix of ["owner.page", "owner.producer_unavailable", "owner.trailing_page", "anonymous", "non_owner", "missing_capability", "unpaired_cursor", "limit_out_of_range"]) {
    assert.ok(conformance.scenarios.some((s) => s.id === `${op}.${suffix}`), `missing ${op}.${suffix}`);
  }
}
const missing = conformance.scenarios.find((s) => s.id === "htp.website_audit_events.missing_capability");
assert.deepEqual(missing.expected.result, { code: "unsupported" });
const disabled = conformance.scenarios.find((s) => s.id === "htp.website_audit_events.owner.producer_unavailable");
assert.equal(disabled.expected.result.availability, "producer_unavailable");
assert.deepEqual(disabled.expected.effects, { collectionRegistered: false, crawlRunsCreated: 0 });

const { validateAuditReadResults, syntheticAuditReadResults } = await import("../contract/audit-reads-1.3/scripts/audit-read-contract.mjs");
assert.equal(validateAuditReadResults(conformance, syntheticAuditReadResults("codex")), undefined);

const args = process.argv.slice(2);
let mode = "synthetic";
if (args.length) {
  assert.deepEqual(args.length, 2, "usage: node scripts/check-audit-read-readiness.mjs [--audit-read-results path]");
  assert.equal(args[0], "--audit-read-results");
  const evidence = JSON.parse(readFileSync(args[1], "utf8"));
  assert.equal(evidence.host, "codex");
  validateAuditReadResults(conformance, evidence);
  mode = "measured";
}
console.log(mode === "synthetic"
  ? "Synthetic offline audit read semantics passed. Absent tools are unsupported; producer_unavailable is explicit and never an empty success. This is vendored-source readiness, not host or backend evidence."
  : "Measured Codex audit read traces passed the canonical semantic validator. Provenance, live auth, discovery and producer support remain independent acceptance obligations.");

console.log(`Codex audit read profile ${lock.contractVersion}: ${expected.length} canonical artifacts, ${conformance.scenarios.length} synthetic scenarios, host=codex; merged PR #82 pin 4e7dc94. H15 producer gates and deployed 25-tool discovery remain gated; no installed-skill, host or backend evidence.`);
