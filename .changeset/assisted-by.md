---
"@evidtrail/core": minor
"@evidtrail/cli": minor
---

Read and write `Assisted-by:`, the AI disclosure trailer the Linux kernel, Fedora and LLVM ask contributors to use.

Until now evidtrail only trusted its own `AI-Mode:` trailer. A commit where a person had written `Assisted-by: Claude` came out as "no evidence" unless the message also happened to name a tool in a sentence. On llama.cpp that was 367 commits: the people had disclosed, and the report said nobody had. The field is converging on `Assisted-by`, so a tool that only reads its own convention measures its own adoption, not provenance.

- core: `Assisted-by:` is declared evidence of involvement. The autonomy level stays `unknown` unless `AI-Mode:` states it, because a model name is not an autonomy level. A hand-written `Assisted-by:` outranks an `AI-Mode: none` stamped by a repo-wide prior.
- cli: the commit hook writes `Assisted-by: <tool>` next to `AI-Mode:` when AI took part and the tool is known (Claude Code, Cursor, or `EVIDTRAIL_AGENT`). With no known tool it writes no tool name. It never stamps `AI-Mode: none` next to a disclosure a person wrote.
