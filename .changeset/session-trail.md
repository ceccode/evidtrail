---
"@evidtrail/core": minor
"@evidtrail/metrics": minor
"@evidtrail/cli": minor
---

Link commits to the agent session that produced them: an opt-in `AI-Session:` trailer and a `trail` command.

Git holds what an agent committed and nothing of what happened before. In a codebase written entirely by Claude, the errors were found and fixed inside sessions and "leave no trace in the commit history" (Between the Commits, arXiv 2609.29744). A tool that reads only git cannot reach that evidence. It can record where it is.

- cli hook: with `git config evidtrail.recordSession true` or `EVIDTRAIL_RECORD_SESSION=1`, AI commits get `AI-Session: <agent>/<id>`. Claude Code's `CLAUDE_CODE_SESSION_ID` is the transcript's file name; other agents can pass `EVIDTRAIL_SESSION`. Off by default and opted into per person, because a public history keeps every id forever and the sessions are the person's. It is not a `.evidtrail.json` key because evidtrail 1.2 and earlier reject unknown keys there and would stop working for anyone not yet upgraded.
- core: `sessionRef` parses the trailer and the stream carries `session` on commits that have one. `createProvenanceTagger` is the one place a commit's provenance is decided, now shared by `collect` and `trail`.
- metrics: `attribution.sessions` counts AI commits with a link and distinct sessions, over AI commits only so it sits next to the AI total without mixing sets.
- cli: `evidtrail trail <commit>` shows what a commit states, its session, and whether the transcript exists on this machine. It never opens the transcript. The report and the PR comment say how many AI commits are linked.
