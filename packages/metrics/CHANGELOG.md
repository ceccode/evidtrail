# @aida/metrics

## 1.0.3

### Patch Changes

- b486167: Launch readiness: one positioning sentence across every surface, and the metadata search engines, social cards and LLMs actually read

  A pre-launch scan found the project describing itself three different ways: the GitHub description promised to "measure the real impact of AI coding agents" — the exact claim the README says AIDA does not make — the landing's Twitter card still carried the pre-1.0 tagline, and npm called the CLI a "CLI for the AIDA auditable evidence ledger", which nobody searches for. This aligns all of them on one sentence: _An auditable ledger of AI provenance and change signals for your git repositories — honest about what git can and cannot prove._
  - **npm**: descriptions rewritten around that sentence; keywords with real search intent (`ai-attribution`, `provenance`, `claude-code`, `github-copilot`, `engineering-metrics`, `github-actions`); `homepage` points to the website; repository URL case-corrected.
  - **Landing**: canonical URL (the old `og:url` had the wrong case and no trailing slash), `og:image`/`twitter:image` (the `summary_large_image` card had no image and rendered blank), aligned Twitter description, favicon, JSON-LD `SoftwareApplication` + `FAQPage`, and a new "What AIDA is — and is not" section written as question → answer. Bounded definitions and explicit limits are the passages LLM answers quote verbatim; AIDA's honesty is its GEO asset.
  - **Crawl files**: `robots.txt`, `sitemap.xml`, `llms.txt`.
  - **Repository**: `CONTRIBUTING.md` (the working agreements in second person), a single issue template — _Misleading number_, the bug report this project most wants — a PR template with the dogfood table and the never-stack rule, and a composite `action.yml` so a workflow becomes `uses: ceccode/AIDA-Metrics@v1` instead of 99 copied lines. The action runs `aida doctor` first: a shallow checkout is refused before it can produce a confidently wrong report.
  - **README fold**: the positioning sentence first, and "What AIDA is not" promoted to its own heading — the most quotable thing the project has.

  Nothing here changes what the tool computes.

- Updated dependencies [b486167]
  - @aida-dev/core@1.0.2

## 1.0.2

### Patch Changes

- Updated dependencies [4dc9ed7]
  - @aida-dev/core@1.0.1

## 1.0.1

### Patch Changes

- 1d9ecf0: Remove the obsolete Merge Ratio claim from the README shipped on npm. Document the current evidence-gated repository signals and optional line-survival and PR metrics so the package description matches the 1.0 measurement contract.

## 1.0.0

### Major Changes

- 9f61a36: Establish the 1.0 measurement contract: default to default-branch ancestry, bind artifacts to a repository snapshot, report fixed-horizon rapid retouch with explicit censoring, harden untrusted Git paths and configuration, make analysis deterministic, and label incomplete PR evidence. PR reports now focus on the change set, identify commits missing provenance, and omit time-based tables that cannot be interpreted on fresh work. The repository's prepare bootstrap installs the canonical provenance hook before the CLI is built, closing the clean-clone gap that silently produced `unknown` commits. The breaking schema changes are intentional so older artifacts cannot be read under the new meanings.

### Patch Changes

- Updated dependencies [9f61a36]
  - @aida-dev/core@1.0.0

## 0.16.0

### Minor Changes

