# AGENTS.md

Instructions for AI coding agents working on this repository. Humans: see [README.md](README.md).

## What this project is

evidtrail measures AI-assisted development from git history. Its whole value is that the numbers are **honest**, so the bar for a change here is not "does it work" but "can this number mislead someone who trusts it".

The guiding principle, learned the hard way: **a metric must never induce a wrong conclusion from arithmetically correct numbers.** An entire metric (merge ratio) was deleted rather than shipped misleading, and every external validation round has found a bug of exactly this shape.

## Setup

```bash
pnpm install     # `prepare` installs the commit hook automatically
pnpm build
pnpm test
```

Before any commit: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`. All four must pass.

## Commit provenance — this repo dogfoods itself

This repository is written almost entirely by AI agents with human review, and it measures itself with its own tool. That only works if commits declare their provenance:

- `.evidtrail.json` sets `defaultMode: "agent"`.
- The `prepare-commit-msg` hook stamps an `AI-Mode:` trailer automatically. It is installed by `pnpm install` via the `prepare` script — the same recipe the README recommends to everyone else.
- If you are an agent and the hook did not fire, set `EVIDTRAIL_MODE=agent` (or `assisted` / `autocomplete` / `none`) when committing. **Never stamp a mode that is not true**: a wrong declaration is worse than none, because `evidence: declared` is the strongest signal the tool has.
- Commits carry `Co-Authored-By: Claude <noreply@anthropic.com>` when Claude wrote them.
- `AI-Mode` describes how the committed content was produced, not who pressed `git commit`: agent-produced code remains `agent` when a human reviews, commits, or pushes it.

## Working agreements

- **Dogfood every change on this repo before opening a PR**, and put the before/after numbers in the PR body. Bugs have been caught this way that the test suite could not see — the `assumed`-cohort mismatch and the automated-mode miscount both surfaced in a dogfood run, not in CI.
- **Branch directly off `main`. Never stack a PR on another PR** — it silently stranded two PRs once and needed a recovery branch.
- Every change needs a **changeset** (`.changeset/*.md`) describing the *why*, not just the what.
- Regression tests must encode the bug's reasoning, not just its symptom. Comments in tests explain what wrong conclusion the test prevents.
- Merging and releasing are the maintainer's call.

## Things that look like bugs and are not

- **Empty cohorts are correct.** `No baseline cohort` on an all-AI repo is the tool being honest, not failing. Do not "fix" it by inventing a comparison.
- **A prior is not evidence.** During **analysis**, `defaultMode` moves cohort membership; it must never raise coverage, mutate historical commit tags, or create a report section on its own. At **commit time**, the installed hook may use the same repo policy to write an `AI-Mode` trailer for a new commit. Changing `.evidtrail.json` today never proves how an older untagged commit was produced.
- **The most recent trend period is always immature.** It is excluded from comparisons on purpose — without that, every report would find quality declining.
- **`unknown` is a real answer.** The absence of an AI signal is not evidence of human authorship.

## The recurring defect class

Watch for it in any change touching the report or the metrics: **two tables in one document describing the same commits under different definitions, without saying so.** Found four separate times — automated commits counted as hand-written, prior-filled cohorts contradicting observed counts, a survival rate whose numerator and denominator covered different file sets, and a cohort-scoped section under a repo-level heading. If two numbers can be read as the same thing, either make them the same or state the difference where the reader sees it.
