## What changes, and why

<!-- The why matters more than the what. Which wrong conclusion does this prevent, or which honest number does it make possible? -->

## Dogfood

<!-- Run it on this repository (and on one you do not own, if you can). Paste the before/after numbers. Bugs have been caught here that the test suite could not see. -->

| | before | after |
|---|---:|---:|
| | | |

## Checklist

- [ ] Branched directly off `main` (not stacked on another PR)
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test` pass
- [ ] Changeset added (`.changeset/*.md`) explaining the why
- [ ] Regression test says, in a comment, which wrong conclusion it prevents
- [ ] If a report changed: no two numbers in one document describe the same commits under different definitions without saying so