- 3be2c54: Quality over time: the repo compared with its own past (#77 step 3)

  Once AI participates in nearly every commit, "AI vs human" has no second side left to compare against — `No baseline cohort` is the normal outcome, not bad luck. This adds the comparator that still works: the repo against its own history.

  `metrics.trend` slices repo-level persistence, rework and coverage by calendar period (month or quarter), **derived from the commit stream in a single run**. A team gets a trend the first time they run AIDA, rather than after months of archiving reports; comparing stored `metrics.json` files remains possible on top of this and would add only what history cannot reconstruct.

  **The naive version of this feature is guaranteed to lie**, and two mechanisms prevent it:
  - Every period is measured through the same observation window (`--trend-window`, default 30 days), reusing the age-normalization from #29 — applied to time instead of cohorts. Otherwise an older period accumulates survival simply by having existed longer.
  - A period is _mature_ only once it has been over for that full window. Immature periods are computed and reported, clearly marked, and excluded from every comparison. Without this, **every report ever generated would find quality declining**, because the newest period is always the least observed.

  Dogfooded on this repo, where the trap is vivid: the two immature periods show rework 98.1% and 96.7% with persistence under a day — a clock artifact that reads as catastrophic. The mature comparison says the opposite, 41.4% → 27.8% rework between 2026-03 and 2026-04. On varano-239, two months old, AIDA declines to compare at all rather than draw a line through one point.

  Cost is negligible: 291ms for 12 periods over a synthetic 20,000-commit, 100,000-file-touch stream — the per-period passes are linear and the trend adds no measurable time to `aida analyze` at any realistic scale.

  New flags: `--trend-granularity`, `--trend-window`, `--trend-periods`.

## 0.15.0

### Minor Changes

- 2d71949: Repo-level quality block in metrics.json — quality as a property of the repo, not of a cohort (#77, step 1)

  First step of the quality-first reframe: `metrics.json` gains a `repo` block with persistence and rework computed over **all authored commits** (everything except automation), cohort-free. It is fully populated at 0% evidence coverage — the normal case per #77's assumption — and is deliberately untouched by the `defaultMode` prior: the prior can move cohorts, but if it could move these numbers, "assume everything is AI" would quietly become "trust the assumption". A test asserts the block is identical with and without the prior.

  Additive schema change: new field, no version bump per the #53 contract. The report still renders the cohort views — the report reframe is step 2.

### Patch Changes

- 2a0fe24: Report reframe: Code Quality opens, autonomy is the lens, coverage becomes a Data Quality footnote (#77 step 2)

  The report now leads with what needs no attribution evidence and demotes what does:
  - **`## Code Quality` opens the report** — the repo-level block from step 1: persistence, rework and survival buckets over all authored commits. One framing line states the property that makes it first: these numbers do not move with coverage or with the `defaultMode` prior.
  - **`## Autonomy` becomes the lens**, explicitly labelled as depending on attribution evidence. The low-coverage warning is scoped honestly: it used to say _"every metric below is low-confidence"_, which stopped being true the moment repo-level quality existed — it now says the attribution-dependent sections are low-confidence and Code Quality is unaffected. Same scoping applied to the `aida analyze` warning and the metrics caveat.
  - **Coverage moves to `## Data Quality` at the end** — evidence counts and the 90-day window, framed as what gates the autonomy sections, never the report.
  - **The old `## Persistence (file-level survival)` section is gone** — it rendered the _AI cohort's_ numbers under a generic-looking heading, the same defect class found on babel and varano (cohort data wearing a repo-level label). Repo-level detail lives in Code Quality; cohort persistence stays in By Autonomy Level and AI vs Baseline, which say what they are.

  Dogfooded on varano-239, the freshly adopted repo: the report now opens with persistence/rework figures that are valid at its 59.3% coverage, instead of opening with the coverage shortfall. Incidentally, that run showed the adoption loop working — coverage moved 35.3% → 59.3% since the last look, declared commits 5 → 15.

## 0.14.1

### Patch Changes

- 0d6bebd: Show how many commits a prior placed in each autonomy cohort

  Found running AIDA against a freshly adopted repo (ceccode/varano-239, 17 commits): the same report said **`agent 5`** in the observed table and **`agent 16`** in `By Autonomy Level`. Both were correct under their own definition — the first counts what commits declare, the second counts cohort membership after the `defaultMode` prior fills in the 11 commits with no evidence — but nothing in the report said the two tables used different definitions, and a reader takes the larger number for the real one.

  The same class of defect as the automated-commit miscount fixed in #25: two tables in one report describing the same commits differently. That fix caught one instance, this catches its sibling.

  `ModeStats` now carries `assumed`, and the per-level table renders `16 (11 assumed)` with a line stating that these cohorts include prior-placed commits while the observed table never does. With no prior configured, `assumed` is 0 and the two tables agree exactly — asserted by a test.

## 0.14.0

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

### Patch Changes

- Updated dependencies [3c7bdb5]
  - @aida-dev/core@0.18.0

## 0.13.1

### Patch Changes

- 36dd0fb: Fix three correctness bugs found by running AIDA against a large monorepo

  Validated against babel/babel (18,851 commits, 28,732 tracked files) — the scale profile the first two external repos were missing. The two suspected failure modes (a 64MB `maxBuffer` ceiling, and blame being unusably slow) both turned out to be non-issues; what the run actually found were three ways of reporting a wrong number confidently.
  - **An unnamed bot co-author is no longer read as AI.** The `Co-authored-by:.*bot.*` trailer rule treated "a bot participated" as "AI wrote this" — two different claims. On babel, 47 of 52 "AI" commits were ordinary PRs co-authored by _Babel Bot_, the project's own release and formatting bot; the rule was also unanchored, so any human whose name merely contains "bot" matched. A co-author must now name a known AI tool or AI domain. Precision went 5/52 → 8/8, and recall improved too: the tool-name rule catches `Copilot <copilot@github.com>` and `Copilot Autofix`, which the old `*bot*` rule missed. This also establishes an invariant worth keeping — a trailer-detected AI commit now always has a known autonomy mode, where all 47 false positives had `mode: unknown`. The tagger already knew it could not name a tool, and asserted AI anyway.
  - **The line-survival denominator now covers the same files as the numerator.** `approxSurvivalRate` divided AI lines surviving in the blamed files by AI lines added across the _entire_ history. Since blame never covers the whole tree — generated files are excluded, `--max-files` caps the walk — the two halves described different repos. On babel, `aida blame --max-files 500` over 28,732 files reported **"1.7% of AI-introduced lines survive"**: 453 files' worth of survivors over the whole history's worth of additions. Arithmetically correct, and it told the reader that AI code gets deleted when it actually said the sample was 1.6% of the tree. `BlameStream` now carries `blamedPaths` (schema v2) and the denominator is scoped to it.
  - **`--max-files` now samples the tree instead of its first corner.** It took the first N paths in `git ls-tree` order, which is path order. On babel, `--max-files 500` never got past `packages/babel-c*` and drew 183 of its 500 files from a single package — then the report called it "a sample". Selection now strides evenly across the candidate list, staying fully deterministic.

  Also: **a failing `git blame` is no longer indistinguishable from a binary file.** Errors were absorbed into `filesSkipped`, so a run that failed on half the tree read as a clean run with some binaries in it. They are now counted in `filesFailed`, warned about with the first error, and surfaced in the report. This is the path a `maxBuffer` overflow would have taken: silently missing lines rather than a failure. The overflow itself proved unreachable — `git blame --incremental` emits one line per chunk rather than per line, so babel's worst file produced 78KB against the 64MB cap, and `ls-tree` and `diff --numstat` peaked at 2.7MB.

- Updated dependencies [36dd0fb]
- Updated dependencies [68be0d3]
  - @aida-dev/core@0.17.1

## 0.13.0

### Minor Changes

- 8e7aaee: Age-normalized fair comparison (#29), within-category comparison (#36), outcome correlation (#26)

  **Fair comparison (#29)** — the raw AI vs Baseline table can be misleading when one cohort's commits are systematically older than the other's: an older cohort accumulates persistence simply from clock time. `metrics.json` gains `fairComparison`, recomputing both cohorts' persistence with each file's observation window capped to the younger cohort's average commit age. Reported alongside the raw comparison, never in place of it; null under the same condition as `baseline`.

  **Within-category comparison (#36 step 2)** — a pooled delta can hide a task-mix confound (AI mostly writing tests, humans mostly writing source). `metrics.json` gains `byCategory`: persistence per file category (source/tests/migrations/config/docs/generated) for each cohort, with a delta only where both sides touched that category. Always present, useful even without a baseline.

  **Outcome correlation (#26)**, scoped to what git can answer — no incidents, no SAST, both would need network access this tool deliberately doesn't have:
  - `commit-stream.json`: new `revertsCommit` field, parsed from the full commit body at collect time (`git revert` writes "This reverts commit \<sha\>." — the only reliable link back to what was reverted).
  - `metrics.json` gains `outcomeCorrelation`: reverts resolved and attributed to the **reverted** commit's cohort/mode; hotfix-pattern commits (`fix`/`hotfix`/`patch`) linked to the closest prior touch of the same file(s) within a window (default 7 days, `--hotfix-window`) and attributed to that antecedent's cohort/mode. Always present, a repo-level property rather than a cohort comparison.

  All three fields are additive; `schemaVersion` stays unchanged per the #53 contract.

- 0ed11c6: Report outcome correlation against the base rate, not as raw counts

  A bare count of "AI-caused" reverts or hotfixes is uninterpretable: in a repo where 90% of commits are AI, 90% of reverts being AI means nothing. The previous table showed only counts, which invited exactly the wrong conclusion from correct numbers.

  `outcomeCorrelation.reverts.rates` and `.hotfixes.rates` now carry, per cohort, its `share` of the outcome, its `baseRate` (share of authored commits) and the `ratio` between them — 1.00× being exactly what the cohort's size predicts. Automated commits are excluded from both sides, since automation isn't authored work. The report renders share, base rate and ratio side by side, and leads with "read the ratio, not the count".

  Found by running AIDA against `anthropics/claude-code-action`, where the raw numbers (3 of 11 reverts, 49 of 140 hotfix antecedents attributed to AI) read as alarming, while the ratios show 1.13× for reverts — no signal — and 1.45× for hotfixes, a real but modest excess.

  Additive to the schema; `schemaVersion` unchanged.

### Patch Changes

- Updated dependencies [672edff]
- Updated dependencies [8e7aaee]
  - @aida-dev/core@0.17.0

## 0.12.0

### Minor Changes

- 7586eed: Line-level survival via `aida blame` (#23)

  Exact per-line attribution, replacing the file-level proxy as the precise measure: of the lines alive in the tree right now, which commit last wrote each one, and at what autonomy level. One AI line in a thousand no longer marks a whole file.
  - **New `aida blame` command** writes `blame-stream.json` (schema v1) with per-commit surviving line counts — compact, one entry per commit rather than per line. Kept opt-in and separate because it runs one git process per file; `collect` stays fast.
  - **`aida analyze` picks it up when present**: `metrics.lineSurvival` reports lines alive by attribution cohort and by autonomy mode, plus the AI share. Absent without the file, with a caveat pointing at the command.
  - **Binary files are detected and excluded** via a single `git diff --numstat` against the empty tree. `git blame` does not fail on binaries — it reports the whole blob as one line — so they would otherwise have added phantom lines to the totals.
  - Blame runs with `-w`, so reformatting does not reattribute lines to whoever ran the formatter. `--max-files` bounds the walk and flags the result as a sample; lines from commits outside the collected window are reported separately rather than folded into `unknown`.

  Share figures are exact for the living codebase. The derived survival rate of AI-introduced lines is explicitly approximate: blame cannot see deleted lines, and a line rewritten twice was added twice.

### Patch Changes

- Updated dependencies [7586eed]
  - @aida-dev/core@0.16.0

## 0.11.0

### Minor Changes

- 3b7d25a: Windowed coverage (#52), rework rate (#22), and correct `--version`

  **Windowed coverage** — `attribution.recent` reports coverage over a recent window (default 90 days, `--coverage-window`). All-time coverage is a permanent verdict on history that predates adoption; the recent figure answers "are we tagging now?", so it is what drives the low-confidence warning. All-time stays reported as context, and `belowThreshold` keeps its existing all-time meaning, so this is additive — no schema version bump.

  **Rework rate** — `persistence.rework` reports the share of AI-touched files modified again within a short window (default 7 days). Right-censoring is handled explicitly: a file too recent to have a determined outcome counts in neither the numerator nor the denominator, and the count of such files is reported. It is file-level, so within-session iteration inflates it — stated in the caveats and README.

  **Fix**: `aida --version` reported a hardcoded `0.0.0` regardless of the installed build; it now reports the real package version.

## 0.10.1

### Patch Changes

- Updated dependencies [328b64d]
  - @aida-dev/core@0.15.0

## 0.10.0

### Minor Changes

- 6141aef: PR acceptance rate via forge APIs (#51)

  The honest successor to the merge ratio removed in #20. Git history cannot say whether work was accepted — squash merges and deleted branches erase discarded work — but a forge never deletes a closed pull request.
  - **New `aida fetch-prs` command**: fetches closed PRs (merged and closed-unmerged) from the GitHub API into `pr-stream.json` (schema v1). It is the _only_ command that touches the network, kept separate on purpose so `collect` stays git-only and offline.
  - **`aida analyze` picks it up when present**: `metrics.json` gains `prAcceptance` with acceptance rates overall, per attribution cohort, and per autonomy mode. Absent without the file — with a caveat pointing at `fetch-prs`, never a silent 0%.
  - **Attribution from the PR's own commit messages** as returned by the API, not from a join against local git: this is what makes it work for squash-merged PRs whose branches no longer exist.
  - **No author identity is fetched or stored** — PR numbers, outcomes, dates, and commit attribution only (#35).
  - Bounded API usage via `--since` and `--max-prs`; a capped fetch is flagged `truncated` and carries a caveat. Rate-limit exhaustion produces a distinct, actionable error.

### Patch Changes

- Updated dependencies [6141aef]
  - @aida-dev/core@0.14.0

## 0.9.0

### Minor Changes

- 6ae4bad: Version the output schemas + end-to-end CLI tests (#53)

  `commit-stream.json` and `metrics.json` now carry a `schemaVersion` (both v1). The shape of these files changed six times in three days and a consumer had no way to detect it — a stale file parsed against a newer schema yields silent `undefined`s, not an error.
  - **Contract**: additive changes don't bump the version; removing a field, renaming it, or changing its meaning does. Documented in the README, replacing the previous (untrue) "stable JSON schemas" claim.
  - **Readers refuse what they don't understand**: `aida analyze` and `aida report` check the version before schema parsing and fail with an actionable message (`Rerun 'aida collect'`) instead of a zod dump or a half-parsed result. Pre-versioning output is named as such.
  - **End-to-end CLI tests**: the `collect → analyze → report → comment --dry-run` pipeline is now covered on a fixture repo (CLI package went from 1 test to 7), including the version gate and `--redact-authors`.
  - **`pnpm typecheck`**: new script (wired into CI) that typechecks tests too. It immediately caught pre-existing type errors in test fixtures that had been invisible, since vitest transpiles without checking.

### Patch Changes

- Updated dependencies [6ae4bad]
  - @aida-dev/core@0.13.0

## 0.8.1

### Patch Changes

- Updated dependencies [4598854]
  - @aida-dev/core@0.12.0

## 0.8.0

### Minor Changes

- 3d3fc0e: Per-mode cohort metrics (#25, step 2)

  `metrics.json` gains a `byMode` block: merge ratio and persistence computed per autonomy level (`agent` / `assisted` / `autocomplete` / `none` / `unknown`), `null` for modes with no commits. Automated commits are excluded — automation is not authored code. The report renders a "By Autonomy Level" table.

  This is the comparison that stays meaningful in an AI-first world: agent vs assisted vs autocomplete, instead of AI vs human.

- fd7f8bf: Remove merge ratio (#20)

  Git history structurally cannot measure "% of AI commits that land": squash merges erase branch commits (the known #20 bug), and deleted branches erase abandoned work entirely, so the ratio trends toward 100% for every repo and discriminates nothing. Patching squash handling would not fix the survivorship bias — the data source deletes the negative outcomes. Removed rather than patched.
  - `metrics.json` no longer has `mergeRatio`; `baseline` is `{assumed, persistence}`, `delta` is persistence-only, `byMode` entries are `{commits, persistence}`.
  - Report drops the Merge Ratio section and the merge-ratio rows/columns.
  - `commit-stream.json` keeps `inDefaultBranchAncestry` (raw data stays available to consumers).

  The honest successor is a PR acceptance rate built on forge APIs, where declined PRs are never deleted — tracked separately.

## 0.7.0

### Minor Changes

- ddd86aa: 'automated' as fourth attribution state (#39)

  Merge commits and bot-authored commits are automation, not authored code — their provenance is known, yet they landed in `unknown`, dragging coverage down forever (and decaying it with every release) or getting pulled into cohorts by `defaultAttribution` priors.
  - New attribution state `automated`: auto-detected at collect time (merge commits via parent count, bots via the #21 blocklist matched against author/committer identity) or declared via manifest `excluded_commits`. In-commit AI evidence and manifest ai/human declarations always win over the structural heuristics.
  - Coverage now counts `automated` as known provenance: `(ai + human + automated) / total`.
  - Automated commits join no cohort and priors never touch them; they carry `mode: none`.
  - Report and logs show the automated count; the `defaultAttribution` prior note is hidden when there are no unknown commits left.

  Breaking for `metrics.json`/`commit-stream.json` consumers: attribution enum gains `automated`; the attribution block gains a required `automated` count.

### Patch Changes

- Updated dependencies [ddd86aa]
  - @aida-dev/core@0.11.0

## 0.6.0

### Minor Changes

- 65e2464: Fix persistence semantics: survival with censoring, convention-driven categories excluded

  The file-level persistence metric measured the span from a file's first target-cohort touch to the **last** time anyone touched it — churn duration, not survival. A stable file never modified again scored 0 days (the best outcome counted as the worst), while a changelog touched by every release scored maximum.

  Now persistence = **survival**: days until the _first_ subsequent modification or deletion. Files never modified again are **censored** at collection time (they survived the window) and reported via a new `censored` count. Migrations (append-only by convention) and generated files (churned on every release) carry no quality signal and are excluded from persistence by default — new `filesConsidered`/`filesExcluded` fields make this visible; they still appear in the task-mix table.

  Found via community feedback on the task-mix feature. Breaking for `metrics.json` consumers: `persistence` gains required `filesConsidered`, `filesExcluded`, `censored` fields, and bucket distributions shift meaning.

## 0.5.0

### Minor Changes

- 690fc53: Autonomy mode collection (#25, step 1)

  First step of the involvement × evidence model. Every commit now carries:
  - **`tags.mode`**: `none` | `autocomplete` | `assisted` | `agent` | `unknown` — what level of AI participated. The durable axis in an AI-first world.
  - **`tags.modeEvidence`**: `declared` (manifest `mode` field — top-level default or per-entry override) | `inferred` (derived from the tool named in trailers: Claude Code/Claude → agent, Copilot → autocomplete, Cursor/Windsurf/Codeium/ChatGPT/Gemini → assisted) | `none` (no signal).

  Manifest-declared human commits get `mode: none, declared`. `metrics.json` reports per-mode and per-evidence counts in the attribution block; the report shows an Autonomy line under the coverage headline. Per-mode cohort metrics are step 2.

- 027ff40: Cohort fairness context (#29 step 1, #36 step 1)

  `metrics.json` gains a `cohorts` block with, per cohort (AI and baseline):
  - **Age stats** (#29): commits, average and median age in days — older cohorts accumulate persistence by default, so comparing raw persistence across cohorts of different ages is misleading.
  - **Task mix** (#36): file touches classified as source / tests / migrations / config / docs / generated via path heuristics — a good persistence number may reflect _what_ the cohort worked on, not how well.

  The markdown report renders a "Cohort Fairness" table; a caveat warns to check it before reading the delta. Also fixed: manifest-excluded commits are never pulled into a cohort by the `defaultAttribution` prior — they were excluded precisely to stay out of both.

### Patch Changes

- Updated dependencies [0f4fb0d]
- Updated dependencies [690fc53]
  - @aida-dev/core@0.10.0

## 0.4.0

### Minor Changes

- 5ddbaf4: Attribution coverage as headline metric (#34)

  Three-state attribution replaces the silent AI/human binary:
  - Every commit is attributed `ai`, `human`, or `unknown` (`tags.attribution`). Message heuristics emit only `ai` or `unknown`: the absence of an AI signal is not evidence of human authorship. `human` will come from explicit declarations (attribution manifest, #10).
  - `metrics.json` gains a leading `attribution` block with per-state counts and **coverage** — the share of commits with known provenance — plus a configurable `coverageThreshold` (default 0.7) that flags all metrics as low-confidence when coverage falls below it.
  - `baseline` and `delta` are now nullable: when no commits are attributed `human` and no prior assigns the unknowns, AIDA reports "no baseline" instead of silently comparing AI commits against unattributed ones.
  - New `defaultAttribution` option (`.aida.json` or `aida analyze --default-attribution`) consciously assigns unknown commits to a cohort (`human` for traditional repos, `ai` for AI-first ones). The prior affects cohorts, never coverage; an assumed baseline is labeled `assumed` in output and report.
  - The markdown report opens with an "Attribution Coverage" section and a warning banner when coverage is below threshold.

  Breaking (0.x minor): `commit-stream.json` requires the new `tags.attribution` field — rerun `aida collect`. `metrics.json` consumers must handle `baseline: null` / `delta: null` and the renamed baseline semantics (human cohort, not "non-AI").

### Patch Changes

- 9130689: Git data accuracy (#24):
  - Real committer name/email/date are now collected via a custom `git log --format` (previously duplicated from author fields, wrong after rebase/squash).
  - Commit metadata, parents, and diff stats are fetched in two batched `git log` passes instead of two git processes per commit — collection is dramatically faster on large repos.
  - Removed the misleading `branch` field from the `Commit` schema: it was always set to the default branch, even for commits collected from other branches.
  - New caveat documents that time-windowed collection (`--since`) also windows the ancestry check.

- Updated dependencies [5ddbaf4]
- Updated dependencies [9130689]
  - @aida-dev/core@0.9.0

## 0.3.1

### Patch Changes

- Updated dependencies [938a72d]
  - @aida-dev/core@0.8.0

## 0.3.0

### Minor Changes

- Add comparative baseline metrics: compute merge ratio and persistence for both AI and non-AI commits, with baseline and delta in metrics.json and a side-by-side comparison table in report.md.

## 0.2.0

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

### Patch Changes

- Updated dependencies
  - @aida-dev/core@0.7.0

## 0.1.7

### Patch Changes

- Updated dependencies [194723a]
  - @aida-dev/core@0.6.0

## 0.1.6

### Patch Changes

- Updated dependencies [eed6a95]
  - @aida-dev/core@0.5.0

## 0.1.5

### Patch Changes

- Updated dependencies [5d27e31]
  - @aida-dev/core@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [503ef4a]
  - @aida-dev/core@0.3.1

## 0.1.3

### Patch Changes

- Updated dependencies [76f5bda]
  - @aida-dev/core@0.3.0

## 0.1.2

### Patch Changes

- d86d3e2: Fix --since/--until date filters and remove maxCount cap (#4)
- Updated dependencies [d86d3e2]
  - @aida-dev/core@0.2.2

## 0.1.1

### Patch Changes

- 2200625: Fix ESLint and Prettier configuration for monorepo
- Updated dependencies [2200625]
  - @aida-dev/core@0.2.1

## 0.1.0

### Minor Changes

- da1d92c: Initial release of AIDA - AI Development Accounting CLI tool

### Patch Changes

- Updated dependencies [da1d92c]
  - @aida/core@0.2.0
