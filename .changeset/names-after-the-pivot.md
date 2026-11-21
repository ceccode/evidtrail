---
'@evidtrail/metrics': minor
'@evidtrail/cli': patch
---
Names say what is computed: `calculateRapidRetouch`, `RetouchSummary`, `RepoChangeSignals`

Since 2.0 the function called `calculatePersistence` computes only fixed-horizon rapid retouch, its result type `Persistence` holds only retouch counts, and `RepoQuality` describes change signals, not quality. A reader of the code took the old meaning from the names, which is the same mistake the report was rewritten to prevent.

`@evidtrail/metrics` exports the new names: `calculateRapidRetouch`, `RapidRetouchOptions`, `DEFAULT_RETOUCH_EXCLUDED_CATEGORIES`, `RetouchSummary`, `RepoChangeSignals`. The old names stay as deprecated aliases of the same values until the next major. The JSON fields `repo.persistence` and `trend.periods[].persistence` keep their names, because renaming a field is a schema change. Comments that still spoke of quality, survival or rework in the trend and schema now describe what the code measures.

No behaviour change: 51 dogfood outputs are byte-identical to 2.0.0.
