# HTP and SEOsmith for Codex

A candidate Codex marketplace package is included; see [package instructions and release gates](docs/wave1-package.md). Feature #2 remains open pending live service acceptance. Historical v1 golden checks and additive readiness profiles are retained.

Run `npm run check` and `npm test` with Node 20+. No dependencies, credentials, or network are needed. See [compatibility and acceptance](docs/codex-compatibility.md).

The separate nine-file `contract/provider-request-1.1/` tree pins canonical HTP PR44 merge `e19875d0d6e74b5d990e45e456656c99dacc89d1` and backend PR45 merge `48485a55773b1ca97e165a4715d343704270266e`. Its shared skills are vendored source evidence, not installed Codex skills. The historical v1 lock and artifacts remain unchanged.

`node scripts/check-provider-request-readiness.mjs --provider-results path.json` validates all 27 lifecycle traces for Codex using the byte-identical canonical semantic validator. Inputs with measured context for every trace are labeled separately from synthetic fixture context; passing does not authenticate evidence provenance or prove live support. The CLI tests construct varied context offline; they do not collect measurements.

HTP activation requires deployed capability/input schemas and host acceptance. SEOsmith #18's initial adapter is completed; Live adapter configuration and lifecycle acceptance remain release gates for SEOsmith. Host OAuth and live operation acceptance remain open for both services.

Additive audit-export 1.2 readiness vendors canonical PR48 separately from the
immutable v1 and 1.1 baselines. `npm run check` covers all three profiles. Export
fixtures are offline synthetic evidence; installed skills, OAuth, package and live
host acceptance remain gated. Production tests remain paused; producer v2 stays off.
