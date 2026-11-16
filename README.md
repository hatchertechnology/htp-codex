# HTP and SEOsmith for Codex

Wave 0 readiness with historical v1 golden checks and additive 1.1.0 provider-request semantic checks. No installable plugin package is delivered here. Feature #2 remains open for Wave 1; historical #1 remains closed as not planned.

Run `npm run check` and `npm test` with Node 20+. No dependencies, credentials, or network are needed. See [compatibility and acceptance](docs/codex-compatibility.md).

The separate nine-file `contract/provider-request-1.1/` tree pins canonical HTP PR44 merge `e19875d0d6e74b5d990e45e456656c99dacc89d1` and backend PR45 merge `48485a55773b1ca97e165a4715d343704270266e`. Its shared skills are vendored source evidence, not installed Codex skills. The historical v1 lock and artifacts remain unchanged.

`node scripts/check-provider-request-readiness.mjs --provider-results path.json` validates all 27 lifecycle traces for Codex using the byte-identical canonical semantic validator. Inputs with measured context for every trace are labeled separately from synthetic fixture context; passing does not authenticate evidence provenance or prove live support. The CLI tests construct varied context offline; they do not collect measurements.

HTP activation requires deployed capability/input schemas and host acceptance. SEOsmith #18's initial adapter is completed; Codex adapter integration, live configuration and lifecycle acceptance remain release gates for SEOsmith. Installation, host OAuth and live operation acceptance remain open for both services.
