# Codex package and release gates

This repository supplies a local marketplace and thin skills package. The HTP skills are exact copies of the canonical 1.2 pin in `contract/audit-export-1.2`; `npm test` verifies parity. Historical contract fixtures remain immutable. The SEOsmith workflow targets the upstream `operations` adapter v1 documented at https://github.com/hatchertechnology/seosmith/blob/f7b9e62772e8b271a109c1029be4d789352774cd/docs/operations/README.md. Discover the actual binary and capabilities on every use. The upstream documentation governs request fields, limits, storage, retries and export.

On Codex CLI 0.171.0, install from a trusted local checkout:

```sh
codex plugin marketplace add /absolute/path/to/htp-codex
codex plugin add htp@htp-codex
```

For a Git installation, choose a reviewed branch or immutable commit SHA and register it instead of the local source:

```sh
codex plugin marketplace add https://github.com/hatchertechnology/htp-codex.git --ref <reviewed-ref>
codex plugin add htp@htp-codex --json
codex plugin list --available --json
```

To refresh the configured Git ref, then confirm the selected installation:

```sh
codex plugin marketplace upgrade htp-codex --json
codex plugin add htp@htp-codex --json
codex plugin list --available --json
```

A branch can advance; an immutable SHA stays pinned. `upgrade` refreshes the existing ref and does not accept a replacement ref. On 0.171.0, changing the ref with another `marketplace add` fails with “already added from a different source.” To roll back or switch refs, replace only the target marketplace registration, then install from the reviewed SHA:

```sh
codex plugin marketplace remove htp-codex --json
codex plugin marketplace add https://github.com/hatchertechnology/htp-codex.git --ref <reviewed-older-commit-sha> --json
codex plugin add htp@htp-codex --json
codex plugin list --available --json
```

Marketplace removal affects the whole source, not just one plugin. In the tested Git setup it removed the registration and managed marketplace snapshot, leaving the installed plugin cache and enabled config entry behind; that plugin disappeared from the CLI listing until the source was re-added. It is not a plugin uninstall or credential logout. To uninstall only HTP, use `codex plugin remove htp@htp-codex`; optionally remove the marketplace afterward if no longer needed.

Check the version and enabled entry in `plugin list`, and compare the complete package contents at the `installedPath` returned by `plugin add --json` with the reviewed tree; version strings alone do not prove recovery. Restart Codex if session discovery does not refresh. Do not delete profile directories, credentials or audit databases during these steps. Preservation checks used synthetic unrelated packages, registry entries and sentinels, not real credentials or audit data; retain your normal backups and do not assume this test covers every user-data layout. Version 0.171.0 is observed, not a minimum support claim. Existing separate HTP installations are not replaced automatically.

Configure HTP separately with the authorized deployment's MCP URL, e.g. `codex mcp add htp --url https://htp-api-kerry-hatcher.fly.dev/mcp/secured`; use `codex mcp login htp`, reconnect with login, and `codex mcp logout htp`. OAuth is host-managed. Never put tokens in package files. The HTP server enforces website authorization; do not bypass denial. A separate `CODEX_HOME` alone does not guarantee OAuth isolation: the default `mcp_oauth_credentials_store = "auto"` may select the OS keyring, which can share credentials for the same server name and URL across homes. In an isolated test use a new private home with `mcp_oauth_credentials_store = "file"` set before login, protect that home, and verify isolation before use; this stores credentials as a file readable by the same OS user. Do not switch an existing profile or log out a shared keyring entry without understanding its effects. In Codex 0.171.0, after a second synthetic login under another home, the first home received a 403 for its previously readable site. This is consistent with shared credentials but does not independently identify the active credential; neither test selected file storage. A subsequent scoped check with separate rootless containers, private homes, disabled session-bus access and explicit file stores retained the expected owner/non-owner separation through owner logout and reconnect. Treat this as a check on Codex 0.171.0 and this environment, not a guarantee for other hosts. Read-only saved-data tools must not invoke `request_website_report`, which schedules collection. The plugin does not install or authenticate an MCP connection itself.

The package is a candidate, not a production acceptance assertion. HTP tool discovery and deployed input schemas gate each operation. Lifecycle/remediation, provider outcomes, orchestration, forms, browser/local/AI and future staging/baseline CI remain unavailable until deployed capability, compatible schema and live host acceptance are established. A skill mentioning a tool is not proof of availability. Local CLI, configured private worker and HTP-authorized orchestration are separate modes; only local CLI is described by the bundled SEOsmith skill.

Codex CLI 0.171.0 passed Git marketplace install, forward content replacement, exact older-content recovery, catalog discovery changes and target removal in two independent disposable profiles. Historical 0.1.0/0.1.1 skills are identical, so meaningful transitions used a labeled controlled Git mirror with different benign skill instructions/versions and an added catalog entry. Private Git URL rewriting selected a local mirror; remote HTTPS delivery/authentication was not tested. Complete installed file hashes matched each expected tree; unrelated package/config entries and sentinels, plus the idle profile, survived. Forward marketplace refresh already replaced the installed cache in this setup. These are distribution and CLI catalog checks, not skill activation, agent/tool execution, authenticated-profile preservation or production acceptance.

Before release complete remaining OAuth/expiry, authorized saved read and cross-account denial, collection-side-effect, actual adapter start/status/cancel/report/export, retry/interruption/partial-state, offline and missing-capability checks through the supported host workflow. Record exact versions, SHAs, receipts and cleanup; fixture tests are not live or production verification. Two independent reviews and integration-owner rollout checks remain required. Sync new canonical skills as a separately reviewed pin, verify file hashes and contracts, then repeat checks; preserve old pinned profiles for compatibility.

Official host references: https://developers.openai.com/codex/plugins, https://developers.openai.com/codex/skills, https://developers.openai.com/codex/mcp (checked 2026-11-21).

Run `python3 scripts/host-discovery-smoke.py` with Codex CLI on PATH to install into a temporary Codex home and check app-server skill discovery. This does not authenticate, execute an agent turn, or contact HTP or SEOsmith.
