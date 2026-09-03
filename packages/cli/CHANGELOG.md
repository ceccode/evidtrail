# @aida/cli

## 1.1.0

### Minor Changes

- 3b5d6b2: `aida init`, `aida doctor`, and `aida` with no arguments — the first ten minutes, fixed

  Adoption dies in the first ten minutes. Before this, a team had to write `.aida.json` by hand, remember `install-hooks` in every clone, copy a 99-line workflow, and learn that `collect → analyze → report` is a pipeline before seeing a single number. Each step was small; together they were the reason a tool gets evaluated on a laptop and never reaches CI.
  - **`aida init`** — the whole setup in one command: a starter `.aida.json` (no prior unless `--default-mode` is passed; an assumption is opted into, not defaulted), the commit hook for this clone, `"prepare": "aida install-hooks --if-git"` for every other clone, and `.github/workflows/aida.yml` — npm-based, `fetch-depth: 0`, `--redact-authors`, minimal permissions, comment upserted by `gh` in its own step so the write token never meets PR-built code. **Never overwrites**: a file or script that exists is reported and left alone, so re-running is free and a hand-tuned setup is never clobbered.
  - **`aida doctor`** — every way a run can be quietly wrong, asked before the run: shallow clone (blocking — the classic confidently-wrong CI report), partial clone, missing `origin/HEAD`, invalid or retired-key `.aida.json` (blocking, same fail-fast as `analyze`), hook missing in _this_ clone, no `prepare` script, no CI workflow. Each non-green line carries its one-line fix. Exit code is non-zero only for blockers, so it is safe inside `prepare`. `--json` for scripts.
  - **`aida`** with no subcommand runs `collect → analyze → report`. The granular commands stay for CI and for anyone who wants one stage at a time.

  Hook installation moved from the command body into `hooks/install.ts` so `init` and `install-hooks` share one implementation; `install-hooks` is now a thin wrapper and reports "already installed" instead of silently rewriting an identical hook.

- 6867550: PR comment is now exception-driven: one line when everything is fine, the problem in the open when it is not

  The PR comment is read in three seconds, on every push, by someone who did not ask for it. The previous version was 38 lines and 245 words — 42% of them caveats repeated identically on every PR. A caveat that appears every time trains readers to skip it, so the one time it matters it goes unread. Verbosity was working against honesty.

  Now:
  - **Normal state is one line.** `**AIDA** ✅ 3 commits — agent 3 — every commit in this change set carries provenance.` Nineteen words in the open on this repo's own PRs, down from 245.
  - **The exception is in the open, with the repair.** When commits lack provenance, the verdict line turns to ⚠️ with the count and coverage, followed by the commits themselves and the one-line fix (`aida install-hooks`, or the `prepare` recipe). The `defaultMode` reminder appears only when a prior is actually configured — it is a warning about a specific misunderstanding, not boilerplate.
  - **Everything else folds into `<details>`** — scope and SHA, evidence breakdown, the autonomy table (zero rows omitted), and the interpretation limits. Present for whoever wants them, invisible to everyone else.
  - **Dropped as noise for this surface:** the absolute repo path (meaningless in CI, you are already in the repo), the generation timestamp (GitHub shows the edit time), and autonomy rows with zero commits.

  The full report (`aida report` on default-branch scope) is unchanged; this only touches the PR-scoped template. The comment is still upserted in place via the `<!-- aida-metrics-report -->` marker, so a PR never accumulates stale copies.

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
  - @aida-dev/metrics@1.0.3

## 1.0.2

### Patch Changes

- 4dc9ed7: Align the published CLI README and public documentation with the 1.0 evidence contract: truthful provenance behavior, evidence-gated cohort comparisons, local-by-default processing, and GitHub/GitLab comment support.
- 61deeac: Correct the root README to state that PR acceptance is already available through `aida fetch-prs`, rather than describing it as planned work.
- Updated dependencies [4dc9ed7]
  - @aida-dev/core@1.0.1
  - @aida-dev/metrics@1.0.2

