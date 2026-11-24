import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticAuditReadResults } from "../contract/audit-reads-1.3/scripts/audit-read-contract.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(results, mutate) {
  const dir = mkdtempSync(join(tmpdir(), "codex-audit-read-"));
  try {
    for (const path of ["scripts", "contract", "plugin", "package.json"]) {
      cpSync(join(root, path), join(dir, path), { recursive: true });
    }
    if (mutate) mutate(dir);
    const args = [];
    if (results) {
      const file = join(dir, "results.json");
      writeFileSync(file, JSON.stringify(results));
      args.push("--audit-read-results", file);
    }
    return spawnSync(process.execPath, ["scripts/check-audit-read-readiness.mjs", ...args], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("synthetic Codex self-test passes and is labelled vendored-source readiness", () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Synthetic offline audit read semantics passed/);
  assert.match(r.stdout, /Absent tools are unsupported/);
});

test("measured Codex traces pass and are labelled measured", () => {
  const r = run(syntheticAuditReadResults("codex"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Measured Codex audit read traces/);
});

for (const [name, mutate] of [
  ["wrong host", (results) => { results.host = "pi"; }],
  ["erased producer availability", (results) => {
    const observation = results.observations.find((o) => o.id === "htp.website_audit_events.owner.producer_unavailable");
    delete observation.result.availability;
  }],
  ["missing tool substituted as empty success", (results) => {
    const observation = results.observations.find((o) => o.id === "htp.website_operational_episodes.missing_capability");
    observation.result = { version: 1, episodes: [], has_more: false, next_cursor: null, availability: "producer_unavailable" };
  }],
  ["dropped scenario", (results) => { results.observations.pop(); }],
]) {
  test("CLI rejects " + name, () => {
    const results = syntheticAuditReadResults("codex");
    mutate(results);
    assert.notEqual(run(results).status, 0);
  });
}

const tree = "contract/audit-reads-1.3/";
for (const [name, mutate] of [
  ["validator drift", (dir) => appendFileSync(join(dir, tree + "scripts/audit-read-contract.mjs"), "\n")],
  ["source skill drift", (dir) => appendFileSync(join(dir, tree + "plugins/htp/skills/seo-review/SKILL.md"), "\n")],
  ["shipped skill drift", (dir) => appendFileSync(join(dir, "plugin/skills/website-management/SKILL.md"), "\n")],
  ["pin drift", (dir) => {
    const file = join(dir, "contract/audit-reads-1.3.lock.json");
    const lock = JSON.parse(readFileSync(file, "utf8"));
    lock.canonicalCommit = "0".repeat(40);
    writeFileSync(file, JSON.stringify(lock));
  }],
  ["gate removal", (dir) => {
    const file = join(dir, "contract/audit-reads-1.3.lock.json");
    const lock = JSON.parse(readFileSync(file, "utf8"));
    lock.activationGates = [];
    writeFileSync(file, JSON.stringify(lock));
  }],
]) {
  test("readiness rejects " + name, () => assert.notEqual(run(null, mutate).status, 0));
}
