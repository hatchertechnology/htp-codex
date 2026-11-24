---
name: seosmith-operations
description: Use for explicitly requested standalone SEOsmith audit start, status, cancellation, report or export.
---

# SEOsmith operations

Use the typed local MCP tools bundled with this plugin: `seosmith_capabilities`,
`seosmith_start`, `seosmith_status`, `seosmith_cancel`, `seosmith_report` and
`seosmith_export`. They invoke the operator-configured, trusted local SEOsmith
executable as an argv array with shell execution disabled, through the
`seosmith_local` stdio server. This is the standalone local CLI mode only and is
independent of HTP. A shell command or a user-supplied executable string is never
the binding; if the tools are unavailable, report that truthfully.

Call `seosmith_capabilities` first. It truthfully reports whether a trusted
executable and private root are configured and, when available, the exact
`adapter_version`, `transport`, operation IDs, limits, advanced gates and
delivery state. Require adapter_version 1, transport `local_cli`, and the exact
`seosmith.start`, `seosmith.status`, `seosmith.cancel`, `seosmith.report` or
`seosmith.export` capability before the corresponding operation. Missing
executable, unset or non-private root, timeout, invalid response, incompatible
version or absent operation means unavailable; do not substitute legacy
commands. Evidence v2, authorized staging and baseline CI require explicit
advertised capabilities and compatible contracts; do not invent flags. The
capability report pairs HTP orchestration and the private worker HTTP API as
separate modes: neither is provided by these local tools, and a supplied website
ID is not HTP authorization.

Start only on explicit request and with explicit URL, page/resource/duration/delay
limits and external-link choice. Create a fresh non-nil request UUID and a fresh
non-nil local website UUID; the binding derives a private per-audit database path
from the request UUID under the operator root, so do not supply database or file
paths. The website UUID and binding generation are local metadata and confer no
HTP access. Start is synchronous; supervise using the host's background facility.
Poll status with bounded frequency. On uncertainty retry only the identical request ID and payload in the same database, never a new ID automatically. Status does not resume a run. Unknown execution is unknown; partial or missing reports
are not clean audits.

Cancellation acceptance does not prove the worker stopped; require
`cancellation_terminal`. Retrieve retained original bytes via `seosmith_report`,
or `seosmith_export` to a new file inside the private per-audit directory, and
verify byte count and SHA-256 receipt. Preserve schema, outcome and coverage;
report delivery is disabled locally and distinct from crawl success. A partial
export file after failure is not a receipt.

Private worker HTTP is an independently configured operator-only mode, not this
adapter: follow the upstream operations documentation, protected network and
secret-store requirements. HTP orchestration requires separately discovered HTP
authorization and capabilities through its own MCP connection. Do not expose a
worker publicly or claim unavailable modes are active.