## 1.0.1

### Patch Changes

- c696963: Clarify the released 1.0 roadmap and the provenance contract: a commit-time default can declare new work through the hook, while the same setting remains only a prior for untagged history during analysis. Document the post-1.0 direction for evidence-backed AI cost scenarios without presenting estimates as observed spend or accounting value.
- Updated dependencies [1d9ecf0]
  - @aida-dev/metrics@1.0.1

## 1.0.0

### Major Changes

- 9f61a36: Establish the 1.0 measurement contract: default to default-branch ancestry, bind artifacts to a repository snapshot, report fixed-horizon rapid retouch with explicit censoring, harden untrusted Git paths and configuration, make analysis deterministic, and label incomplete PR evidence. PR reports now focus on the change set, identify commits missing provenance, and omit time-based tables that cannot be interpreted on fresh work. The repository's prepare bootstrap installs the canonical provenance hook before the CLI is built, closing the clean-clone gap that silently produced `unknown` commits. The breaking schema changes are intentional so older artifacts cannot be read under the new meanings.

### Patch Changes

- Updated dependencies [9f61a36]
  - @aida-dev/core@1.0.0
  - @aida-dev/metrics@1.0.0

## 0.19.0

### Minor Changes

- 6785ed6: A prior can no longer conjure a cohort overlay out of assumption alone (#77 step 4)

  The last step of the quality-first migration. Earlier work made the prior's contribution _visible_ — `(N assumed)` next to each cohort size. This stops it from creating an overlay at all: a cohort whose every commit was placed there by `defaultMode` is not a measurement, it is the assumption describing itself with numbers next to it.
  - **Per-level rows** in `By Autonomy Level` render only where at least one commit carries real evidence. `unknown` is exempt — it _is_ the no-evidence bucket, and reporting its size is the honest part.
  - **The AI-vs-baseline comparison is withheld** when either side is pure prior, because a measured cohort against an assumed one yields a delta that describes the prior rather than the repo.
  - **Nothing is dropped silently.** When every cohort is gated, the section still renders and explains why, and names the prior responsible — a configured `defaultMode` doing nothing is itself worth knowing. Writing the gate surfaced this: the first implementation made the section vanish, which its own test caught.
  - **Cohort Fairness** is gated only when _neither_ side has evidence. With one real cohort its age and task mix are information the repo genuinely has, so the table stays as it was.

  The gate is on presentation only — every cohort remains in `metrics.json`, so a consumer that wants the prior's view still has it.

  Dogfooded on both repos: this one (full evidence) renders the agent cohort unchanged; varano-239 renders `agent 26 (11 assumed)` because 15 commits genuinely declare `agent`, while a synthetic 0%-evidence repo with `--default-mode agent` gets the explained withholding instead of a fabricated table.

### Patch Changes

- 8d4ca58: Refresh documentation to match the shipped tool, and dogfood our own hook recipe

  Six places still described a tool that no longer exists — found by auditing the docs against the four #77 PRs rather than trusting them:
  - The **demo site** (`docs/index.html`) advertised **merge ratio** in its terminal demo, a metric removed in v0.14, and led its feature grid with coverage-as-headline. Now shows repo-level quality and a trend line, with the feature cards rewritten around quality-first.
  - **`### By Autonomy Level`** claimed merge ratio was computed per mode.
  - **`### Comparative Baseline`** claimed merge ratio was computed for the human cohort, and that the comparison table renders "at the top" — it has been below Code Quality since the report reframe.
  - **Schema versioning** still said `commit-stream.json v1, metrics.json v1`; both are v2, and `blame-stream.json` is v2 as well. Now states what each bump changed.
  - **Output Files** described `metrics.json` without the `repo` and `trend` blocks, and `commit-stream.json` in four-state terms rather than the two axes.

  Also: **this repo now follows the `prepare` recipe it recommends** (#75). `scripts/install-hooks.mjs` installs the hook on `pnpm install`, with the one guard the published recipe does not need — AIDA is the CLI here, so on a fresh clone `pnpm install` runs before `pnpm build` and there is nothing to install from yet. It skips with a reason rather than silently, and never fails an install over a hook.

  New **`AGENTS.md`** for coding agents: the honesty bar, the dogfood-before-PR and never-stack-PRs agreements, how to stamp provenance truthfully, four behaviours that look like bugs and are not (empty cohorts, priors that are not evidence, immature trend periods, `unknown` as a real answer), and the recurring defect class this project has now found four times — two tables describing the same commits under different definitions without saying so.

## 0.18.0

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

### Patch Changes

- Updated dependencies [3be2c54]
  - @aida-dev/metrics@0.16.0

## 0.17.0

### Minor Changes

- 2a0fe24: Report reframe: Code Quality opens, autonomy is the lens, coverage becomes a Data Quality footnote (#77 step 2)

  The report now leads with what needs no attribution evidence and demotes what does:
  - **`## Code Quality` opens the report** — the repo-level block from step 1: persistence, rework and survival buckets over all authored commits. One framing line states the property that makes it first: these numbers do not move with coverage or with the `defaultMode` prior.
  - **`## Autonomy` becomes the lens**, explicitly labelled as depending on attribution evidence. The low-coverage warning is scoped honestly: it used to say _"every metric below is low-confidence"_, which stopped being true the moment repo-level quality existed — it now says the attribution-dependent sections are low-confidence and Code Quality is unaffected. Same scoping applied to the `aida analyze` warning and the metrics caveat.
  - **Coverage moves to `## Data Quality` at the end** — evidence counts and the 90-day window, framed as what gates the autonomy sections, never the report.
  - **The old `## Persistence (file-level survival)` section is gone** — it rendered the _AI cohort's_ numbers under a generic-looking heading, the same defect class found on babel and varano (cohort data wearing a repo-level label). Repo-level detail lives in Code Quality; cohort persistence stays in By Autonomy Level and AI vs Baseline, which say what they are.

  Dogfooded on varano-239, the freshly adopted repo: the report now opens with persistence/rework figures that are valid at its 59.3% coverage, instead of opening with the coverage shortfall. Incidentally, that run showed the adoption loop working — coverage moved 35.3% → 59.3% since the last look, declared commits 5 → 15.

### Patch Changes

- 2d71949: Repo-level quality block in metrics.json — quality as a property of the repo, not of a cohort (#77, step 1)

  First step of the quality-first reframe: `metrics.json` gains a `repo` block with persistence and rework computed over **all authored commits** (everything except automation), cohort-free. It is fully populated at 0% evidence coverage — the normal case per #77's assumption — and is deliberately untouched by the `defaultMode` prior: the prior can move cohorts, but if it could move these numbers, "assume everything is AI" would quietly become "trust the assumption". A test asserts the block is identical with and without the prior.

  Additive schema change: new field, no version bump per the #53 contract. The report still renders the cohort views — the report reframe is step 2.

- Updated dependencies [2d71949]
- Updated dependencies [2a0fe24]
  - @aida-dev/metrics@0.15.0

## 0.16.0

### Minor Changes

- 93f55bf: Reach every clone with the commit hook: `--if-git` plus a `prepare` recipe, and a warning that names the gap (#75)

  A hook is per-clone state while `.aida.json` is committed and shared, so declared coverage depended on each contributor remembering to run `aida install-hooks` in each clone. The failure is silent — nothing breaks, the no-evidence bucket just grows and the 90-day figure ("the number you can move") degrades without anyone deciding it should.
  - **`aida install-hooks --if-git`** exits 0 quietly where there is no git to hook into — a tarball install, `npm ci` in a container, a Docker build context — instead of failing an unrelated install. That makes it safe in a `prepare` script, now documented (the husky model): `{ "scripts": { "prepare": "aida install-hooks --if-git" } }`. Installation was already idempotent and still refuses to overwrite a foreign hook, so `prepare` re-runs cost nothing.
  - **The low-coverage warning names the gap.** When a repo has `.aida.json` but the local clone has no `prepare-commit-msg` hook, the warning says so and gives the `prepare` line, instead of repeating generic advice. It stays generic when the hook is present, and on repos that never opted into AIDA — running AIDA over someone else's project should not nag about a hook they never asked for.

  No `postinstall` behaviour was added: mutating `.git` as a side effect of `npm install` violates least surprise, and install scripts are disabled in exactly the hardened setups that would care most. AIDA points at the gap where eyes already are instead.

### Patch Changes

- 0d6bebd: Show how many commits a prior placed in each autonomy cohort

  Found running AIDA against a freshly adopted repo (ceccode/varano-239, 17 commits): the same report said **`agent 5`** in the observed table and **`agent 16`** in `By Autonomy Level`. Both were correct under their own definition — the first counts what commits declare, the second counts cohort membership after the `defaultMode` prior fills in the 11 commits with no evidence — but nothing in the report said the two tables used different definitions, and a reader takes the larger number for the real one.

  The same class of defect as the automated-commit miscount fixed in #25: two tables in one report describing the same commits differently. That fix caught one instance, this catches its sibling.

  `ModeStats` now carries `assumed`, and the per-level table renders `16 (11 assumed)` with a line stating that these cohorts include prior-placed commits while the observed table never does. With no prior configured, `assumed` is 0 and the two tables agree exactly — asserted by a test.

- Updated dependencies [0d6bebd]
  - @aida-dev/metrics@0.14.1

## 0.15.0

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
  - @aida-dev/metrics@0.14.0

## 0.14.1

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

- Updated dependencies [36dd0fb]
- Updated dependencies [68be0d3]
  - @aida-dev/core@0.17.1
  - @aida-dev/metrics@0.13.1

## 0.14.0

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

- 672edff: Fix three correctness bugs found by running AIDA against an external repository

  Validated against commander.js (1,517 commits, 2011–2026) — the first repo other than this one AIDA had ever analysed. All three would have produced confidently wrong numbers on someone else's project.
  - **`github.com` removed from AI trailer domains.** `@users.noreply.github.com` is the default email of every GitHub account, so any commit co-authored through the web UI was flagged as AI. On commander.js, 2 of 3 "AI" detections were ordinary humans. AI bots hosted on GitHub are still caught by the `*bot*` rule, verified against the real `copilot-swe-agent[bot]` trailer.
  - **Shallow clones now warn.** `actions/checkout` defaults to `fetch-depth: 1`, so AIDA would happily report on a single commit as if it were the whole history. Detected via `git rev-parse --is-shallow-repository`; both CI examples in the README now set `fetch-depth: 0` / `GIT_DEPTH: 0`, which was the upstream cause.
  - **Empty repositories no longer crash** with a raw `fatal: ambiguous argument 'HEAD'`; `collect` returns a valid empty stream and the whole pipeline runs through.

  Also: `copilot-swe-agent[bot]` (GitHub's autonomous coding agent) is now inferred as `agent` rather than `autocomplete` — it was matching the generic `copilot` rule first, which inverted exactly the distinction #25 exists to measure.

- Updated dependencies [672edff]
- Updated dependencies [8e7aaee]
- Updated dependencies [0ed11c6]
  - @aida-dev/core@0.17.0
  - @aida-dev/metrics@0.13.0

## 0.13.0

### Minor Changes

- ce6caf9: GitLab CI provider for `aida comment` (#16)

  `aida comment` now auto-detects GitLab CI and posts the report as a merge request note, finding and updating its own note by marker on re-runs instead of adding a new one — the same behaviour as the GitHub provider.
  - Uses `CI_MERGE_REQUEST_IID`, `CI_PROJECT_ID` and `CI_API_V4_URL`, so self-managed instances work without configuration.
  - Requires `GITLAB_TOKEN` (project or group access token with the `api` scope). `CI_JOB_TOKEN` cannot post notes and is deliberately not used as a fallback: the command fails with that explanation instead of an opaque 401.
  - Token patterns are scrubbed from any surfaced API error.

  PR-scoped collection (`--pr`) already supported GitLab, so `collect → analyze → report → comment` now works end to end there.

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
  - @aida-dev/metrics@0.12.0

## 0.12.0

### Minor Changes

- 3b7d25a: Windowed coverage (#52), rework rate (#22), and correct `--version`

  **Windowed coverage** — `attribution.recent` reports coverage over a recent window (default 90 days, `--coverage-window`). All-time coverage is a permanent verdict on history that predates adoption; the recent figure answers "are we tagging now?", so it is what drives the low-confidence warning. All-time stays reported as context, and `belowThreshold` keeps its existing all-time meaning, so this is additive — no schema version bump.

  **Rework rate** — `persistence.rework` reports the share of AI-touched files modified again within a short window (default 7 days). Right-censoring is handled explicitly: a file too recent to have a determined outcome counts in neither the numerator nor the denominator, and the count of such files is reported. It is file-level, so within-session iteration inflates it — stated in the caveats and README.

  **Fix**: `aida --version` reported a hardcoded `0.0.0` regardless of the installed build; it now reports the real package version.

### Patch Changes

- Updated dependencies [3b7d25a]
  - @aida-dev/metrics@0.11.0

## 0.11.0

### Minor Changes

- 328b64d: Commit-time mode stamping via git hook (#61)

  The attribution manifest (#10) declares provenance retroactively; this declares it at the source, turning `declared` evidence from the exception into the norm — the prerequisite for making autonomy the primary axis (#25 step 3).
  - **`AI-Mode:` trailer** (`none` | `autocomplete` | `assisted` | `agent`) parsed as `mode` with `modeEvidence: declared`, beating tool inference. `AI-Mode: none` is the first mechanism that declares _human_ authorship at commit time, without a manifest.
  - **`aida install-hooks`** writes a `prepare-commit-msg` hook: self-contained POSIX shell (no dependency on `aida` at commit time), idempotent, refuses to overwrite a hook it didn't write unless `--force`, `--uninstall` removes only its own marked block, and it can never block a commit.
  - **Mode resolution**: `AIDA_MODE` env var → known agent environment detection → `defaultMode` in `.aida.json` → nothing. An unknown mode writes no trailer: absence honestly means unknown, a guess would be a fabricated declaration.

### Patch Changes

- Updated dependencies [328b64d]
  - @aida-dev/core@0.15.0
  - @aida-dev/metrics@0.10.1

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
  - @aida-dev/metrics@0.10.0

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
  - @aida-dev/metrics@0.9.0

## 0.8.0

### Minor Changes

- 4598854: Author redaction (#35) and synthetic PR merge commit fix (#40)

  **Author redaction** — `aida collect --redact-authors` (or `redactAuthors: true` in `.aida.json`) replaces author/committer names and emails in `commit-stream.json` with a per-run salted hash: stable within one output file so identities can still be grouped, but not reversible to a person and not correlatable across runs. Redaction runs after identity-based detection (bots, #39), so it costs no accuracy. Recommended in CI, where the stream is uploaded as an artifact.

  **Synthetic PR merge commit** — in PR-scoped mode (`--pr` / `--diff-base`), the merge head that `actions/checkout` creates for `pull_request` events (`Merge <sha> into <sha>`, authored by nobody) is skipped. It was inflating commit counts and coverage percentages on every PR comment — a 1-commit PR read as 2 commits. Standard time-windowed collection is unchanged: real merge commits are still collected and classified `automated`.

### Patch Changes

- Updated dependencies [4598854]
  - @aida-dev/core@0.12.0
  - @aida-dev/metrics@0.8.1

## 0.7.0

### Minor Changes

- fd7f8bf: Remove merge ratio (#20)

  Git history structurally cannot measure "% of AI commits that land": squash merges erase branch commits (the known #20 bug), and deleted branches erase abandoned work entirely, so the ratio trends toward 100% for every repo and discriminates nothing. Patching squash handling would not fix the survivorship bias — the data source deletes the negative outcomes. Removed rather than patched.
  - `metrics.json` no longer has `mergeRatio`; `baseline` is `{assumed, persistence}`, `delta` is persistence-only, `byMode` entries are `{commits, persistence}`.
  - Report drops the Merge Ratio section and the merge-ratio rows/columns.
  - `commit-stream.json` keeps `inDefaultBranchAncestry` (raw data stays available to consumers).

  The honest successor is a PR acceptance rate built on forge APIs, where declined PRs are never deleted — tracked separately.

### Patch Changes

- 3d3fc0e: Per-mode cohort metrics (#25, step 2)

  `metrics.json` gains a `byMode` block: merge ratio and persistence computed per autonomy level (`agent` / `assisted` / `autocomplete` / `none` / `unknown`), `null` for modes with no commits. Automated commits are excluded — automation is not authored code. The report renders a "By Autonomy Level" table.

  This is the comparison that stays meaningful in an AI-first world: agent vs assisted vs autocomplete, instead of AI vs human.

- Updated dependencies [3d3fc0e]
- Updated dependencies [fd7f8bf]
  - @aida-dev/metrics@0.8.0

## 0.6.3

### Patch Changes

- ddd86aa: 'automated' as fourth attribution state (#39)

  Merge commits and bot-authored commits are automation, not authored code — their provenance is known, yet they landed in `unknown`, dragging coverage down forever (and decaying it with every release) or getting pulled into cohorts by `defaultAttribution` priors.
  - New attribution state `automated`: auto-detected at collect time (merge commits via parent count, bots via the #21 blocklist matched against author/committer identity) or declared via manifest `excluded_commits`. In-commit AI evidence and manifest ai/human declarations always win over the structural heuristics.
  - Coverage now counts `automated` as known provenance: `(ai + human + automated) / total`.
  - Automated commits join no cohort and priors never touch them; they carry `mode: none`.
  - Report and logs show the automated count; the `defaultAttribution` prior note is hidden when there are no unknown commits left.

  Breaking for `metrics.json`/`commit-stream.json` consumers: attribution enum gains `automated`; the attribution block gains a required `automated` count.

- Updated dependencies [ddd86aa]
  - @aida-dev/core@0.11.0
  - @aida-dev/metrics@0.7.0

## 0.6.2

### Patch Changes

- 65e2464: Fix persistence semantics: survival with censoring, convention-driven categories excluded

  The file-level persistence metric measured the span from a file's first target-cohort touch to the **last** time anyone touched it — churn duration, not survival. A stable file never modified again scored 0 days (the best outcome counted as the worst), while a changelog touched by every release scored maximum.

  Now persistence = **survival**: days until the _first_ subsequent modification or deletion. Files never modified again are **censored** at collection time (they survived the window) and reported via a new `censored` count. Migrations (append-only by convention) and generated files (churned on every release) carry no quality signal and are excluded from persistence by default — new `filesConsidered`/`filesExcluded` fields make this visible; they still appear in the task-mix table.

  Found via community feedback on the task-mix feature. Breaking for `metrics.json` consumers: `persistence` gains required `filesConsidered`, `filesExcluded`, `censored` fields, and bucket distributions shift meaning.

- Updated dependencies [65e2464]
  - @aida-dev/metrics@0.6.0

## 0.6.1

### Patch Changes

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

- 027ff40: Cohort fairness context (#29 step 1, #36 step 1)

  `metrics.json` gains a `cohorts` block with, per cohort (AI and baseline):
  - **Age stats** (#29): commits, average and median age in days — older cohorts accumulate persistence by default, so comparing raw persistence across cohorts of different ages is misleading.
  - **Task mix** (#36): file touches classified as source / tests / migrations / config / docs / generated via path heuristics — a good persistence number may reflect _what_ the cohort worked on, not how well.

  The markdown report renders a "Cohort Fairness" table; a caveat warns to check it before reading the delta. Also fixed: manifest-excluded commits are never pulled into a cohort by the `defaultAttribution` prior — they were excluded precisely to stay out of both.

- Updated dependencies [0f4fb0d]
- Updated dependencies [690fc53]
- Updated dependencies [027ff40]
  - @aida-dev/core@0.10.0
  - @aida-dev/metrics@0.5.0

## 0.6.0

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

- Updated dependencies [5ddbaf4]
- Updated dependencies [9130689]
  - @aida-dev/core@0.9.0
  - @aida-dev/metrics@0.4.0

## 0.5.0

### Minor Changes

- 938a72d: Exclude non-AI automation bots from `Co-authored-by` trailer matching. Commits from `dependabot`, `renovate`, `github-actions`, `greenkeeper`, `snyk-bot`, `mergify`, `imgbot`, and `allcontributors` are no longer miscounted as explicit AI contributions.

  The blocklist is extensible via `botBlocklist` in `.aida.json` and the new `--ai-bot-blocklist` CLI flag.

  Also fixes PR-scoped collection (`--pr` / `--diff-base`) in CI checkouts: the default-branch commit set is now computed against the diff base ref (e.g. `origin/main`) instead of the bare branch name, which is unresolvable in a detached PR checkout.

### Patch Changes

- Updated dependencies [938a72d]
  - @aida-dev/core@0.8.0
  - @aida-dev/metrics@0.3.1

## 0.4.0

### Minor Changes

- Add comparative baseline metrics: compute merge ratio and persistence for both AI and non-AI commits, with baseline and delta in metrics.json and a side-by-side comparison table in report.md.

### Patch Changes

- Updated dependencies
  - @aida-dev/metrics@0.3.0

## 0.3.0

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
  - @aida-dev/metrics@0.2.0

## 0.2.0

### Minor Changes

- 194723a: 4-level AI attribution classification (explicit/implicit/mention/none). Only explicit and implicit commits are counted as AI-assisted, reducing false positives from tool mentions.

  Configurable AI tools via `.aida.json` config file and new CLI flags (`--ai-tool`, `--ai-trailer-domain`). Custom tools benefit from all 4 classification levels.

  Fix: `--ai-pattern` CLI flag was silently ignored due to Commander naming mismatch.

### Patch Changes

- Updated dependencies [194723a]
  - @aida-dev/core@0.6.0
  - @aida-dev/metrics@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [eed6a95]
  - @aida-dev/core@0.5.0
  - @aida-dev/metrics@0.1.6

## 0.1.5

### Patch Changes

- 5d27e31: Accurate merge ratio and multiple fixes

  **@aida-dev/core:**
  - Collect commits from all branches (`--all`) instead of only the default branch
  - Determine `inDefaultBranchAncestry` accurately using `git rev-list`
  - Deduplicate commits reachable from multiple branches
  - Use `git --name-status` for exact file status detection (added/modified/deleted/renamed)

  **@aida-dev/cli:**
  - Remove duplicate `report.json` output (was identical to `metrics.json`)
  - Remove unused `--format` flag from report command

- Updated dependencies [5d27e31]
  - @aida-dev/core@0.4.0
  - @aida-dev/metrics@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [503ef4a]
  - @aida-dev/core@0.3.1
  - @aida-dev/metrics@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [76f5bda]
  - @aida-dev/core@0.3.0
  - @aida-dev/metrics@0.1.3

## 0.1.2

### Patch Changes

- d86d3e2: Fix --since/--until date filters and remove maxCount cap (#4)
- Updated dependencies [d86d3e2]
  - @aida-dev/core@0.2.2
  - @aida-dev/metrics@0.1.2

## 0.1.1

### Patch Changes

- 2200625: Fix ESLint and Prettier configuration for monorepo
- Updated dependencies [2200625]
  - @aida-dev/metrics@0.1.1
  - @aida-dev/core@0.2.1

## 0.1.0

### Minor Changes

- da1d92c: Initial release of AIDA - AI Development Accounting CLI tool

### Patch Changes

- Updated dependencies [da1d92c]
  - @aida/core@0.2.0
  - @aida/metrics@0.1.0
