# HTP and SEOsmith for Codex

A candidate Codex marketplace package is included; see [package instructions and release gates](docs/wave1-package.md). Package 0.3.0 adds the capability-gated `lifecycle-remediation` skill for contract profile 1.4.0 (vendored from HTP `09a0ba56c175e3e889bfa5a8eacff01666851e39`, `contract/parity-reads-1.4`) and a declared host minimum of Codex CLI 0.171.0 (`host-minimum.json`; not enforced by the host, enforced by this repository's scripts). Package 0.2.0 added a typed local SEOsmith stdio MCP binding whose default mode is truthfully unavailable until an operator configures `SEOSMITH_BIN` and a private `SEOSMITH_ROOT`. Feature #2 remains open pending live service acceptance. Historical v1 golden checks and additive readiness profiles are retained.

Run `npm run check` and `npm test` with Node 20+. No dependencies, credentials, or network are needed. See [compatibility and acceptance](docs/codex-compatibility.md).

The separate nine-file `contract/provider-request-1.1/` tree pins canonical HTP PR44 merge `e19875d0d6e74b5d990e45e456656c99dacc89d1` and backend PR45 merge `48485a55773b1ca97e165a4715d343704270266e`. Its shared skills are vendored source evidence, not installed Codex skills. The historical v1 lock and artifacts remain unchanged.

`node scripts/check-provider-request-readiness.mjs --provider-results path.json` validates all 27 lifecycle traces for Codex using the byte-identical canonical semantic validator. Inputs with measured context for every trace are labeled separately from synthetic fixture context; passing does not authenticate evidence provenance or prove live support. The CLI tests construct varied context offline; they do not collect measurements.

HTP activation requires deployed capability/input schemas and host acceptance. SEOsmith #18's initial adapter is completed; Live adapter configuration and lifecycle acceptance remain release gates for SEOsmith. Host OAuth and live operation acceptance remain open for both services.

Additive audit-export 1.2 readiness vendors canonical PR48 separately from the
immutable v1 and 1.1 baselines. Additive audit-read 1.3 readiness vendors the
merged HTP PR #82 revision `4e7dc94` (tree `36a945c`) as a separate gated tree and
lock. `npm run check` covers all four profiles. Export and read fixtures are offline
synthetic evidence; installed skills, OAuth, package and live host acceptance remain
gated. The two 1.3 reads are absent on the deployed 23-tool host (`unsupported`)
and return explicit `availability: producer_unavailable` only after the reviewed
25-tool source is deployed. Production tests remain paused; producer v2 stays off.
