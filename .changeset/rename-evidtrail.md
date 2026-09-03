---
'@evidtrail/cli': minor
'@evidtrail/core': minor
'@evidtrail/metrics': minor
---

AIDA Metrics is now **evidtrail**. Same tool, same numbers, one name that survives a search.

Why: "AIDA" is the marketing funnel, an opera and a system-diagnostics product — a search for it never found this project — and its expansion, "AI Development Accounting", promised the cost-and-value reading the 1.0 contract explicitly refuses. The new name says what the tool keeps: a trail of evidence, followed backwards, never a proof.

What changes for a repository that already uses it — every old name keeps working for this release, with a one-line notice pointing at the new one:

| Before | Now | Old name |
|---|---|---|
| `npm i -g @aida-dev/cli` | `npm i -g @evidtrail/cli` | deprecated on npm, points here |
| `aida …` | `evidtrail …` | `aida` stays as an alias, notice on stderr |
| `.aida.json` | `.evidtrail.json` | still read; `doctor` and `init` ask for `git mv` |
| `AIDA_MODE` | `EVIDTRAIL_MODE` | still honoured by the hook when the new one is unset |
| `aida-attribution.json` | `evidtrail-attribution.json` | still read, with a warning |
| `./aida-output` | `./evidtrail-output` | default output directory |
| `<!-- aida-metrics-report -->` | `<!-- evidtrail-report -->` | comments under the old marker are found and replaced, never duplicated |
| hook marker `aida-metrics mode stamp` | `evidtrail mode stamp` | old hooks recognised as ours and upgraded in place |
| `uses: ceccode/AIDA-Metrics@v1` | `uses: ceccode/evidtrail@v1` | GitHub redirects the repository |

The `AI-Mode:` commit trailer is unchanged: it never carried the tool's name, so the provenance already written into your history stays valid as is.

Nothing in this release changes what the tool computes.
