# Codex compatibility

Wave 0 observations were made 2026-11-16 against installed `codex-cli 0.169.0`. The Wave 1 synthetic host acceptance below was observed 2026-11-24 on installed `codex-cli 0.171.0`. This is an observed version, not a minimum supported version. In Wave 0, `codex --help`, `codex plugin --help`, and `codex mcp --help` were inspected without reading credential stores or initiating login.

## Host support and limits

The current [official plugins guide](https://learn.chatgpt.com/docs/plugins) describes plugins containing skills and MCP servers, marketplace installation, and prompts to connect external services. Installed CLI help exposes `plugin add/list/remove/marketplace`. A Codex marketplace/plugin manifest is now shipped: `.agents/plugins/marketplace.json` registers the `htp-codex` marketplace, and `plugin/.codex-plugin/plugin.json` (version 0.2.0) points at `plugin/skills/` and `plugin/mcp.json`. Codex CLI 0.171.0 was observed to accept marketplace add, plugin add/list/remove, Git ref selection/refresh and exact-content rollback in disposable profiles; see [package and release gates](wave1-package.md) and `scripts/host-discovery-smoke.py`. Version 0.171.0 is an observed host, not a minimum. A Claude manifest is not assumed compatible.

The [official skills guide](https://learn.chatgpt.com/docs/build-skills) specifies directories containing SKILL.md with name and description metadata. The shipped package places four namespaced skills under `plugin/skills/`; `scripts/host-discovery-smoke.py` installs the plugin into a fresh disposable CODEX_HOME and the Codex app-server reports all four installed skills with no discovery errors. Skill discovery is host inventory, not proof that an autonomous agent executes a skill's operations.

The [official MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) documents stdio and Streamable HTTP, bearer authentication and OAuth. CLI help exposes `mcp add/get/list/remove/login/logout`. HTP requires host-managed OAuth acceptance; do not place tokens in skills, manifests, fixtures, git, or transcripts. `codex mcp add` and `codex mcp login` complete a host-managed authorization-code + PKCE flow, and `codex mcp logout` removes the stored credential. That flow was exercised on 2026-11-24 against a synthetic cooperative loopback OAuth/MCP fixture (`scripts/host-oauth-smoke.py` plus `scripts/fixtures/oauth-mcp-fixture.mjs`), not against HTP. No real authorization, real tenant read or ChatGPT connected-app authorization was performed.

## Wave 1 synthetic host acceptance

Observed 2026-11-24 on `codex-cli 0.171.0` (one observed version/platform), isolated with `unshare -rn` (loopback only), a fresh private HOME/CODEX_HOME/TMPDIR, and `mcp_oauth_credentials_store = "file"`. `python3 scripts/host-oauth-smoke.py approve|deny` drives `codex mcp add`/`login`/`logout` against the cooperative loopback fixture. No model inference, agent turn, approval change, sandbox change, real profile, real credential or external network is involved; the fixture keeps synthetic client registrations, PKCE codes and tokens in memory.

- Signed in: `codex mcp add oauth_fixture --url http://127.0.0.1:<port>/mcp` completes discovery, dynamic client registration, authorization and token exchange, prints `Successfully logged in.`, and `codex mcp list --json` reports `auth_status: "o_auth"`. With file credential storage the synthetic credential is written under `$CODEX_HOME/.credentials.json` mode 0600. The app-server `mcpServerStatus/list` then reports `authStatus: "oAuth"` and the fixture catalog with no `toolsError`; the fixture log records authenticated `initialize` and `tools/list` calls.
- Denied: with the fixture returning `access_denied`, `codex mcp add` exits non-zero with an `access_denied` error, stores no credential, and `mcp list` reports `not_logged_in`. Codex 0.171.0 retried once without requested scopes before surfacing the denial.
- Logout: `codex mcp logout` removes the stored credential; `mcp list` returns `not_logged_in` and an app-server catalog request fails with `Auth required`.
- Reconnect: `codex mcp login` repeats the flow and restores `o_auth`.

This is synthetic loopback evidence for the ordinary CLI OAuth path and file-credential lifecycle, not HTP authorization. Real HTP login, tenant reads, cross-account denial, expiry/refresh/offline behavior and ChatGPT connected-app authorization remain unverified. Preserve the shipped production endpoint independently; the synthetic target is a separately registered local server and is never written into the packaged HTP configuration.

## Service acceptance matrix

| Service | Wave 0 evidence | Required before release |
| --- | --- | --- |
| HTP | Canonical inventory, normalized stored-read/auth/isolation/write scenarios; synthetic loopback CLI OAuth add/login/deny/logout on 0.171.0 | Real HTP host login/reconnect/expiry, authorized stored read without collection, denied cross-website read, explicit write confirmation and retry identity against a test tenant |
| SEOsmith | Historical operation inventory and bounded report/cancel/partial/error scenarios; initial adapter dependency SEOsmith #18 completed; typed local MCP binding shipped in package 0.2.0 | Isolated authorized host-agent configuration, live start/status/cancel/report lifecycle, isolation, bounds, retries, unknown outcomes, partial/truncated reports and HTP orchestration in Codex |

Offline observations are synthetic expected values. Passing the offline checker proves validator/fixture compatibility only; it does not prove backend execution, adapter availability, live OAuth correctness, package completeness, or side effects. `node scripts/check.mjs --results path.json` checks exact equality with canonical synthetic golden values, including fixture identifiers and unknown outcomes. It cannot accept varied real live transcripts and provides no live conformance evidence; producer provenance is not authenticated. Never include credentials or customer data. Shared negative tests cover denial, cross-website leakage, scheduling reads, unsupported operations, false passing outcomes, bounds, malformed fields, and transcript completeness.

## Pin and synchronization

`contract.lock.json` pins HTP PR36 head 3db3e439ec0adc99211d49358a7cb8a29507a940 and SHA-256 for all six historical copied artifacts, including the executable validator and its tests. This remains an immutable historical baseline with its original revision assertion in `scripts/check.mjs`. `npm run check` runs both the historical checker and the new readiness checker; `npm test` runs both sets of offline tests. These checks do not query the upstream branch for changes.

Keep that historical lock, its six artifacts and checker assertion unchanged when syncing newer profiles. Review the canonical revision, extract the new profile into a separate tree, and update its separate lock/checker in one reviewed change. Review operation additions/removals, host gates and skill hashes explicitly. Rollback restores the reviewed companion commit and lock together, then repeats offline and live acceptance. Do not track a mutable branch or silently regenerate expected fixtures from a live result.

## Additive 1.1 provider-request readiness

`contract/provider-request-1.1.lock.json` pins contract 1.1.0 to canonical HTP PR44 merge `e19875d0d6e74b5d990e45e456656c99dacc89d1`, with backend PR45 merge `48485a55773b1ca97e165a4715d343704270266e` as required implementation provenance. Both exact merge commits were fetched and inspected. A backend merge is separate from deployment and discovered tool/input support.

The separate tree preserves nine canonical paths byte-for-byte: the JSON reader dependency, semantic validator, profile, conformance scenarios, source skill lock and four skill files. The checker verifies exact inventory and hashes before importing the canonical validator, and compares every vendored skill against the 1.1 source lock. This establishes vendored-source parity at the pin, not installed-skill parity for this pin or a host adapter.

Run `node scripts/check-provider-request-readiness.mjs --provider-results path.json` for semantic validation. The envelope requires `contractVersion: "1.1.0"`, `host: "codex"` and complete `observations` with canonical scenario/step IDs. Each trace contains `id` and `steps`; either every trace also supplies `context: {evidenceRefs, steps}` or none does. Context permits lawful varied keys, website IDs, times and associations while retaining canonical denial, conflict, cap, expiry and uncertainty cases. The CLI labels all-context input as measured context supplied and context-free input as synthetic. Evidence references and counters require independent verification; the checker does not authenticate provenance. Local positive tests construct varied measurements as test data and provide no live acceptance evidence.

The 27 canonical traces self-check on every invocation. Local negative tests exercise missing scenarios, context case erasure, invalid associations, mixed context, wrong host, changed validator/skills/fixtures, missing/unlisted files and pin drift. JSON inputs retain the canonical 1 MiB bound.

HTP #34 deployment, discovered provider input schemas and Codex host acceptance remain activation obligations. SEOsmith #18's initial adapter is completed/closed; the historical v1 host/skill locks still reference its former gate and remain byte-identical provenance. Current unresolved SEOsmith obligations concern live host-agent configuration and acceptance, deployed capability and live lifecycle verification; the bundled typed binding and its synthetic transport checks do not substitute for those. Installation and host-managed OAuth acceptance remain required for both services. The copied 1.1 profile's postchecks-pending language records its canonical source checkpoint; this companion does not assert deployment, waive backend acceptance or close Codex #2.

No merge, deployment, issue closure, or production mutation is part of this work.

The copied host profile is consumed by the checker for Codex identity, package status, OAuth method, minimum-version boundary, service readiness and open gates. Its canonical “README/license only” installation wording is stale: this repository now ships a Codex marketplace/plugin manifest and readiness docs/scripts. The canonical copy stays byte-identical until an upstream reviewed correction. Its desktop/managed-app authorization assertion is unverified here; separate CLI and connected-app evidence remains required.

## Additive 1.2 audit-export readiness

The separate `contract/audit-export-1.2.lock.json` pins canonical HTP PR48 merge
`6c065c8327970b0773ba90f163f99a6e56e1e204` and backend PR50 merge
`ea8179af3d438f5cc88cf96260b06a23b88cfd18`. Twelve extracted files retain exact
canonical bytes, including the four current skill/reference files. The checker
verifies recursive inventory, hashes and source-lock parity before importing the
semantic validator. Historical v1 and accepted 1.1 pins, artifacts and checks stay
unchanged. This proves vendored-source readiness at those pins; installed skills from these pins and a host adapter remain unverified, while the shipped package is validated separately. Codex #2 stays open.

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
production requests and waives no acceptance gate. Schema rediscovery, real Codex
export and service OAuth acceptance and HTP #34 remain open; synthetic CLI
installation/upgrade/rollback and loopback OAuth are recorded above;
SEOsmith still requires Codex adapter integration and live lifecycle acceptance.

Sync future export profiles into a separately reviewed exact-pin tree and lock,
review wire and source changes, and rerun all historical and additive checks.
Rollback restores this companion's reviewed commit and lock together, then repeats
required offline and host acceptance before activation.
