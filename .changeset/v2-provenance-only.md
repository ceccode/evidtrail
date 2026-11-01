---
'@evidtrail/cli': major
'@evidtrail/core': major
'@evidtrail/metrics': major
---
2.0: provenance only. The cohort comparisons, the pre-1.0 follow-up fields and the AIDA-era names are gone

1.3 made provenance the product and moved the change signals to an appendix. What was left of the earlier tool either compared groups that are empty in most repositories, or kept numbers that no longer meant what their names said. 2.0 removes them rather than carrying them as dead weight that a reader could still mistake for findings.

**Removed from `metrics.json` (schema v3 → v4).** `persistence` (the AI cohort), `cohorts` (age and task mix), `byMode`, `fairComparison`, `byCategory`, `baseline`, `delta`; from every `persistence` block the pre-1.0 `avgDays`, `medianDays`, `buckets`, `censored` and `rework` (the 7-day rapid retouch under a second name); from the trend comparison `avgPersistenceDays` and `reworkRate`. The report loses By Autonomy Level, AI vs Baseline and Cohort Fairness. `repo.persistence.rapidRetouch`, the trend's `rapidRetouchRate`, outcomes, PR merges and line survival are unchanged. Readers refuse v3 artifacts with the usual message: re-run `evidtrail analyze`.

Why the comparisons went: in an all-agent repository the human side is empty and every table was a withheld section with an explanation. Where both sides exist, the gap between them reflects what each group worked on, and the fairness corrections (age cap, per-category split) narrowed that without closing it. The trend's observation cap went with them, and removing it exposed a 1.x disagreement: the cap cut observation at exactly 30×24 hours, while the repository table counts whole days, so a file touched again 30.5 days later was retouched in one table and not in the other. The trend now uses the repository's definition. Dogfooded against 1.3.1 on the same commit streams: llama.cpp gains 2–10 retouched files per month (2026-03: 456 → 466 of 1019; latest delta +1.02 → +0.97 pt), cda-tum/fiction gains 2 in one month (latest delta −7.57 → −8.00 pt), this repository is unchanged. Provenance, repository retouch rates and outcomes are identical on all three.

**`defaultMode` acts only at commit time.** The hook still stamps it. Analysis records it in `attribution.defaultMode` and applies it to nothing: commits with no evidence stay `unknown` and no number moves with the setting. `analyze --default-mode` is removed. The report says the setting was not applied, so a reader does not take it as covering those commits.

**AIDA-era names retired, as 1.2 announced.** The `aida` bin is gone, which also stops `npx @evidtrail/cli` from picking it and printing a rename notice in every Action run. The hook no longer reads `AIDA_MODE` or `.aida.json`; the CLI refuses a leftover `.aida.json` with the `git mv` that fixes it, instead of running unconfigured in silence; a leftover `aida-attribution.json` is reported, not applied; comments under `<!-- aida-metrics-report -->` are no longer updated. `AidaConfig` and `getDiffStats` (unused since collection moved to batched numstat) are no longer exported from `@evidtrail/core`.

**Action.** `cli-version` now defaults to `2`, and the generated workflow pins `@evidtrail/cli@2`. Pin `ceccode/evidtrail@v1` to stay on 1.x.
