---
'@aida-dev/cli': minor
---

`aida init`, `aida doctor`, and `aida` with no arguments — the first ten minutes, fixed

Adoption dies in the first ten minutes. Before this, a team had to write `.aida.json` by hand, remember `install-hooks` in every clone, copy a 99-line workflow, and learn that `collect → analyze → report` is a pipeline before seeing a single number. Each step was small; together they were the reason a tool gets evaluated on a laptop and never reaches CI.

- **`aida init`** — the whole setup in one command: a starter `.aida.json` (no prior unless `--default-mode` is passed; an assumption is opted into, not defaulted), the commit hook for this clone, `"prepare": "aida install-hooks --if-git"` for every other clone, and `.github/workflows/aida.yml` — npm-based, `fetch-depth: 0`, `--redact-authors`, minimal permissions, comment upserted by `gh` in its own step so the write token never meets PR-built code. **Never overwrites**: a file or script that exists is reported and left alone, so re-running is free and a hand-tuned setup is never clobbered.
- **`aida doctor`** — every way a run can be quietly wrong, asked before the run: shallow clone (blocking — the classic confidently-wrong CI report), partial clone, missing `origin/HEAD`, invalid or retired-key `.aida.json` (blocking, same fail-fast as `analyze`), hook missing in *this* clone, no `prepare` script, no CI workflow. Each non-green line carries its one-line fix. Exit code is non-zero only for blockers, so it is safe inside `prepare`. `--json` for scripts.
- **`aida`** with no subcommand runs `collect → analyze → report`. The granular commands stay for CI and for anyone who wants one stage at a time.

Hook installation moved from the command body into `hooks/install.ts` so `init` and `install-hooks` share one implementation; `install-hooks` is now a thin wrapper and reports "already installed" instead of silently rewriting an identical hook.
