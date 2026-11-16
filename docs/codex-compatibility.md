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
| SEOsmith | Canonical gated operation inventory and bounded report/cancel/partial/error scenarios | Actual adapter revision and executable integration, start/status/cancel/report lifecycle, isolation, bounds, retries, unknown outcomes and partial/truncated reports in Codex |

Offline observations are synthetic expected values. Passing proves validator/fixture compatibility, not backend execution, adapter availability, OAuth correctness, package completeness, or side effects. `node scripts/check.mjs --results path.json` checks exact equality with canonical synthetic golden values, including fixture identifiers and unknown outcomes. It cannot accept varied real live transcripts and provides no live conformance evidence; producer provenance is not authenticated. Never include credentials or customer data. Shared negative tests cover denial, cross-website leakage, scheduling reads, unsupported operations, false passing outcomes, bounds, malformed fields, and transcript completeness.

## Pin and synchronization

`contract.lock.json` pins HTP PR36 head fc5beb752d7fd47f46959e3c76e7f431cd5a6729 and SHA-256 for every copied artifact, including the executable validator and its tests. This is a provisional, unmerged review-head pin; delta review is pending. Final integration must repin to the accepted merged canonical revision before release. `npm run check` rejects local drift; `npm test` proves a modified inventory fails closed. This does not query the upstream branch for changes.

To sync, review the canonical PR/revision first, extract the six listed paths from that exact git commit, recompute each SHA-256, update the revision assertion and lock in one reviewed change, and rerun both checks. Review operation additions/removals, host gates and skill hashes explicitly. The copied skills lock describes upstream source hashes; it does not certify that skills are installed locally. Before release refresh to the reviewed merged canonical revision. Rollback restores the last reviewed commit and lock together, then repeats offline and live acceptance. Do not track a mutable branch or silently regenerate expected fixtures from a live result.

No merge, deployment, issue closure, or production mutation is part of this work.

The copied host profile is consumed by the checker for Codex identity, package status, OAuth method, minimum-version boundary, service readiness and open gates. Its canonical “README/license only” installation wording is stale: this repository now contains readiness docs/scripts but no installable package. Its desktop/managed-app authorization assertion is unverified here; separate CLI and connected-app evidence remains required. The canonical copy stays byte-identical until an upstream reviewed correction.
