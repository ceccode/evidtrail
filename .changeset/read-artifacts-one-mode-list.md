---
'@evidtrail/core': minor
'@evidtrail/metrics': patch
'@evidtrail/cli': patch
---
One reader for versioned artifacts, one list of autonomy modes

The same four steps, read the JSON, check `schemaVersion`, parse the schema, name the command to rerun, were written out five times across `analyze`, `report` and `verify`. The four declarable modes were spelled out by hand in five schemas, and the commit tags were defined twice, once for commits and once for pull request commits. A change to either had to be made in every copy, and a missed copy would have let two readers disagree about the same file.

`@evidtrail/core` now exports `readVersionedJSON`, `DECLARABLE_MODES`, the `DeclaredMode` and `AIMode` schemas, and `CommitTags`. The CLI reads its artifacts through one function per file. No behaviour changes: dogfooded against 2.0.0 on frozen copies of three repositories, all 43 outputs (reports, metrics, streams, `verify`, `trail`, `doctor`, the PR comment and the version-gate errors) are byte-identical.
