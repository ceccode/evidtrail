# @aida/core

## 1.0.1

### Patch Changes

- 4dc9ed7: Upgrade `simple-git` to the patched 3.36.0 release for its remote-command execution advisories. Reject option-shaped default-branch and PR base refs before they reach Git, so CLI or CI input remains data rather than command options.

## 1.0.0

### Major Changes

- 9f61a36: Establish the 1.0 measurement contract: default to default-branch ancestry, bind artifacts to a repository snapshot, report fixed-horizon rapid retouch with explicit censoring, harden untrusted Git paths and configuration, make analysis deterministic, and label incomplete PR evidence. PR reports now focus on the change set, identify commits missing provenance, and omit time-based tables that cannot be interpreted on fresh work. The repository's prepare bootstrap installs the canonical provenance hook before the CLI is built, closing the clean-clone gap that silently produced `unknown` commits. The breaking schema changes are intentional so older artifacts cannot be read under the new meanings.

## 0.18.0

### Minor Changes

- 3c7bdb5: Autonomy becomes the primary axis: involvement × evidence, three-state attribution demoted to a projection (#25)

  For most teams today AI participates in nearly every commit, so "was AI involved?" trends to _yes_ and stops discriminating anything. What still separates risk, cost and quality is **at what autonomy level**. This makes that the model rather than a field alongside the old one.

  **Two orthogonal axes.** `mode` (`none`/`autocomplete`/`assisted`/`agent`/`unknown`) is what happened; `evidence` (`declared`/`inferred`/`none`) is how we know. They are separate because they fail separately: `mode: unknown, evidence: inferred` is a real state — we know AI participated, we cannot name the level — and the single-axis model had to misreport it as "no evidence", contradicting the `ai` it had just asserted.

  **`attribution` is now derived.** `projectAttribution` is the only place the three states are decided, and a tag can only be built through `tagFromAxes`, so the projection cannot drift from the axes it projects. The headline still reads `ai`/`human`/`automated`/`unknown`, labelled as the projection it is. `unknown` is no longer a fourth kind of attribution: it is exactly `evidence: none`, an invariant now covered by tests in both directions.

  **Coverage moved to the evidence axis** — the share of commits with any known provenance, declared or inferred. Numerically near-identical to the old `(ai + human + automated) / total` (on babel: 8.7% either way), because automation already carries inferred evidence. The reframe is honest, not a redefinition that flatters the number.

  **`automated` is its own flag**, orthogonal to both axes: known provenance, no author, joins no cohort. The redundant `ai` boolean is gone.

  **Breaking — `defaultAttribution` is replaced by `defaultMode`.** The prior now names an autonomy level instead of an AI/human label, and one key covers both moments: the commit hook stamps it at commit time (making new commits `declared`), while `aida analyze` applies it as a prior to older commits with no evidence. A prior joins a cohort but is never evidence — it does not touch the tags and does not raise coverage, so a repo leaning on it still reports how little it knows. Because zod strips unknown keys, a config still carrying `defaultAttribution` would silently stop applying and change cohorts on upgrade; `.aida.json` is now rejected with the translation in the message. `--default-attribution` becomes `--default-mode`.

  Schema v2 for both `commit-stream.json` and `metrics.json`: rerun `aida collect`.

  Dogfooded on this repo: 137 commits, coverage 100% (declared 72 · inferred 65), 100 agent · 37 automated. That run also caught a bug introduced here — the headline table counted automation's `mode: 'none'` as hand-written, contradicting `byMode`, which excludes it. Per-mode counts now exclude automated commits and the report lists them on their own row.

## 0.17.1

### Patch Changes

- 36dd0fb: Fix three correctness bugs found by running AIDA against a large monorepo

  Validated against babel/babel (18,851 commits, 28,732 tracked files) — the scale profile the first two external repos were missing. The two suspected failure modes (a 64MB `maxBuffer` ceiling, and blame being unusably slow) both turned out to be non-issues; what the run actually found were three ways of reporting a wrong number confidently.
  - **An unnamed bot co-author is no longer read as AI.** The `Co-authored-by:.*bot.*` trailer rule treated "a bot participated" as "AI wrote this" — two different claims. On babel, 47 of 52 "AI" commits were ordinary PRs co-authored by _Babel Bot_, the project's own release and formatting bot; the rule was also unanchored, so any human whose name merely contains "bot" matched. A co-author must now name a known AI tool or AI domain. Precision went 5/52 → 8/8, and recall improved too: the tool-name rule catches `Copilot <copilot@github.com>` and `Copilot Autofix`, which the old `*bot*` rule missed. This also establishes an invariant worth keeping — a trailer-detected AI commit now always has a known autonomy mode, where all 47 false positives had `mode: unknown`. The tagger already knew it could not name a tool, and asserted AI anyway.
  - **The line-survival denominator now covers the same files as the numerator.** `approxSurvivalRate` divided AI lines surviving in the blamed files by AI lines added across the _entire_ history. Since blame never covers the whole tree — generated files are excluded, `--max-files` caps the walk — the two halves described different repos. On babel, `aida blame --max-files 500` over 28,732 files reported **"1.7% of AI-introduced lines survive"**: 453 files' worth of survivors over the whole history's worth of additions. Arithmetically correct, and it told the reader that AI code gets deleted when it actually said the sample was 1.6% of the tree. `BlameStream` now carries `blamedPaths` (schema v2) and the denominator is scoped to it.
  - **`--max-files` now samples the tree instead of its first corner.** It took the first N paths in `git ls-tree` order, which is path order. On babel, `--max-files 500` never got past `packages/babel-c*` and drew 183 of its 500 files from a single package — then the report called it "a sample". Selection now strides evenly across the candidate list, staying fully deterministic.

  Also: **a failing `git blame` is no longer indistinguishable from a binary file.** Errors were absorbed into `filesSkipped`, so a run that failed on half the tree read as a clean run with some binaries in it. They are now counted in `filesFailed`, warned about with the first error, and surfaced in the report. This is the path a `maxBuffer` overflow would have taken: silently missing lines rather than a failure. The overflow itself proved unreachable — `git blame --incremental` emits one line per chunk rather than per line, so babel's worst file produced 78KB against the 64MB cap, and `ls-tree` and `diff --numstat` peaked at 2.7MB.

- 68be0d3: Report the git diagnosis instead of the whole git output when a command fails

  A failing git command puts its entire output in the error message — simple-git and `child_process.exec` both do. On a large repo that is not a message but a data dump: a broken `git log --numstat` over babel printed **22MB of per-file statistics**, with the one line that explained the failure (`fatal: unable to read <object>`) buried somewhere inside it. Found while validating against babel, where diagnosing a bad clone took far longer than it should have.

  git puts its diagnosis on lines prefixed `fatal:` or `error:`, so `describeError` keeps those and drops the rest; when there are none it truncates at 1500 characters and says how much was omitted. Applied at every CLI command's top-level catch. The same 22MB failure now reads as a single line.

  Matters most in CI, which is where AIDA is meant to run and where nobody scrolls back through a megabyte of log to find the cause.

## 0.17.0

### Minor Changes

- 8e7aaee: Age-normalized fair comparison (#29), within-category comparison (#36), outcome correlation (#26)

  **Fair comparison (#29)** — the raw AI vs Baseline table can be misleading when one cohort's commits are systematically older than the other's: an older cohort accumulates persistence simply from clock time. `metrics.json` gains `fairComparison`, recomputing both cohorts' persistence with each file's observation window capped to the younger cohort's average commit age. Reported alongside the raw comparison, never in place of it; null under the same condition as `baseline`.

  **Within-category comparison (#36 step 2)** — a pooled delta can hide a task-mix confound (AI mostly writing tests, humans mostly writing source). `metrics.json` gains `byCategory`: persistence per file category (source/tests/migrations/config/docs/generated) for each cohort, with a delta only where both sides touched that category. Always present, useful even without a baseline.

  **Outcome correlation (#26)**, scoped to what git can answer — no incidents, no SAST, both would need network access this tool deliberately doesn't have:
  - `commit-stream.json`: new `revertsCommit` field, parsed from the full commit body at collect time (`git revert` writes "This reverts commit \<sha\>." — the only reliable link back to what was reverted).
  - `metrics.json` gains `outcomeCorrelation`: reverts resolved and attributed to the **reverted** commit's cohort/mode; hotfix-pattern commits (`fix`/`hotfix`/`patch`) linked to the closest prior touch of the same file(s) within a window (default 7 days, `--hotfix-window`) and attributed to that antecedent's cohort/mode. Always present, a repo-level property rather than a cohort comparison.

  All three fields are additive; `schemaVersion` stays unchanged per the #53 contract.

### Patch Changes

- 672edff: Fix three correctness bugs found by running AIDA against an external repository

  Validated against commander.js (1,517 commits, 2011–2026) — the first repo other than this one AIDA had ever analysed. All three would have produced confidently wrong numbers on someone else's project.
  - **`github.com` removed from AI trailer domains.** `@users.noreply.github.com` is the default email of every GitHub account, so any commit co-authored through the web UI was flagged as AI. On commander.js, 2 of 3 "AI" detections were ordinary humans. AI bots hosted on GitHub are still caught by the `*bot*` rule, verified against the real `copilot-swe-agent[bot]` trailer.
  - **Shallow clones now warn.** `actions/checkout` defaults to `fetch-depth: 1`, so AIDA would happily report on a single commit as if it were the whole history. Detected via `git rev-parse --is-shallow-repository`; both CI examples in the README now set `fetch-depth: 0` / `GIT_DEPTH: 0`, which was the upstream cause.
  - **Empty repositories no longer crash** with a raw `fatal: ambiguous argument 'HEAD'`; `collect` returns a valid empty stream and the whole pipeline runs through.

  Also: `copilot-swe-agent[bot]` (GitHub's autonomous coding agent) is now inferred as `agent` rather than `autocomplete` — it was matching the generic `copilot` rule first, which inverted exactly the distinction #25 exists to measure.

## 0.16.0

### Minor Changes

- 7586eed: Line-level survival via `aida blame` (#23)

  Exact per-line attribution, replacing the file-level proxy as the precise measure: of the lines alive in the tree right now, which commit last wrote each one, and at what autonomy level. One AI line in a thousand no longer marks a whole file.
  - **New `aida blame` command** writes `blame-stream.json` (schema v1) with per-commit surviving line counts — compact, one entry per commit rather than per line. Kept opt-in and separate because it runs one git process per file; `collect` stays fast.
  - **`aida analyze` picks it up when present**: `metrics.lineSurvival` reports lines alive by attribution cohort and by autonomy mode, plus the AI share. Absent without the file, with a caveat pointing at the command.
  - **Binary files are detected and excluded** via a single `git diff --numstat` against the empty tree. `git blame` does not fail on binaries — it reports the whole blob as one line — so they would otherwise have added phantom lines to the totals.
  - Blame runs with `-w`, so reformatting does not reattribute lines to whoever ran the formatter. `--max-files` bounds the walk and flags the result as a sample; lines from commits outside the collected window are reported separately rather than folded into `unknown`.

  Share figures are exact for the living codebase. The derived survival rate of AI-introduced lines is explicitly approximate: blame cannot see deleted lines, and a line rewritten twice was added twice.

## 0.15.0

### Minor Changes

- 328b64d: Commit-time mode stamping via git hook (#61)

  The attribution manifest (#10) declares provenance retroactively; this declares it at the source, turning `declared` evidence from the exception into the norm — the prerequisite for making autonomy the primary axis (#25 step 3).
  - **`AI-Mode:` trailer** (`none` | `autocomplete` | `assisted` | `agent`) parsed as `mode` with `modeEvidence: declared`, beating tool inference. `AI-Mode: none` is the first mechanism that declares _human_ authorship at commit time, without a manifest.
  - **`aida install-hooks`** writes a `prepare-commit-msg` hook: self-contained POSIX shell (no dependency on `aida` at commit time), idempotent, refuses to overwrite a hook it didn't write unless `--force`, `--uninstall` removes only its own marked block, and it can never block a commit.
  - **Mode resolution**: `AIDA_MODE` env var → known agent environment detection → `defaultMode` in `.aida.json` → nothing. An unknown mode writes no trailer: absence honestly means unknown, a guess would be a fabricated declaration.

## 0.14.0

### Minor Changes

- 6141aef: PR acceptance rate via forge APIs (#51)

  The honest successor to the merge ratio removed in #20. Git history cannot say whether work was accepted — squash merges and deleted branches erase discarded work — but a forge never deletes a closed pull request.
  - **New `aida fetch-prs` command**: fetches closed PRs (merged and closed-unmerged) from the GitHub API into `pr-stream.json` (schema v1). It is the _only_ command that touches the network, kept separate on purpose so `collect` stays git-only and offline.
  - **`aida analyze` picks it up when present**: `metrics.json` gains `prAcceptance` with acceptance rates overall, per attribution cohort, and per autonomy mode. Absent without the file — with a caveat pointing at `fetch-prs`, never a silent 0%.
  - **Attribution from the PR's own commit messages** as returned by the API, not from a join against local git: this is what makes it work for squash-merged PRs whose branches no longer exist.
  - **No author identity is fetched or stored** — PR numbers, outcomes, dates, and commit attribution only (#35).
  - Bounded API usage via `--since` and `--max-prs`; a capped fetch is flagged `truncated` and carries a caveat. Rate-limit exhaustion produces a distinct, actionable error.

## 0.13.0

### Minor Changes

- 6ae4bad: Version the output schemas + end-to-end CLI tests (#53)

  `commit-stream.json` and `metrics.json` now carry a `schemaVersion` (both v1). The shape of these files changed six times in three days and a consumer had no way to detect it — a stale file parsed against a newer schema yields silent `undefined`s, not an error.
  - **Contract**: additive changes don't bump the version; removing a field, renaming it, or changing its meaning does. Documented in the README, replacing the previous (untrue) "stable JSON schemas" claim.
  - **Readers refuse what they don't understand**: `aida analyze` and `aida report` check the version before schema parsing and fail with an actionable message (`Rerun 'aida collect'`) instead of a zod dump or a half-parsed result. Pre-versioning output is named as such.
  - **End-to-end CLI tests**: the `collect → analyze → report → comment --dry-run` pipeline is now covered on a fixture repo (CLI package went from 1 test to 7), including the version gate and `--redact-authors`.
  - **`pnpm typecheck`**: new script (wired into CI) that typechecks tests too. It immediately caught pre-existing type errors in test fixtures that had been invisible, since vitest transpiles without checking.

## 0.12.0

### Minor Changes

- 4598854: Author redaction (#35) and synthetic PR merge commit fix (#40)

  **Author redaction** — `aida collect --redact-authors` (or `redactAuthors: true` in `.aida.json`) replaces author/committer names and emails in `commit-stream.json` with a per-run salted hash: stable within one output file so identities can still be grouped, but not reversible to a person and not correlatable across runs. Redaction runs after identity-based detection (bots, #39), so it costs no accuracy. Recommended in CI, where the stream is uploaded as an artifact.

  **Synthetic PR merge commit** — in PR-scoped mode (`--pr` / `--diff-base`), the merge head that `actions/checkout` creates for `pull_request` events (`Merge <sha> into <sha>`, authored by nobody) is skipped. It was inflating commit counts and coverage percentages on every PR comment — a 1-commit PR read as 2 commits. Standard time-windowed collection is unchanged: real merge commits are still collected and classified `automated`.

## 0.11.0

### Minor Changes

- ddd86aa: 'automated' as fourth attribution state (#39)

  Merge commits and bot-authored commits are automation, not authored code — their provenance is known, yet they landed in `unknown`, dragging coverage down forever (and decaying it with every release) or getting pulled into cohorts by `defaultAttribution` priors.
  - New attribution state `automated`: auto-detected at collect time (merge commits via parent count, bots via the #21 blocklist matched against author/committer identity) or declared via manifest `excluded_commits`. In-commit AI evidence and manifest ai/human declarations always win over the structural heuristics.
  - Coverage now counts `automated` as known provenance: `(ai + human + automated) / total`.
  - Automated commits join no cohort and priors never touch them; they carry `mode: none`.
  - Report and logs show the automated count; the `defaultAttribution` prior note is hidden when there are no unknown commits left.

  Breaking for `metrics.json`/`commit-stream.json` consumers: attribution enum gains `automated`; the attribution block gains a required `automated` count.

## 0.10.0

### Minor Changes

- 0f4fb0d: Attribution manifest support (#10)

  `aida collect` now reads an optional `aida-attribution.json` at the repo root to apply retroactive, explicit attribution declarations on top of message heuristics:
  - `ai_assisted_commits` → attribution `ai`, level `explicit`, source `manifest`
  - `human_authored_commits` (new) → attribution `human` — the first way to build a real human baseline for the three-state model
  - `excluded_commits` → forces attribution `unknown`, overriding heuristics (for automation such as release bots and merge commits)

  Precedence: in-commit evidence beats retroactive declarations — a commit with an explicit AI signal stays `ai` even if declared human (with a warning); `excluded_commits` always wins. Invalid manifests log a warning and are ignored; they never fail `collect`. Manifest hashes that match no collected commit are reported informationally.

- 690fc53: Autonomy mode collection (#25, step 1)

  First step of the involvement × evidence model. Every commit now carries:
  - **`tags.mode`**: `none` | `autocomplete` | `assisted` | `agent` | `unknown` — what level of AI participated. The durable axis in an AI-first world.
  - **`tags.modeEvidence`**: `declared` (manifest `mode` field — top-level default or per-entry override) | `inferred` (derived from the tool named in trailers: Claude Code/Claude → agent, Copilot → autocomplete, Cursor/Windsurf/Codeium/ChatGPT/Gemini → assisted) | `none` (no signal).

  Manifest-declared human commits get `mode: none, declared`. `metrics.json` reports per-mode and per-evidence counts in the attribution block; the report shows an Autonomy line under the coverage headline. Per-mode cohort metrics are step 2.

## 0.9.0

### Minor Changes

- 5ddbaf4: Attribution coverage as headline metric (#34)

  Three-state attribution replaces the silent AI/human binary:
  - Every commit is attributed `ai`, `human`, or `unknown` (`tags.attribution`). Message heuristics emit only `ai` or `unknown`: the absence of an AI signal is not evidence of human authorship. `human` will come from explicit declarations (attribution manifest, #10).
  - `metrics.json` gains a leading `attribution` block with per-state counts and **coverage** — the share of commits with known provenance — plus a configurable `coverageThreshold` (default 0.7) that flags all metrics as low-confidence when coverage falls below it.
  - `baseline` and `delta` are now nullable: when no commits are attributed `human` and no prior assigns the unknowns, AIDA reports "no baseline" instead of silently comparing AI commits against unattributed ones.
  - New `defaultAttribution` option (`.aida.json` or `aida analyze --default-attribution`) consciously assigns unknown commits to a cohort (`human` for traditional repos, `ai` for AI-first ones). The prior affects cohorts, never coverage; an assumed baseline is labeled `assumed` in output and report.
  - The markdown report opens with an "Attribution Coverage" section and a warning banner when coverage is below threshold.

  Breaking (0.x minor): `commit-stream.json` requires the new `tags.attribution` field — rerun `aida collect`. `metrics.json` consumers must handle `baseline: null` / `delta: null` and the renamed baseline semantics (human cohort, not "non-AI").

- 9130689: Git data accuracy (#24):
  - Real committer name/email/date are now collected via a custom `git log --format` (previously duplicated from author fields, wrong after rebase/squash).
  - Commit metadata, parents, and diff stats are fetched in two batched `git log` passes instead of two git processes per commit — collection is dramatically faster on large repos.
  - Removed the misleading `branch` field from the `Commit` schema: it was always set to the default branch, even for commits collected from other branches.
  - New caveat documents that time-windowed collection (`--since`) also windows the ancestry check.

## 0.8.0

### Minor Changes

- 938a72d: Exclude non-AI automation bots from `Co-authored-by` trailer matching. Commits from `dependabot`, `renovate`, `github-actions`, `greenkeeper`, `snyk-bot`, `mergify`, `imgbot`, and `allcontributors` are no longer miscounted as explicit AI contributions.

  The blocklist is extensible via `botBlocklist` in `.aida.json` and the new `--ai-bot-blocklist` CLI flag.

  Also fixes PR-scoped collection (`--pr` / `--diff-base`) in CI checkouts: the default-branch commit set is now computed against the diff base ref (e.g. `origin/main`) instead of the bare branch name, which is unresolvable in a detached PR checkout.

## 0.7.0

### Minor Changes

- ### Performance & Quality Improvements
  - **Fix N+1 git operations**: `getDiffStats` now reuses a shared `SimpleGit` instance instead of spawning one per commit
  - **Remove unsafe `any` casts**: typed `gitCommit.body` directly, batch-fetch parents in single git call
  - **Bound rev-list in PR mode**: use `git merge-base` to limit scope instead of fetching entire branch history
  - **Add Zod validation to `readJSON`**: optional schema param for runtime validation at file I/O boundaries
  - **Sanitize GitHub API error messages**: strip tokens and credentials from error output
  - **Add tests**: 19 new tests for `parseRelativeDate`, `getDiffStats`, and `calculatePersistence` (36 total)
  - **Package metadata**: added description, author, license, homepage, repository, keywords, engines to all packages
  - **Remove dead `format` field** from CLIConfig schema

## 0.6.0

### Minor Changes

- 194723a: 4-level AI attribution classification (explicit/implicit/mention/none). Only explicit and implicit commits are counted as AI-assisted, reducing false positives from tool mentions.

  Configurable AI tools via `.aida.json` config file and new CLI flags (`--ai-tool`, `--ai-trailer-domain`). Custom tools benefit from all 4 classification levels.

  Fix: `--ai-pattern` CLI flag was silently ignored due to Commander naming mismatch.

## 0.5.0

### Minor Changes

- eed6a95: Remove bare 'ai' keyword from default detection patterns to eliminate false positives. Add `aiConfidence` field ('high' | 'low' | 'none') to tag results — trailers and explicit [AI] tags are high confidence, keyword-only matches are low.

## 0.4.0

### Minor Changes

- 5d27e31: Accurate merge ratio and multiple fixes

  **@aida-dev/core:**
  - Collect commits from all branches (`--all`) instead of only the default branch
  - Determine `inDefaultBranchAncestry` accurately using `git rev-list`
  - Deduplicate commits reachable from multiple branches
  - Use `git --name-status` for exact file status detection (added/modified/deleted/renamed)

  **@aida-dev/cli:**
  - Remove duplicate `report.json` output (was identical to `metrics.json`)
  - Remove unused `--format` flag from report command

## 0.3.1

### Patch Changes

- 503ef4a: Fix AI detection for Co-Authored-By trailers in commit body

  simple-git stores git trailers in a separate `body` field. The AI tagger now reads both `message` and `body` to correctly detect Co-Authored-By trailers from Claude, Copilot, ChatGPT, and other AI tools.

## 0.3.0

### Minor Changes

- 76f5bda: Add AI detection for Claude Code, ChatGPT, and Gemini commits

## 0.2.2

### Patch Changes

- d86d3e2: Fix --since/--until date filters and remove maxCount cap (#4)

## 0.2.1

### Patch Changes

- 2200625: Fix ESLint and Prettier configuration for monorepo

## 0.2.0

### Minor Changes

- da1d92c: Initial release of AIDA - AI Development Accounting CLI tool
