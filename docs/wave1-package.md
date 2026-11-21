# Codex package and release gates

This repository supplies a local marketplace and thin skills package. The HTP skills are exact copies of the canonical 1.2 pin in `contract/audit-export-1.2`; `npm test` verifies parity. Historical contract fixtures remain immutable. The SEOsmith workflow targets the upstream `operations` adapter v1 documented at https://github.com/hatchertechnology/seosmith/blob/f7b9e62772e8b271a109c1029be4d789352774cd/docs/operations/README.md. Discover the actual binary and capabilities on every use. The upstream documentation governs request fields, limits, storage, retries and export.

On Codex CLI 0.171.0, from a trusted checkout:

```sh
codex plugin marketplace add /absolute/path/to/htp-codex
codex plugin add htp@htp-codex
```

Restart Codex if discovery does not refresh. For a Git marketplace use `codex plugin marketplace add hatchertechnology/htp-codex --ref <reviewed-ref>`, then `codex plugin marketplace upgrade htp-codex` and reinstall the plugin as required by the host. Uninstall with `codex plugin remove htp@htp-codex`, then optionally `codex plugin marketplace remove htp-codex`. Roll back to a reviewed ref and reinstall; do not remove user credentials or audit databases. Version 0.171.0 is observed, not a minimum support claim. Existing separate HTP installations are not replaced automatically.

Configure HTP separately with the authorized deployment's MCP URL, e.g. `codex mcp add htp --url https://htp-api-kerry-hatcher.fly.dev/mcp/secured`; use `codex mcp login htp`, reconnect with login, and `codex mcp logout htp`. OAuth is host-managed. Never put tokens in package files. The HTP server enforces website authorization; do not bypass denial. Read-only saved-data tools must not invoke `request_website_report`, which schedules collection. The plugin does not install or authenticate an MCP connection itself.

The package is a candidate, not a production acceptance assertion. HTP tool discovery and deployed input schemas gate each operation. Lifecycle/remediation, provider outcomes, orchestration, forms, browser/local/AI and future staging/baseline CI remain unavailable until deployed capability, compatible schema and live host acceptance are established. A skill mentioning a tool is not proof of availability. Local CLI, configured private worker and HTP-authorized orchestration are separate modes; only local CLI is described by the bundled SEOsmith skill.

Codex CLI 0.171.0 accepted an isolated Git marketplace add, install of 0.1.0, refresh, upgrade to 0.1.1 and removal. Rollback remains unverified. Before release verify rollback, OAuth login/reconnect/logout and expired credentials, authorized saved read and cross-account denial, no collection on read, actual adapter start/status/cancel/report/export, retries, interrupted and partial states, offline and missing-capability behavior. Record exact versions, SHAs, receipts and cleanup; fixture tests are not live or production verification. Two independent reviews and integration-owner rollout checks remain required. Sync new canonical skills as a separately reviewed pin, verify file hashes and contracts, then repeat checks; preserve old pinned profiles for compatibility.

Official host references: https://developers.openai.com/codex/plugins, https://developers.openai.com/codex/skills, https://developers.openai.com/codex/mcp (checked 2026-11-21).
