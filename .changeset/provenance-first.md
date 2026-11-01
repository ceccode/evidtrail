---
"@evidtrail/cli": minor
---

Provenance first: a `verify` command for CI, and a report that leads with what git can answer.

The report used to open on the repository retouch rate and its trend. Readers took that first number as the verdict on AI-written code, which git cannot give: mistakes an agent finds and fixes inside its session, before the commit, leave no trace in history. What git can answer is what each commit states about how it was produced.

- report: **Provenance** opens the report (coverage, declared vs inferred, the autonomy table). Everything that measures what happens after a commit moves under **Change Signals**, which states that limit before any number. No figure changes; only order, headings and the framing sentence. Data Quality and Autonomy are merged into Provenance.
- `evidtrail verify`: fails when collected commits do not state their provenance, in the spirit of a DCO check. `--require declared` (default) needs AI-Mode or the manifest; `--require evidence` accepts any signal. `AI-Mode: none` passes, merge commits and bots are skipped, and a `defaultMode` prior never passes. Exit 1 means commits lack provenance, exit 2 means the check could not run.
- action: new `require-provenance` input runs `verify` on pull requests after the comment is posted.
