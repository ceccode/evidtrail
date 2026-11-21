---
'@evidtrail/cli': patch
---
`analyze` and `collect` are thin commands over plain functions, and the GitHub comment provider has tests

Both commands kept their logic inside the commander callback, next to `process.exit`, so the only way to test it was to spawn a process or build a repository. `analyze` was one 200-line function with six copies of the same flag validation. Now each command parses its flags, calls `runAnalyze` / `runCollect`, and turns an error into an exit code; option parsing, the coverage warning and the summaries are functions with unit tests.

The GitHub comment provider had 12% line coverage while the GitLab one had tests: it now has its own (finds and updates its comment, redacts tokens from API errors). PR base detection had none and now has four.

No behaviour change, with one exception that only shows when two things are wrong at once: `analyze` now validates every flag before reading `pr-stream.json` and `blame-stream.json`, so an invalid flag is reported before a problem in those files. Dogfooded against 2.0.0 on frozen copies of three repositories: all 43 outputs are byte-identical.
