---
name: seosmith-operations
description: Use for explicitly requested standalone SEOsmith audit start, status, cancellation, report or export.
---

# SEOsmith operations

This is a local adapter workflow, independent of HTP. Use a trusted operator-configured absolute executable; do not search the working directory or execute a user-supplied command string. Consult the installed SEOsmith operations documentation for the exact request schema and limits. Run subprocesses as argv arrays with shell execution disabled. Never include credentials in URLs, arguments, request files, logs or reports.

First invoke the executable with `operations capabilities`. Require `adapter_version` 1, `transport` local_cli, and the exact `seosmith.start`, `seosmith.status`, `seosmith.cancel`, `seosmith.report` or `seosmith.export` capability before the corresponding operation. Missing binary, timeout, invalid response, incompatible version or absent operation means unavailable; do not substitute legacy commands. Evidence v2, authorized staging and baseline CI require explicit advertised capabilities and compatible contracts; do not invent flags.

Start only on explicit request and with explicit URL, page/resource/duration/delay limits and external-link choice. Create a fresh UUID and a fresh absolute database path in an operator-private directory for each intended audit. The request includes a separate non-nil local website UUID and binding generation; these confer no HTP access. Start is synchronous; supervise using the host's background facility. Poll status with bounded frequency. On uncertainty retry only the identical request ID and payload in the same database, never a new ID automatically. Status does not resume a run. Unknown execution is unknown; partial or missing reports are not clean audits.

Cancellation acceptance does not prove the worker stopped; require `cancellation_terminal`. Retrieve retained original bytes via report, or export to a new private path and verify byte count and SHA-256 receipt. Preserve schema, outcome and coverage; report delivery is disabled locally and distinct from crawl success. A partial export file after failure is not a receipt.

Private worker HTTP is an independently configured operator-only mode, not this adapter: follow the upstream operations documentation, protected network and secret-store requirements. HTP orchestration requires separately discovered HTP authorization and capabilities; a supplied website ID is not authorization. Do not expose a worker publicly or claim unavailable modes are active.
