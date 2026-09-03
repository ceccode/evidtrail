# Contributing to evidtrail

Thanks for looking. evidtrail's whole value is that its numbers are honest, so the bar for a change is not "does it work" but **"can this number mislead someone who trusts it?"** Everything below follows from that.

## Setup

```bash
pnpm install     # `prepare` installs the commit hook automatically
pnpm build
pnpm test
```

Before any commit: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`. All four must pass.

## The kind of bug we want to hear about most

A number that was **arithmetically correct and still led you to a wrong conclusion**. Every external validation round of this project has found one — a survival rate whose numerator and denominator covered different file sets, two tables in one report describing the same commits under different definitions, a prior-filled cohort rendered as a measurement. If a report made you believe something the repository does not support, that is a bug even if every digit is right. Use the "Misleading number" issue template.

## How we work

- **Dogfood before you open a PR.** Run the change on this repository (and, if you can, on one you do not own) and put the before/after numbers in the PR description. Bugs have been caught this way that the test suite could not see.
- **Branch off `main`. Never stack a PR on another PR.** It silently stranded two PRs once and needed a recovery branch.
- **Every change needs a changeset** (`.changeset/*.md`) that explains *why*, not just what.
- **Regression tests encode the bug's reasoning**, not just its symptom. A comment in the test says what wrong conclusion it prevents.
- Merging and releasing are the maintainer's call.

## Commit provenance

This repository measures itself with its own tool, so commits should say how they were produced. The hook installed by `pnpm install` stamps an `AI-Mode:` trailer automatically when it detects an agent session. If it did not fire, set `EVIDTRAIL_MODE=agent` (or `assisted` / `autocomplete` / `none`) when committing. **Never stamp a mode that is not true** — a wrong declaration is worse than none. Agent-written commits carry `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Things that look like bugs and are not

- **Empty cohorts are correct.** `No baseline cohort` on an all-AI repo is the tool being honest. Do not "fix" it by inventing a comparison.
- **A prior is not evidence.** `defaultMode` moves cohort membership; it must never raise coverage, mutate commit tags, or create a report section on its own.
- **The most recent trend period is always immature.** It is excluded from comparisons on purpose.
- **`unknown` is a real answer.** Absence of an AI signal is not evidence of human authorship.

See [AGENTS.md](AGENTS.md) for the version of these rules addressed to coding agents.
