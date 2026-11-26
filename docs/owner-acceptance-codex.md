# Owner-attended acceptance for the Codex package (plan 6.2 and R5)

Prepared, **not run**, by the package author. These checks need the owner's attention, a trusted SEOsmith binary or a live
session. Nothing here is evidence until the owner records it. The approval policy is not changed or bypassed; each tool
approval is the owner's (`wave1-release-codex-host.md` constraints). Use bounded, identifiable test data and never paste
tokens or customer data into a record.

## 0. Before R5 (read-only)

1. Re-read the owner's default `~/.codex` plugin cache: it is expected to hold **no htp-codex install** (the separate remote
   "htp" 1.1.0 plugin is unrelated and is not touched). If it differs, stop and re-derive the rollback target.
2. Create the anchor `baseline-pre-r5-aee2b776` on `aee2b776c839c9569599513a9695f68e03e765c5` and `v0.2.0` on
   `9f35b9f60714f6e3ddf21bd27595d0b7c461af2e`; verify each manifest version at its commit (both 0.2.0). The release tag `v0.3.0`
   goes on the merged release commit only after `npm test`, `npm run check` and `python3 scripts/host-mcp-smoke.py` pass there.
   Re-run `node scripts/rehearse-release-codex.mjs --root <new dir> --target <merged sha>` at that commit.

## 1. Isolated install of the published ref

```
node scripts/prepare-owner-acceptance-codex.mjs --root /mnt/storage/worktrees/<new dir> --ref v0.3.0
```

It adds the GitHub marketplace at the ref into a fresh `CODEX_HOME` (file-backed OAuth store, private `SEOSMITH_ROOT` mode 0700),
installs `htp@htp-codex`, checks the installed version, writes `results.template.json` and prints the owner's commands. It starts
no agent turn and makes no HTP call.

## 2. Interactive session (owner attended, plan 6.2)

| # | Check | Pass when |
| --- | --- | --- |
| 1 | Skill and tool discovery in the session | Five HTP skills and six `seosmith_local` tools are visible |
| 2 | `seosmith_capabilities` with `SEOSMITH_BIN` unset | `available: false`, `adapter_not_configured`; lifecycle tools fail closed |
| 3 | Configure the trusted `SEOSMITH_BIN` and the private root, then `seosmith_capabilities` | `adapter_version` 1, `transport` `local_cli`, five operations |
| 4 | `seosmith_start` on one owned URL, bounds `max_pages` ≤ 25, `max_duration_seconds` ≤ 120, `delay_ms` ≥ 1000 (owner approves the call) | A request ID and a status; no shell is used |
| 5 | `seosmith_status`, then `seosmith_cancel` on a second bounded run | Terminal state reported; cancellation confirms no active worker |
| 6 | `seosmith_report` and `seosmith_export` for the finished run | Byte counts and SHA-256 receipts equal the adapter receipt |
| 7 | HTP side (optional, separate): `codex mcp add htp --url https://htp-api-kerry-hatcher.fly.dev/mcp/secured`, `codex mcp login htp`, an owned saved read, a non-owned website denial, `codex mcp logout htp` | Denial is a 403-class result, never an empty success |
| 8 | Discovery of export-v1, report-request, `website_audit_events`/`website_operational_episodes` and the three 1.4 reads | Missing tool is `unsupported`; a held read (`unavailable`, 503) is held, not empty |

Save the transcript in `coordination/tasks/w1c-codex-release.md`, then remove the disposable profile (the script deletes nothing).

## 3. R5 on a host where htp-codex is installed

Upgrade by `codex plugin marketplace upgrade htp-codex` and `codex plugin add htp@htp-codex` (a moving ref), or switch refs with
`plugin remove`, `marketplace remove`, `marketplace add --ref <tag>`, `plugin add`. Rollback to `baseline-pre-r5-aee2b776` (or
`v0.2.0`) is the same switch with that ref, as rehearsed in `scripts/rehearse-release-codex.mjs`. Compare the installed tree with
the reviewed tree and restart Codex if discovery does not refresh. The owner's default home has no htp-codex install, so there is
nothing to roll back there.
