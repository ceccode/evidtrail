---
'@evidtrail/core': patch
'@evidtrail/metrics': patch
'@evidtrail/cli': patch
---
The six longest functions are compositions of named steps

`generateMarkdownReport` (250 lines), `collectCommits` (233), `calculateMetrics` (195), `createAITagger` (160) and `runDoctor` (160) each did several things in sequence, with comments acting as headings for the blocks. Every such comment marked a function waiting to be extracted. Now:

- the report is one render function per section, composed by `generateMarkdownReport`;
- `collectCommits` reads as empty-repo guard, shallow warning, range, membership, then `buildCommits`/`toCommit`; the date bounds are built once instead of twice;
- `calculateMetrics` composes `calculateAttribution`, `calculateRepoSignals` and `caveatsFor`;
- `createAITagger` is split into phases: compile the patterns, read the heuristic signal, settle the two axes;
- `runDoctor` runs one function per check.

No behaviour change. Dogfooded against 2.0.0 on frozen copies of three repositories plus a synthetic metrics file that reaches every report branch (PR outcomes, `--since`/`--until` notes, capped blame, outcome ratios, an unapplied `defaultMode`): all 51 outputs, including the verbose per-commit collect logs, are byte-identical.
