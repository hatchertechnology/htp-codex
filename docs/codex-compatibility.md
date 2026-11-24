# Codex compatibility — Wave 0

Verified 2026-11-16 against installed `codex-cli 0.169.0`. This is an observed version, not a minimum supported version. `codex --help`, `codex plugin --help`, and `codex mcp --help` were inspected without reading credential stores or initiating login.

## Host support and limits

The current [official plugins guide](https://learn.chatgpt.com/docs/plugins) describes plugins containing skills and MCP servers, marketplace installation, and prompts to connect external services. Installed CLI help exposes `plugin add/list/remove/marketplace`. This does not prove this repository is installable. No manifest is shipped: the exact release manifest, marketplace registration, asset paths, and installation/upgrade/removal behavior must be validated in Wave 1 against the then-current official schema. A Claude manifest must not be assumed compatible.

The [official skills guide](https://learn.chatgpt.com/docs/build-skills) specifies directories containing SKILL.md with name and description metadata. Repository skills can live under .agents/skills. These are host primitives; this repository has not installed or exercised shared skills in a fresh Codex session.

The [official MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) documents stdio and Streamable HTTP, bearer authentication and OAuth. CLI help exposes `mcp add/get/list/remove/login/logout`. HTP requires host-managed OAuth acceptance; do not place tokens in skills, manifests, fixtures, git, or transcripts. No live authorization was performed. ChatGPT connected-app authorization and CLI authorization require separate evidence.

## Service acceptance matrix

| Service | Wave 0 evidence | Required before release |
| --- | --- | --- |
| HTP | Canonical inventory, normalized stored-read/auth/isolation/write scenarios | Fresh CLI installation, host OAuth login/logout/expiry, authorized stored read without collection, denied cross-website read, explicit write confirmation and retry identity against a test tenant |
| SEOsmith | Historical operation inventory and bounded report/cancel/partial/error scenarios; initial adapter dependency SEOsmith #18 completed; typed local MCP binding shipped in package 0.2.0 | Isolated authorized host-agent configuration, live start/status/cancel/report lifecycle, isolation, bounds, retries, unknown outcomes, partial/truncated reports and HTP orchestration in Codex |

Offline observations are synthetic expected values. Passing proves validator/fixture compatibility, not backend execution, adapter availability, OAuth correctness, package completeness, or side effects. `node scripts/check.mjs --results path.json` checks exact equality with canonical synthetic golden values, including fixture identifiers and unknown outcomes. It cannot accept varied real live transcripts and provides no live conformance evidence; producer provenance is not authenticated. Never include credentials or customer data. Shared negative tests cover denial, cross-website leakage, scheduling reads, unsupported operations, false passing outcomes, bounds, malformed fields, and transcript completeness.

## Pin and synchronization

`contract.lock.json` pins HTP PR36 head 3db3e439ec0adc99211d49358a7cb8a29507a940 and SHA-256 for all six historical copied artifacts, including the executable validator and its tests. This remains an immutable historical baseline with its original revision assertion in `scripts/check.mjs`. `npm run check` runs both the historical checker and the new readiness checker; `npm test` runs both sets of offline tests. These checks do not query the upstream branch for changes.

Keep that historical lock, its six artifacts and checker assertion unchanged when syncing newer profiles. Review the canonical revision, extract the new profile into a separate tree, and update its separate lock/checker in one reviewed change. Review operation additions/removals, host gates and skill hashes explicitly. Rollback restores the reviewed companion commit and lock together, then repeats offline and live acceptance. Do not track a mutable branch or silently regenerate expected fixtures from a live result.

## Additive 1.1 provider-request readiness

`contract/provider-request-1.1.lock.json` pins contract 1.1.0 to canonical HTP PR44 merge `e19875d0d6e74b5d990e45e456656c99dacc89d1`, with backend PR45 merge `48485a55773b1ca97e165a4715d343704270266e` as required implementation provenance. Both exact merge commits were fetched and inspected. A backend merge is separate from deployment and discovered tool/input support.

The separate tree preserves nine canonical paths byte-for-byte: the JSON reader dependency, semantic validator, profile, conformance scenarios, source skill lock and four skill files. The checker verifies exact inventory and hashes before importing the canonical validator, and compares every vendored skill against the 1.1 source lock. This establishes vendored-source parity at the pin, not installed skill parity, a package manifest or a host adapter.

Run `node scripts/check-provider-request-readiness.mjs --provider-results path.json` for semantic validation. The envelope requires `contractVersion: "1.1.0"`, `host: "codex"` and complete `observations` with canonical scenario/step IDs. Each trace contains `id` and `steps`; either every trace also supplies `context: {evidenceRefs, steps}` or none does. Context permits lawful varied keys, website IDs, times and associations while retaining canonical denial, conflict, cap, expiry and uncertainty cases. The CLI labels all-context input as measured context supplied and context-free input as synthetic. Evidence references and counters require independent verification; the checker does not authenticate provenance. Local positive tests construct varied measurements as test data and provide no live acceptance evidence.

The 27 canonical traces self-check on every invocation. Local negative tests exercise missing scenarios, context case erasure, invalid associations, mixed context, wrong host, changed validator/skills/fixtures, missing/unlisted files and pin drift. JSON inputs retain the canonical 1 MiB bound.

HTP #34 deployment, discovered provider input schemas and Codex host acceptance remain activation obligations. SEOsmith #18's initial adapter is completed/closed; the historical v1 host/skill locks still reference its former gate and remain byte-identical provenance. Current unresolved SEOsmith obligations concern live host-agent configuration and acceptance, deployed capability and live lifecycle verification; the bundled typed binding and its synthetic transport checks do not substitute for those. Installation and host-managed OAuth acceptance remain required for both services. The copied 1.1 profile's postchecks-pending language records its canonical source checkpoint; this companion does not assert deployment, waive backend acceptance or close Codex #2.

No merge, deployment, issue closure, or production mutation is part of this work.

The copied host profile is consumed by the checker for Codex identity, package status, OAuth method, minimum-version boundary, service readiness and open gates. Its canonical “README/license only” installation wording is stale: this repository now contains readiness docs/scripts but no installable package. Its desktop/managed-app authorization assertion is unverified here; separate CLI and connected-app evidence remains required. The canonical copy stays byte-identical until an upstream reviewed correction.

## Additive 1.2 audit-export readiness

The separate `contract/audit-export-1.2.lock.json` pins canonical HTP PR48 merge
`6c065c8327970b0773ba90f163f99a6e56e1e204` and backend PR50 merge
`ea8179af3d438f5cc88cf96260b06a23b88cfd18`. Twelve extracted files retain exact
canonical bytes, including the four current skill/reference files. The checker
verifies recursive inventory, hashes and source-lock parity before importing the
semantic validator. Historical v1 and accepted 1.1 pins, artifacts and checks stay
unchanged. This proves vendored-source readiness at those pins; installed skills,
a host adapter and an installable package remain unverified. Codex #2 stays open.

`node scripts/check-audit-export-readiness.mjs --export-results results.json`
requires host `codex` and complete 1.2 observations for all 19 scenarios. All traces
must supply context or all must omit it. Context-free results are labeled synthetic;
all-context results are labeled measured-context assertions, with independent
provenance verification required. Tests fabricate context; no live measurement is
claimed. The 32 MiB CLI envelope and canonical 4 MiB source bounds constrain offline
evidence only and do not change backend report limits.

The canonical workflow preserves complete immutable detail bytes: start, chunk,
verify length and snapshot SHA-256, decode retained raw `report_json` exactly, then
close. A null raw field retains the stored JSONB fallback meaning. Snapshot SHA is
transfer integrity, not ingestion provenance. EXPORT_REQUIRED explicitly migrates
large inline callers; expiry, restart or another instance requires a fresh snapshot
and complete restart without mixing bytes. Every call requires fresh owner/target
checks. Export reads must not schedule collection or crawl work.

The canonical profile's null backend revision and proposed status preserve its
historical checkpoint. The Wave0 handoff separately records backend deployment and
one hosted worker export success, with concurrency/affinity still unverified. Fresh
owner token-heavy import timed out; its cause remains unresolved. Production tests
remain paused and the SEOsmith v2 producer stays off. This companion performs no
production requests and waives no acceptance gate. Schema rediscovery, actual Codex
export/OAuth/installation/upgrade/rollback acceptance and HTP #34 remain open;
SEOsmith still requires Codex adapter integration and live lifecycle acceptance.

Sync future export profiles into a separately reviewed exact-pin tree and lock,
review wire and source changes, and rerun all historical and additive checks.
Rollback restores this companion's reviewed commit and lock together, then repeats
required offline and host acceptance before activation.
