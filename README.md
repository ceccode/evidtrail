<h1 align="center">📊 AIDA Metrics</h1>

<p align="center">
  <strong>AIDA — AI Development Accounting</strong><br/>
  An auditable evidence ledger for AI-assisted software development.<br/>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@aida-dev/cli"><img src="https://img.shields.io/npm/v/@aida-dev/cli?label=cli&color=blue" alt="npm cli"></a>
  <a href="https://www.npmjs.com/package/@aida-dev/core"><img src="https://img.shields.io/npm/v/@aida-dev/core?label=core&color=blue" alt="npm core"></a>
  <a href="https://github.com/ceccode/AIDA-Metrics/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ceccode/AIDA-Metrics" alt="license"></a>
  <a href="https://github.com/ceccode/AIDA-Metrics/stargazers"><img src="https://img.shields.io/github/stars/ceccode/AIDA-Metrics?style=social" alt="stars"></a>
</p>

<p align="center">
  <a href="#why-aida">Why AIDA</a> •
  <a href="#features">Features</a> •
  <a href="#installation">Install</a> •
  <a href="#usage">Usage</a> •
  <a href="#ai-detection">AI Detection</a> •
  <a href="#metrics">Metrics</a> •
  <a href="#cicd-integration">CI/CD</a> •
  <a href="https://ceccode.github.io/AIDA-Metrics/">Demo</a>
</p>

---

## Why AIDA?

AI coding assistants are increasingly part of development workflows, but Git evidence is partial and easy to over-interpret. AIDA is for teams that need a bounded, auditable record of what their repository can actually establish — not a productivity score for people or models.

Here, **accounting means keeping a traceable ledger of evidence, scope, assumptions, and outcomes**. It does not mean that repository history alone can establish financial value. The ledger is the foundation on which later, explicitly modelled cost estimates can be built.

- Which autonomy modes are declared, inferred, or unknown?
- How often are files touched again within a fixed horizon?
- Are reverts or hotfix patterns over-represented for a cohort?
- Is the evidence coverage high enough to compare cohorts at all?

AIDA does **not** infer productivity, defects, deployment, causality, capitalization, or developer performance from Git history.

## Features

- **Provenance, not guesses** — Declared, inferred, and missing evidence remain distinct; `unknown` is never silently called human
- **Autonomy when stated** — `none` / `autocomplete` / `assisted` / `agent` describes the declared level of participation, separately from how AIDA knows
- **Configurable tool signals** — Add custom AI tools via `.aida.json` or CLI flags; a tool signal proves involvement, not a precise autonomy mode
- **Bounded Change Signals** — Fixed-horizon rapid-retouch rates with eligible and too-recent counts
- **Explicit Scope** — Default-branch ancestry by default; all refs and PR ranges are opt-in and labelled
- **Evidence-gated cohorts** — Autonomy and baseline overlays appear only when real evidence supports an honest comparison
- **Fast & Deterministic** — A metrics artifact is reproducible from the same collected snapshot; schemas reject incompatible inputs
- **Local by default** — Collection, analysis, blame, and reporting stay local; PR outcomes and comments are explicit network operations
- **CI comments** — GitHub Actions and GitLab CI can post a report with an explicit token and scoped permissions

## Installation

### Global CLI (Recommended)

```bash
npm install -g @aida-dev/cli
```

### From Source

Requires Node.js 22 or newer and pnpm.

```bash
git clone https://github.com/ceccode/aida-metrics.git
cd aida-metrics
pnpm install
pnpm build
```

## Core Metrics

1. **Rapid retouch (repo-level), and its trend**
   The share of eligible files touched again within 7, 30, and 90 days. A file is eligible after a qualifying retouch, or after it has remained untouched for the full horizon; unresolved recent files are reported separately. This is a churn signal, not proof of a defect or wasted work.

2. **Attribution and autonomy coverage**
   What the commit history declares or permits AIDA to infer, with `unknown` retained as a real answer. Tool identity proves involvement, not a precise autonomy mode.

3. **Cohort overlays**
   The same fixed-horizon signal by autonomy or AI/baseline cohort, shown only when evidence backs the cohorts and with task mix visible.

The report outputs a side-by-side table:

```markdown
| Metric | AI commits | Human baseline | Delta |
|---|---:|---:|---:|
| Retouched within 30d | 21.4% (12/56) | 24.1% (7/29) | −2.7 pt |
```

> AIDA reports observations and their limits. It does not turn correlation into causality.

## Quick Start

### Using Global CLI

```bash
# Install globally
npm install -g @aida-dev/cli

# Navigate to your Git repository
cd /path/to/your/repo

# Collect commits from last 90 days
aida collect --since 90d

# Analyze the data
aida analyze

# Generate reports
aida report
```

The first report is historical and may honestly contain `unknown`. To declare provenance for future commits, install the hook and configure a truthful mode through `AIDA_MODE` or the repository's `.aida.json`; when AIDA cannot determine a mode, it writes no trailer.

```bash
aida install-hooks
```

### Using from Source

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Collect commits from last 90 days
node packages/cli/dist/index.js collect --since 90d

# Analyze the data
node packages/cli/dist/index.js analyze

# Generate reports
node packages/cli/dist/index.js report
```

## For AI agents

[AGENTS.md](AGENTS.md) carries the working agreements for coding agents on this repo: how provenance is stamped, what counts as a regression test here, and the recurring defect class to watch for.

Security issues should be reported privately as described in [SECURITY.md](SECURITY.md). Repository paths, Git metadata, configuration, API responses, and generated artifacts are treated as untrusted input.

## Architecture

This is a TypeScript monorepo with three main packages:

- **`@aida-dev/core`** - Git collection, AI tagging, and data schemas
- **`@aida-dev/metrics`** - Attribution coverage and persistence calculations  
- **`@aida-dev/cli`** - Command-line interface for end users

## CLI Usage

### Commands

#### `aida collect`

Collect commits and generate normalized commit stream:

```bash
aida collect --since 90d --out-dir ./aida-output
```

#### `aida install-hooks`

Install the commit-time mode stamping hook:

```bash
aida install-hooks
```

#### `aida blame`

Compute line-level attribution (slow, opt-in):

```bash
aida blame --max-files 500
```

#### `aida fetch-prs`

Fetch pull request outcomes from the forge API (**opt-in and networked; `aida comment` is also networked**):

```bash
GITHUB_TOKEN=... aida fetch-prs --github-repo owner/name --since 90d
```

#### `aida analyze`

Calculate attribution coverage and persistence metrics:

```bash
aida analyze --out-dir ./aida-output
```

#### `aida report`

Generate human-readable reports:

```bash
aida report --out-dir ./aida-output
```

### Options

#### `aida collect`

- `--repo <path>` - Repository path (default: current directory)
- `--since <date>` - Start date (ISO or relative like 90d)
- `--until <date>` - End date (ISO or relative)
- `--pr` - PR-scoped analysis (auto-detect base ref from CI env vars)
- `--diff-base <ref>` - Explicit base ref for PR-scoped analysis (e.g., `origin/main`)
- `--ai-pattern <pattern>` - Custom AI detection regex (repeatable)
- `--ai-tool <name>` - Additional AI tool name (repeatable; contributes inferred involvement evidence)
- `--ai-trailer-domain <domain>` - Additional Co-authored-by domain (repeatable)
- `--ai-bot-blocklist <name>` - Non-AI bot to exclude from trailer matching (repeatable)
- `--default-branch <name>` - Default branch name (auto-detect if omitted)
- `--scope <value>` - Commit universe: `default-branch` (default) or `all-refs`
- `--redact-authors` - Replace author/committer identities with a per-run salted hash (recommended in CI)
- `--out-dir <path>` - Output directory (default: ./aida-output)
- `--verbose` - Verbose logging

#### `aida analyze`

- `--default-mode <value>` - Prior for commits with no evidence: `none` | `autocomplete` | `assisted` | `agent`
- `--coverage-threshold <fraction>` - Coverage below this flags metrics as low-confidence (default: 0.7)
- `--coverage-window <days>` - Window for the actionable coverage figure (default: 90)
- `--trend-granularity <value>` - Trend period: `month` | `quarter` (default: month)
- `--trend-window <days>` - Observation window applied equally to every trend period (default: 30)
- `--trend-periods <n>` - How many recent periods to report (default: 12)
- `--hotfix-window <days>` - Window for linking a hotfix to its likely antecedent (default: 7)
- `--out-dir <path>` - Output directory (default: ./aida-output)
- `--verbose` - Verbose logging

#### `aida report`

- `--out-dir <path>` - Output directory (default: ./aida-output)
- `--verbose` - Verbose logging

#### `aida install-hooks`

- `--repo <path>` - Repository path (default: current directory)
- `--force` - Overwrite an existing unrelated hook
- `--uninstall` - Remove the AIDA hook block
- `--if-git` - Exit quietly when there is no git repository (for `prepare` scripts)
- `--verbose` - Verbose logging

#### `aida blame`

- `--repo <path>` - Repository path (default: current directory)
- `--ref <ref>` - Git ref to blame (default: `HEAD`; use the collected stream's head when joining artifacts)
- `--max-files <n>` - Blame at most this many files, spread evenly across the tree (bounds runtime, flags the result as a sample)
- `--include-generated` - Also blame lockfiles and generated output
- `--out-dir <path>` - Output directory (default: ./aida-output)
- `--verbose` - Verbose logging

#### `aida fetch-prs`

- `--github-repo <owner/name>` - GitHub repository (default: `$GITHUB_REPOSITORY`)
- `--since <date>` - Only PRs closed after this date (ISO or relative like 90d)
- `--max-prs <n>` - Stop after this many PRs (bounds API usage)
- `--repo <path>` - Repository path, for reading `.aida.json`
- `--out-dir <path>` - Output directory (default: ./aida-output)
- `--verbose` - Verbose logging

Requires `GITHUB_TOKEN`. Without it the command refuses to run and PR acceptance stays **absent** from the report — never a silent 0%.

#### `aida comment`

- `--out-dir <path>` - Output directory (default: ./aida-output)
- `--dry-run` - Print report to stdout instead of posting
- `--verbose` - Verbose logging

## AI Detection

Message heuristics produce a detection **level**, which feeds the two axes above — `explicit` and `implicit` establish AI involvement, `mention` and `none` do not:

| Level        | Establishes AI? | Description                                            |
|--------------|-----------------|--------------------------------------------------------|
| **explicit** | yes             | Clear AI authorship — trailers, `[AI]` tag, creation verbs |
| **implicit** | yes             | AI involvement — suggestion/help language               |
| **mention**  | no              | Tool referenced but not used — "fix copilot bug"       |
| **none**     | no              | No AI reference                                        |

### Explicit Detection (high confidence)

- Git trailers: `AI: true`, `X-AI: true`
- Co-authors: `Co-authored-by` with known AI domains (`anthropic.com`, `openai.com`) or `*bot*`
  - **`github.com` is deliberately not an AI domain**: `@users.noreply.github.com` is the default email of every GitHub account, so matching it would flag ordinary humans who co-author through the web UI. AI bots hosted on GitHub (`copilot[bot]`, `copilot-swe-agent[bot]`) are caught by the `*bot*` rule instead.
- `[AI]` / `[ai]` tags
- Creation verbs + tool name: "generated by copilot", "written with claude"

Non-AI automation bots (`dependabot`, `renovate`, `github-actions`, `greenkeeper`, `snyk-bot`, `mergify`, `imgbot`, `allcontributors`) are excluded from trailer matching by default, so their commits are not miscounted as AI. Extend the list via `botBlocklist` in `.aida.json` or `--ai-bot-blocklist`.

### Implicit Detection

- Suggestion/help verbs + tool name: "copilot suggestions", "with help from claude"

### Mention (not counted as AI)

- Tool name in non-attribution context: "fix copilot bug", "add cursor support"
- Bare tool name without verb context

### Supported Tools (built-in)

`copilot`, `cursor`, `windsurf`, `codeium`, `claude`, `chatgpt`, `gemini`

### Commit-Time Mode Stamping (git hook)

The manifest is retroactive; a hook is **prospective** — it declares provenance at the moment the commit is made, turning `declared` from the exception into the norm ([#61](https://github.com/ceccode/AIDA-Metrics/issues/61)).

```bash
aida install-hooks          # writes .git/hooks/prepare-commit-msg
aida install-hooks --uninstall
```

#### Installing it in every clone

A hook is **per-clone state**, while `.aida.json` is committed and shared. So a repo can be set up for AIDA while the clone in front of you declares nothing — and nothing visibly breaks: the no-evidence bucket just grows and the 90-day coverage figure degrades without anyone deciding it should ([#75](https://github.com/ceccode/AIDA-Metrics/issues/75)).

Meet people at the one command every clone runs:

```json
{
  "scripts": {
    "prepare": "aida install-hooks --if-git"
  }
}
```

This repo follows its own advice — see [`scripts/install-hooks.mjs`](scripts/install-hooks.mjs). Because AIDA *is* the CLI here, the bootstrap imports the canonical hook body directly and installs it before `pnpm build`; a clean `pnpm install` therefore produces the same hook the published CLI would write.

`--if-git` exits 0 silently where there is no git to hook into — a tarball install, `npm ci` in a container, a Docker build context — instead of failing an unrelated install. Installation is idempotent and still refuses to overwrite a hook AIDA did not write, so `prepare` re-runs cost nothing.

AIDA deliberately does **not** install the hook from a `postinstall` script: mutating `.git` as a side effect of `npm install` violates least surprise, and install scripts are disabled in exactly the hardened setups that would care most. When it notices the gap it says so instead — if a repo has `.aida.json` but the local clone has no hook, the low-coverage warning names that specifically rather than repeating generic advice.

The hook appends an `AI-Mode:` trailer when the mode is known:

```
feat: add rate limiting

AI-Mode: agent
```

| Mode | Meaning |
|------|---------|
| `none` | Hand-written — the only mechanism that declares **human** authorship at commit time |
| `autocomplete` | Line-level suggestions |
| `assisted` | Supervised pair-programming |
| `agent` | Autonomous, multi-file work |

The mode describes **how the committed content was produced**, not who typed `git commit` or pushed the branch. If Codex, Claude Code, OpenCode, or another agent produced the change and a human reviewed and committed it manually, `agent` is still the truthful mode; Git's author/committer records the accountable person separately. Use `assisted` when the human substantially drove and wrote the implementation, and `none` only for genuinely hand-written work.

Resolution order: **`AIDA_MODE`** env var (explicit and reliable — set it in your agent, wrapper, or shell alias) → auto-detection of known agent environments (best-effort convenience) → `defaultMode` in `.aida.json` → **nothing**. When the mode is unknown the hook writes no trailer at all: an absent declaration honestly means unknown, while a guessed one would be a fabrication.

There are two deliberately different uses of `defaultMode`. Prospectively, the installed hook turns the repository policy into an `AI-Mode:` declaration on each new commit; contributors must override it when that policy is not true for a particular change. Retroactively, analysis can only treat the same setting as a prior for old untagged commits: changing config today cannot prove how yesterday's code was produced. Like any self-declaration, a trailer is auditable evidence, not cryptographic verification.

```bash
AIDA_MODE=agent git commit -m "feat: ..."
```

The hook is self-contained POSIX shell with no dependency on `aida` being installed, never blocks a commit whatever happens inside it, refuses to overwrite a hook it didn't write (unless `--force`), and removes only its own block on uninstall.

**Honest limit**: a hook is voluntary and local to each clone. It shrinks the unknown bucket, it does not eliminate it — someone who doesn't install it, or unsets the variable, is invisible to it.

### Attribution Manifest (`aida-attribution.json`)

Heuristics only see what commit messages admit to. The manifest lets you declare attribution **retroactively and explicitly** — for commits made before your team adopted trailers, or to correct heuristic false positives. Place it at the repo root; `aida collect` picks it up automatically ([#10](https://github.com/ceccode/AIDA-Metrics/issues/10)).

```json
{
  "version": "1.0",
  "tool": "windsurf",
  "model": "claude-opus",
  "mode": "agent",
  "note": "Commits made before Co-Authored-By trailers were adopted.",
  "ai_assisted_commits": [
    { "hash": "2f972ace3ff158fbe272d2850e879008abb0b197", "message": "first commit" },
    { "hash": "9f8e7d6c5b4a39281706f5e4d3c2b1a09876fedc", "message": "feat: inline suggestion", "mode": "autocomplete" }
  ],
  "human_authored_commits": [
    { "hash": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", "message": "fix: hand-written hotfix" }
  ],
  "excluded_commits": [
    { "hash": "1be7b68039b5156881c080def855c7d4dd30698d", "message": "chore: release packages", "reason": "Automated by changesets" }
  ]
}
```

| List | Effect |
|------|--------|
| `ai_assisted_commits` | Attribution `ai`, level `explicit`, source `manifest` |
| `human_authored_commits` | Attribution `human`, source `manifest` — the way to build a real human baseline |
| `excluded_commits` | Declares attribution `automated` (overrides heuristics) — for automation the auto-detection misses (bots not in the blocklist, templates) |
| `mode` (top-level or per-entry) | Declares the autonomy level of `ai_assisted_commits`: `autocomplete` \| `assisted` \| `agent` ([#25](https://github.com/ceccode/AIDA-Metrics/issues/25)). Per-entry beats top-level. A manifest mode is `declared` evidence; without one, AIDA infers a coarse mode from the tool named in trailers (`inferred`) |

Precedence: in-commit evidence beats retroactive declarations. A commit with an explicit AI trailer stays `ai` even if the manifest declares it human (with a warning); `excluded_commits` always wins, since it exists to correct heuristic false positives. Full hashes are matched exactly (`message` is documentation only); an invalid manifest logs a warning and is ignored — it never fails `collect`.

### Privacy: no leaderboards

AIDA compares **cohorts of commits, never people**. This is a design constraint, not a default:

- No per-author metric will ever ship. Requests for per-developer breakdowns are out of scope by policy, not by omission.
- `commit-stream.json` carries author identities so identity-based detection (bots, #39) can work — but that file travels: committed to CI, uploaded as an artifact. Pass `--redact-authors` (or set `redactAuthors` in `.aida.json`) to replace names and emails with a **per-run salted hash**: stable within one output file, so grouping still works, but not reversible to a person and not correlatable across runs.
- Redaction runs *after* detection, so enabling it costs no accuracy.

Git history itself is not anonymous, so nobody can stop a determined manager from writing their own script. What AIDA can do is refuse to make it convenient ([#35](https://github.com/ceccode/AIDA-Metrics/issues/35)).

### Configuration File (`.aida.json`)

Place a `.aida.json` file in your project root to add custom tools, trailer domains, and patterns:

```json
{
  "tools": ["devbot", "codyai", "internal-copilot"],
  "trailerDomains": ["mycompany\\.com"],
  "botBlocklist": ["acme-ci-bot"],
  "patterns": ["my-custom-regex"],
  "defaultMode": "assisted",
  "coverageThreshold": 0.7
}
```

| Field | Description |
|-------|-------------|
| `tools` | Additional AI tool names — benefits from all 4 classification levels |
| `trailerDomains` | Additional domains for `Co-authored-by` trailer matching |
| `botBlocklist` | Additional non-AI bots to exclude from `Co-authored-by` trailer matching |
| `patterns` | Raw regex patterns (treated as explicit) |
| `defaultMode` | The repo's autonomy level when nothing else determines it. Two moments, one key: the commit hook stamps it as an `AI-Mode:` trailer (making new commits `declared`), and `aida analyze` applies it as a **prior** to older commits with no evidence. A prior joins a cohort but never raises coverage. Absent = no assumption: those commits join no cohort, and AIDA does not invent a comparison. This repo sets `agent`. |
| `coverageThreshold` | Attribution coverage below this fraction (default `0.7`) flags attribution-dependent sections as low-confidence |
| `redactAuthors` | Replace author/committer identities in `commit-stream.json` with a per-run salted hash (default `false`; recommended in CI) |

### CLI Flags

Override or supplement `.aida.json` via CLI:

```bash
aida collect --ai-tool "devbot" --ai-tool "codyai"
aida collect --ai-trailer-domain "mycompany.com"
aida collect --ai-bot-blocklist "acme-ci-bot"
aida collect --ai-pattern "my-custom-regex"
aida analyze --default-mode none --coverage-threshold 0.8
```

## Metrics

### Quality Over Time

The comparator that replaces cohorts ([#77](https://github.com/ceccode/AIDA-Metrics/issues/77) step 3). Once AI participates in nearly every commit, "AI vs human" has no second side left — `No baseline cohort` becomes the normal outcome, not bad luck. What still answers *"is this getting better or worse?"* is the repo compared with **its own past**.

`metrics.trend` slices the same repo-level change signal by calendar period (month or quarter), derived from the commit stream in a single run — a team gets a trend the first time they run AIDA, not after months of archiving reports.

Two mechanisms keep it honest, because the naive version is guaranteed to lie:

- **Every period is measured through the same observation window** (`--trend-window`, default 30 days). A period from last year would otherwise accumulate survival simply by having existed longer. This is the age-normalization of [#29](https://github.com/ceccode/AIDA-Metrics/issues/29), applied to time instead of cohorts.
- **A period is *mature* only once it has been over for that full window.** Before then its files have had less time to be reworked than every earlier period. Immature periods are reported and marked, never compared — without this, *every report ever generated* would find quality declining, because the newest period is always the least observed.

When fewer than two mature periods exist, AIDA says so instead of drawing a line through one point.

### Autonomy

The primary model ([#25](https://github.com/ceccode/AIDA-Metrics/issues/25)). Every commit is described on **two orthogonal axes**:

| Axis | Values | Question |
|---|---|---|
| **Involvement** (`mode`) | `none` · `autocomplete` · `assisted` · `agent` · `unknown` | What level of AI participated? |
| **Evidence** | `declared` · `inferred` · `none` | How do we know? |

They are separate because they fail separately. `mode: unknown, evidence: inferred` is a real state — we know AI participated, we cannot say at what level — and the old single-axis model had to misreport it as "no evidence".

`declared` means someone stated it: the `AI-Mode:` trailer written by the commit hook, or the attribution manifest. `inferred` means AIDA concluded it from tool identity or commit structure. Automation ([#39](https://github.com/ceccode/AIDA-Metrics/issues/39) — merge commits, known bots, manifest `excluded_commits`) is a third, orthogonal flag: its provenance is known, so it counts toward coverage, but it joins no autonomy cohort, because automation is not authored code.

**Coverage** = share of commits with any evidence at all (`declared` + `inferred`). It gates the *attribution-dependent* sections, not the report: repository-level change signals need no attribution evidence and open the report, while coverage lives in a Data Quality section at the end.

**The three-state view survives as a projection.** `ai` (mode above `none`), `human` (declared `none`), `automated`, `unknown` (no evidence) are derived from the axes above — never decided independently — and kept because a headline needs one word. The rich model underneath, the one-line summary on top.

Why the axes and not the binary: for most teams today AI participates in nearly every commit, so "was AI involved?" trends to *yes* and stops discriminating anything. What still separates risk, cost, and quality is **at what autonomy level**.

Coverage is reported over **two windows** ([#52](https://github.com/ceccode/AIDA-Metrics/issues/52)): all-time, and a recent window (default 90 days, `--coverage-window`). The recent figure is the actionable one — it answers *"are we tagging now?"* rather than passing a permanent verdict on history that predates adoption — so it is what drives the low-confidence warning below `coverageThreshold` (default 70%). All-time stays visible as context, never replaced.

`defaultMode` lets a team consciously assign no-evidence commits to an autonomy level (`none` for traditional repos, `assisted`/`agent` for AI-first ones). The prior affects cohort metrics but never coverage: an assumption is not evidence, so a repo leaning on it still reports how little it actually knows, and an assumed baseline is labeled as such.

**A prior can never create an overlay on its own** ([#77](https://github.com/ceccode/AIDA-Metrics/issues/77) step 4). A cohort whose every commit was placed there by `defaultMode` is the assumption describing itself, so the report withholds it — with an explanation, never silently — and says the same for an AI-vs-baseline comparison where one side is pure prior. One commit with real evidence is enough to unlock the overlay, with the prior's share still labelled `(N assumed)`. The cohorts stay in `metrics.json` either way: the gate is on presentation, not on collection.

### By Autonomy Level

Persistence computed per autonomy mode (`agent` / `assisted` / `autocomplete` / `none`) ([#25](https://github.com/ceccode/AIDA-Metrics/issues/25)). Automated commits are excluded; modes with no commits are `null`. A mode whose every commit was placed by the `defaultMode` prior is withheld from the report rather than rendered as a measurement ([#77](https://github.com/ceccode/AIDA-Metrics/issues/77) step 4) — the data stays in `metrics.json`.

### PR Merge Outcome

Merged vs closed-unmerged pull requests from the forge API ([#51](https://github.com/ceccode/AIDA-Metrics/issues/51)), broken down by attribution and autonomy level. Merge is an observable repository outcome, not proof of review quality, deployment, or business acceptance.

This is the successor to the removed git-only merge ratio. The forge preserves closed-unmerged outcomes that landed history cannot represent.

Two deliberate properties:

- **Opt-in and additive.** Collection, analysis, blame, and report generation stay local. `aida fetch-prs` and `aida comment` are the explicit network commands. `aida fetch-prs` currently reads GitHub PR outcomes; `aida comment` supports GitHub Actions and GitLab CI. Without a token the PR metric is absent, with a caveat saying so.
- **No author identity is ever fetched or stored.** `pr-stream.json` holds PR numbers, outcomes, dates, and the attribution of the PR's own commits — nothing that names anyone ([#35](https://github.com/ceccode/AIDA-Metrics/issues/35)).

PRs are attributed from **their own commit messages as returned by the API**, not from a join against local git. That is what makes this work for squash-merged PRs whose branches no longer exist — the exact case where git-based measurement failed.

### Why there is no Merge Ratio

Early versions shipped a merge ratio ("% of AI commits that land on the default branch"). We removed it ([#20](https://github.com/ceccode/AIDA-Metrics/issues/20)) because git history structurally cannot answer that question honestly:

- **Squash merges destroy the numerator's evidence** — branch commits vanish from history, so unmerged work disappears.
- **Survivorship bias destroys the denominator** — abandoned branches get deleted, so discarded work leaves `git log --all` entirely. The ratio trends toward 100% for everyone and discriminates nothing.

A rough metric with visible error bars is worth shipping; a metric whose data source systematically deletes the negative outcomes is not. The honest successor is the **PR acceptance rate** collected with `aida fetch-prs` from forge APIs (GitHub/GitLab), where declined PRs are never deleted.

### Rapid Retouch

Share of files touched again within fixed 7, 30, and 90-day horizons ([#22](https://github.com/ceccode/AIDA-Metrics/issues/22)). The report gives the numerator, eligible denominator, too-recent count, and rate for every horizon.

**Right-censoring is handled explicitly**: a file first touched two days ago and not retouched has no known answer to a seven-day question, so it is excluded from the denominator and counted as too recent. A retouch already observed inside the horizon is a known outcome immediately.

**Honest limit**: it is file-level. A second touch can be normal iteration, review feedback, feature extension, formatting, or a defect fix. AIDA therefore calls this *rapid retouch*, not rework, and never treats it as causality by itself.

Metric contract:

| Contract field | Definition |
|---|---|
| Commit universe | The stream's labelled scope: default-branch ancestry by default (prefers `origin/HEAD` when available), all refs or a PR range only when requested |
| Unit | A non-generated, non-migration file first touched by the target cohort; repo-level uses all authored commits |
| Entry time | Committer time of the first target touch, used as the local Git proxy for integration time |
| Event | The first topologically subsequent commit that modifies or deletes the same path |
| Censoring | Observation ends at `commit-stream.generatedAt`; files with no event and insufficient follow-up are `tooRecent` and excluded from the denominator |
| Horizons | Fixed at 7, 30, and 90 days; trend uses its configured fixed observation window |
| Permitted reading | “Of files with a known N-day outcome, X% were touched again within N days” |
| Forbidden reading | Defect rate, wasted work, productivity, causality, deployment, line survival, or developer performance |

### Line Survival (`aida blame`)

Exact per-line attribution from `git blame` ([#23](https://github.com/ceccode/AIDA-Metrics/issues/23)) — of the lines alive in the tree right now, which commit last wrote each one, and at what autonomy level. This is the direct answer that file-level persistence could only approximate: one AI line in a thousand no longer marks a whole file.

```bash
aida blame          # writes blame-stream.json
aida analyze        # picks it up automatically when present
```

Kept in its own opt-in command because it runs one git process per file — the most expensive thing AIDA does. Budget roughly 100ms per file: babel's 28,732-file tree is an hours-long run, where `collect` over the same repo takes 13 seconds. `--max-files` bounds the walk by striding evenly across the tree, so the sample spans the whole repo rather than the first N paths in alphabetical order, and the result is flagged as a sample. Binary files are detected and excluded, since `git blame` reports a whole blob as a single line rather than failing; files where blame genuinely errors (submodules, missing objects) are counted in `filesFailed` and warned about, never folded into the skipped count.

**What it measures exactly**: the living codebase — those share figures are precise. **What it cannot measure**: deleted lines, because blame only sees what survived. The derived "approximate survival of AI-introduced lines" is therefore labelled as approximate: a line rewritten twice was added twice, and additions to files since deleted or renamed fall outside the count. Both halves of that ratio are scoped to the files blame actually visited — otherwise a capped or filtered walk divides a fraction of the repo by all of it.

### Legacy Follow-up Distribution

`metrics.json` retains the pre-1.0 follow-up duration fields for consumers, but the report does not use their average or median as a quality headline: those summaries mix event durations with right-censored follow-up.

- Files never modified again are **censored** at collection time — they survived the whole observation window, the best possible outcome (not zero). The report shows how many.
- **Migrations and generated files** (lockfiles, changelogs, snapshots) are excluded by default: their lifecycle is convention-driven — append-only or churned on every release — and carries no quality signal either way. They still appear in the task-mix table.
- Buckets: 0-1d, 2-7d, 8-30d, 31-90d, 90d+, with legacy average and median follow-up.
- Known roughness: multi-commit sessions touching the same file produce short survivals (the clock starts at the first touch); line-level tracking ([#23](https://github.com/ceccode/AIDA-Metrics/issues/23)) will refine this.

### Comparative Baseline

Persistence is computed for the baseline (autonomy level `none`) cohort as well.  
The `metrics.json` output includes `baseline` and `delta` (AI minus baseline) sections.  
The markdown report renders the side-by-side table under `## AI vs Baseline`, below Repository Change Signals — the comparison is a lens, not the headline ([#77](https://github.com/ceccode/AIDA-Metrics/issues/77)).
If no commits sit at autonomy level `none` and no `defaultMode` prior assigns the no-evidence ones, `baseline` and `delta` are `null`: AIDA does not invent a comparison cohort. And when one side exists *only* because of the prior, the comparison is withheld with an explanation rather than shown — a measured cohort against an assumed one yields a delta that describes the prior, not the repo.

### Fair Comparison (age-normalized)

The raw AI vs Baseline table can be misleading when one cohort's commits are systematically older or younger than the other's — an older cohort accumulates persistence simply from having existed longer, not from better code ([#29](https://github.com/ceccode/AIDA-Metrics/issues/29)).

`metrics.json` gains `fairComparison`: both cohorts' persistence recomputed with each file's observation window **capped** to `capDays` — the younger cohort's average commit age — so neither side gets credit for clock time it hasn't actually had. Reported alongside the raw comparison, never in place of it. Null under the same condition as `baseline` (no human-attributed commits and no prior).

### Within-Category Comparison

A pooled AI-vs-baseline delta can hide a task-mix confound: if AI mostly touches tests and humans mostly touch source, the delta reflects *what* each cohort worked on, not code quality ([#36](https://github.com/ceccode/AIDA-Metrics/issues/36)).

`metrics.json` gains `byCategory`: persistence computed separately per file category (`source` / `tests` / `migrations` / `config` / `docs` / `generated`) for each cohort, with a delta only where both sides touched that category. Always present — useful even without a baseline, e.g. to compare AI-written tests against AI-written source within the same repo.

### Outcome Correlation

Whether AI-generated code causes more rework is the highest-value question for engineering leadership — but most of it (incidents, vulnerabilities) lives outside git, in PagerDuty/Jira/SAST tools, and pulling those in would need network access AIDA deliberately doesn't have for its core commands ([#26](https://github.com/ceccode/AIDA-Metrics/issues/26)). Scoped to what git itself can answer:

- **Reverts**: a `git revert` writes "This reverts commit \<sha\>." into the generated commit's body — parsed at collect time into `revertsCommit`. `metrics.json`'s `outcomeCorrelation.reverts` reports how many were found and resolved, broken down by the **reverted** commit's attribution and autonomy mode.
- **Hotfixes**: commits matching a `fix`/`hotfix`/`patch` subject convention. Each is linked to the most recent prior commit that touched the same file(s), within a window (default 7 days, `--hotfix-window`) — the closest antecedent across all its files, so a hotfix touching several files links to whichever was most recently disturbed. `outcomeCorrelation.hotfixes` reports totals, how many were linked, and the antecedent's attribution/mode.

**Counts are reported against the base rate, never alone.** A cohort's share of reverts only means something next to its share of authored commits: in a repo that is 90% AI, 90% of reverts being AI is exactly what you'd expect and says nothing. Each row therefore carries `share`, `baseRate` and their `ratio` — **1.00× is what the cohort's size predicts**, above is an excess, below is better than average. Automated commits are excluded from both sides, since automation isn't authored work.

Validated on `anthropics/claude-code-action`: the raw counts (3 of 11 reverts, 49 of 140 hotfix antecedents) look alarming until the ratios show 1.13× for reverts — no signal at all — against 1.45× for hotfixes, a real but modest excess.

The ratios are descriptive, not causal, and on small counts a single commit moves them a long way.

Both are always present in `metrics.json` (never gated on a baseline cohort — they're a property of the repo, not a comparison) and rendered in the report only when at least one is non-zero.

### Known Limits

These metrics are honest approximations, not ground truth. Read the numbers with these caveats in mind:

- **Shallow clones silently truncate everything** — `actions/checkout` defaults to `fetch-depth: 1` and GitLab CI to depth 20, which would make every metric describe a fragment of history. AIDA detects this and warns, but the fix is on your side: set `fetch-depth: 0` / `GIT_DEPTH: 0`.
- **Detection is voluntary** — AIDA only sees what commits admit to. Untagged AI code lands in the `unknown` bucket, and attribution coverage ([#34](https://github.com/ceccode/AIDA-Metrics/issues/34)) reports how big that bucket is instead of hiding it; the attribution manifest ([#10](https://github.com/ceccode/AIDA-Metrics/issues/10)) lets you shrink it retroactively. But the tool still cannot see through a commit that lies.
- **Git can't see discarded work** — squash merges and deleted branches erase unmerged commits, which is why the merge ratio was removed entirely rather than patched ([#20](https://github.com/ceccode/AIDA-Metrics/issues/20)). PR acceptance ([#51](https://github.com/ceccode/AIDA-Metrics/issues/51)) answers the question from the forge API instead.
- **The attribution manifest does not apply to PR commits** — manifest entries are keyed by hash, and a squash-merged PR's original commits have different hashes from what landed on the default branch. PR-level attribution therefore relies on trailers alone, so a repo that adopted trailers late will see more `unknown` PRs than `unknown` commits.
- **Persistence and rework are file-level** — one AI-touched line marks the whole file. `aida blame` ([#23](https://github.com/ceccode/AIDA-Metrics/issues/23)) gives exact per-line attribution for the living codebase; the file-level figures remain as the fast path.
- **Cohort age skews raw persistence** — older commits have had more time to accumulate survival. The report shows each cohort's age, and the fair comparison ([#29](https://github.com/ceccode/AIDA-Metrics/issues/29)) caps both sides to the same observation window so a stale delta can't pass as a quality signal.
- **Task mix skews pooled persistence** — AI is often pointed at boilerplate, tests, and migrations, which survive longer because nobody has a reason to touch them. The within-category comparison ([#36](https://github.com/ceccode/AIDA-Metrics/issues/36)) compares like with like instead of pooling.
- **Outcome correlation is git-only** — hotfix linking is a heuristic (closest prior touch within a window, not proven causation), and a chained hotfix attributes to the immediately preceding fix rather than the original commit. Incidents and vulnerabilities aren't represented at all ([#26](https://github.com/ceccode/AIDA-Metrics/issues/26)).

## Output Files

- `commit-stream.json` - Normalized commit data on the two axes: autonomy `mode` and `evidence`, with the three-state `attribution` derived from them
- `metrics.json` - Repo-level change signals (`repo`), trend, evidence coverage, per-cohort and per-autonomy-level metrics
- `blame-stream.json` - Per-commit surviving line counts (only when `aida blame` ran)
- `pr-stream.json` - PR outcomes and per-PR attribution (only when `aida fetch-prs` ran)
- `report.md` - Human-readable Markdown report

### Schema versioning

Both JSON files carry a `schemaVersion` ([#53](https://github.com/ceccode/AIDA-Metrics/issues/53)). The contract:

- **Additive changes** (a new field) do **not** bump the version — consumers keep working.
- **Removing a field, renaming it, or changing its meaning** bumps `schemaVersion`.
- Readers **refuse** a version they don't understand rather than parsing it half-way: `aida analyze` on a stale `commit-stream.json` fails with `Rerun 'aida collect'`, not a silent wrong result.

Current: `commit-stream.json` **v3**, `metrics.json` **v3**, `pr-stream.json` **v2**, `blame-stream.json` **v3**.

The v3 contract binds artifacts to a labelled commit scope and head snapshot, makes default-branch ancestry the default universe, and adds fixed-horizon rapid-retouch outcomes. Blame v3 carries its HEAD for join validation; PR v2 labels incomplete commit lists.

## CI/CD Integration

### GitHub Actions (with PR comments)

The job that posts comments needs `contents: read` and `pull-requests: write`; organizations that default `GITHUB_TOKEN` to read-only must declare these permissions explicitly.

```yaml
- uses: actions/checkout@v5
  with:
    # REQUIRED: the default (fetch-depth: 1) gives AIDA a single commit,
    # and every metric would then describe that fragment as if it were
    # the whole history. AIDA warns when it detects a shallow clone.
    fetch-depth: 0

- name: Install AIDA
  run: npm install -g @aida-dev/cli

- name: Run AIDA Analysis
  run: |
    aida collect --pr
    aida analyze
    aida report
    aida comment
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Upload Reports
  uses: actions/upload-artifact@v4
  with:
    name: aida-reports
    path: aida-output/
```

`aida comment` auto-detects the CI provider and posts the report as a PR comment. On subsequent pushes, it **updates** the existing comment instead of creating duplicates.

Use `--dry-run` to print the report to stdout without posting.

### PR-Scoped vs Time-Based Analysis

Use `--pr` for PR-specific metrics (analyzes only commits in the current PR):

```bash
aida collect --pr              # Auto-detect base ref from CI env vars
aida collect --diff-base origin/main  # Explicit base ref
```

Or use `--since` for time-based analysis:

| Approach | `--since` | Best for |
|----------|-----------|----------|
| Per-PR | `--pr` | PR-specific metrics (recommended) |
| Sprint report | `14d` or `30d` | Sprint retrospectives, scheduled runs |
| Monthly audit | `90d` | Management/finance reporting |
| Full history | *(omit)* | One-time baseline analysis |

### GitLab CI (with MR comments)

```yaml
aida_analysis:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GITLAB_TOKEN: $AIDA_GITLAB_TOKEN
    # REQUIRED: GitLab shallow-clones by default (depth 20). AIDA warns
    # when it detects one, since truncated history skews every metric.
    GIT_DEPTH: 0
  script:
    - npm install -g @aida-dev/cli
    - aida collect --pr --redact-authors
    - aida analyze
    - aida report
    - aida comment
  artifacts:
    paths:
      - aida-output/
```

`aida comment` auto-detects GitLab CI and posts the report as a merge request note, updating its own note on re-runs instead of adding new ones ([#16](https://github.com/ceccode/AIDA-Metrics/issues/16)).

**Token**: set `GITLAB_TOKEN` to a project or group access token with the `api` scope. The built-in `CI_JOB_TOKEN` cannot post notes, so it is deliberately not used as a fallback — the command fails with that explanation rather than an opaque 401.

Bitbucket is currently out of scope ([#17](https://github.com/ceccode/AIDA-Metrics/issues/17) closed); the `CIProvider` interface stays provider-agnostic if someone wants to add it.

## Repository Structure

```bash
/aida-metrics
├── packages/
│   ├── cli/           # @aida-dev/cli
│   ├── core/          # @aida-dev/core
│   └── metrics/       # @aida-dev/metrics
├── .github/workflows/ # CI/CD automation
└── docs/             # Landing page (GitHub Pages)
```

## Roadmap

- **v0.1** ✅ Git-based metrics (Merge Ratio + Persistence).  
- **v0.2** ✅ AI detection for Claude Code, ChatGPT, Gemini, Copilot, Cursor, Windsurf, Codeium.  
- **v0.3** ✅ Attribution classification: explicit / implicit / mention / none ([#7](https://github.com/ceccode/AIDA-Metrics/issues/7)).  
- **v0.4** ✅ PR comment integration for GitHub Actions.  
- **v0.5** ✅ PR-scoped analysis with `--pr` and `--diff-base` flags ([#18](https://github.com/ceccode/AIDA-Metrics/issues/18)).  
- **v0.6** ✅ Comparative baseline — AI vs non-AI metrics with delta ([#19](https://github.com/ceccode/AIDA-Metrics/issues/19)).  
- **v0.7** ✅ Exclude non-AI bots (dependabot, renovate, …) from trailer matching, with configurable blocklist ([#21](https://github.com/ceccode/AIDA-Metrics/issues/21)).  
- **v0.8** ✅ Attribution coverage as headline metric — three-state `ai`/`human`/`unknown`, `defaultAttribution` prior, nullable baseline ([#34](https://github.com/ceccode/AIDA-Metrics/issues/34)).  
- **v0.9** ✅ Attribution manifest — retroactive `ai`/`human`/`excluded` declarations via `aida-attribution.json` ([#10](https://github.com/ceccode/AIDA-Metrics/issues/10)).  
- **v0.10** ✅ Cohort fairness context — age stats ([#29](https://github.com/ceccode/AIDA-Metrics/issues/29), step 1) and task mix by file category ([#36](https://github.com/ceccode/AIDA-Metrics/issues/36), step 1) per cohort.  
- **v0.11** ✅ Autonomy mode collection — `mode` × `evidence` per commit, manifest declarations, tool inference ([#25](https://github.com/ceccode/AIDA-Metrics/issues/25), step 1).  
- **v0.12** ✅ `automated` attribution state — merge commits and bots auto-detected, coverage counts known automation ([#39](https://github.com/ceccode/AIDA-Metrics/issues/39)).  
- **v0.13** ✅ Per-mode cohort metrics — persistence per autonomy level ([#25](https://github.com/ceccode/AIDA-Metrics/issues/25), step 2).  
- **v0.14** ✅ Merge ratio removed — git cannot measure it honestly; PR acceptance rate via forge APIs is the successor ([#20](https://github.com/ceccode/AIDA-Metrics/issues/20)).  
- **v0.15** ✅ Author redaction ([#35](https://github.com/ceccode/AIDA-Metrics/issues/35)) and synthetic PR merge commit fix ([#40](https://github.com/ceccode/AIDA-Metrics/issues/40)).  
- **v0.16** ✅ Versioned output schemas with reader-side version gate, plus end-to-end CLI tests and `pnpm typecheck` in CI ([#53](https://github.com/ceccode/AIDA-Metrics/issues/53)).  
- **v0.17** ✅ PR acceptance rate via forge APIs — opt-in `aida fetch-prs`, the honest successor to merge ratio ([#51](https://github.com/ceccode/AIDA-Metrics/issues/51)).  
- **v0.18** ✅ Commit-time mode stamping via git hook — `AI-Mode` trailer, `declared` evidence at the source ([#61](https://github.com/ceccode/AIDA-Metrics/issues/61)).  
- **v0.19** ✅ Windowed coverage ([#52](https://github.com/ceccode/AIDA-Metrics/issues/52)) and rework rate with censoring ([#22](https://github.com/ceccode/AIDA-Metrics/issues/22)).  
- **v0.20** ✅ GitLab CI provider — MR comments with note reuse ([#16](https://github.com/ceccode/AIDA-Metrics/issues/16)).  
- **v0.21** ✅ Line-level survival via `aida blame` — exact per-line attribution, binaries excluded ([#23](https://github.com/ceccode/AIDA-Metrics/issues/23)).
- **v0.22** ✅ Age-normalized fair comparison ([#29](https://github.com/ceccode/AIDA-Metrics/issues/29)), within-category comparison ([#36](https://github.com/ceccode/AIDA-Metrics/issues/36)), git-scoped outcome correlation — reverts and hotfixes ([#26](https://github.com/ceccode/AIDA-Metrics/issues/26)).  
- **v0.23** ✅ Autonomy as the primary axis — involvement × evidence, with three-state attribution demoted to a derived projection; coverage measured on the evidence axis; `defaultAttribution` replaced by `defaultMode` ([#25](https://github.com/ceccode/AIDA-Metrics/issues/25)). Schema v2.
- **v0.24** ✅ `--if-git` and a documented `prepare` recipe, so hook installation reaches every clone; the low-coverage warning names a missing hook in a configured repo ([#75](https://github.com/ceccode/AIDA-Metrics/issues/75)).
- **v0.25** ✅ Quality-first, steps 1–2 ([#77](https://github.com/ceccode/AIDA-Metrics/issues/77)): repo-level `repo` block in `metrics.json` (cohort-free persistence and rework, prior-proof), and the report reframe — Code Quality opens, the autonomy lens follows, coverage demoted to a Data Quality footnote.
- **v0.26** ✅ Quality over time, step 3 ([#77](https://github.com/ceccode/AIDA-Metrics/issues/77)): `metrics.trend` — per-period persistence, rework and coverage derived from the commit stream in a single run, every period measured through the same observation window, immature periods reported but never compared.
- **v0.27** ✅ Overlay gating, step 4 ([#77](https://github.com/ceccode/AIDA-Metrics/issues/77)) — cohort tables render only where real evidence backs them; a `defaultMode` prior can no longer conjure an autonomy cohort or a baseline comparison out of assumption alone. Completes the quality-first migration.
- **v1.0** ✅ Security and measurement contract: shell-free Git execution, default-branch scope, snapshot-bound schema v3, deterministic analysis, fixed-horizon rapid retouch, complete/labelled PR collection, and minimum-permission CI.
- **Post-1.0** → Confidence intervals and minimum-sample guidance; explicit deployment/change-management joins for teams that need production scope; provider parity; removal of deprecated raw follow-up summaries in the next major version.
- **AI cost scenarios** → Separate exact provider receipts, team-declared usage, and clearly labelled modelled estimates. A source diff or LOC may inform a counterfactual scenario, but never prove real token use, actual spend, or an accounting value.
- **Exploratory accounting layer** → Scenario-based token and cost estimates, clearly separated from observed evidence. A first model may assume all AI-attributed output was generated by AI and expose model price, tokenization, input/output multiplier, retries, and uncertainty as user-controlled assumptions. It must report a range and provenance for every assumption—never present lines of code as measured token consumption or estimated cost as booked financial value.

### Direction: from AI detection to AI accountability

In an AI-first world, "was this commit written by AI?" is becoming the wrong question — the honest answer trends toward "yes, mostly". AIDA's direction reflects that:

- **Autonomy as the primary axis** — involvement × evidence ([#25](https://github.com/ceccode/AIDA-Metrics/issues/25)) replaced the three-state attribution as the model; the three states survive as a projection for the headline ([#34](https://github.com/ceccode/AIDA-Metrics/issues/34)). **Coverage** — now measured on the evidence axis — stays the first number in every output ("62% known provenance · 38% no evidence" is a data-quality signal, not something to hide inside a default), because the no-evidence bucket grows fastest exactly where the numbers are taken most seriously. The `defaultMode` prior lets AI-first teams opt into an assumed autonomy level, consciously, without it ever counting as evidence.
- **Quality over adoption** — the durable question is not "how much code is AI?" but "does AI code hold up?": rework rate ([#22](https://github.com/ceccode/AIDA-Metrics/issues/22)), line-level survival ([#23](https://github.com/ceccode/AIDA-Metrics/issues/23)), outcome correlation ([#26](https://github.com/ceccode/AIDA-Metrics/issues/26)).
- **Autonomy over the binary** — autocomplete vs assisted vs agent ([#25](https://github.com/ceccode/AIDA-Metrics/issues/25)) has replaced AI/non-AI as the model. The binary remains available as a projection, not as the thing being measured.
- **Shrink the unknown at the source** — the attribution manifest ([#10](https://github.com/ceccode/AIDA-Metrics/issues/10)) makes attribution declarative retroactively; commit-time stamping via git hooks ([#61](https://github.com/ceccode/AIDA-Metrics/issues/61)) makes it automatic going forward. Both shipped.
- **Cohorts, not people** — AIDA compares groups of commits, never developers. No per-author aggregation will ever ship, and author identity can be redacted from output artifacts ([#35](https://github.com/ceccode/AIDA-Metrics/issues/35), shipped) so the data model doesn't hand anyone a leaderboard for free.

## Contributing

This is just the starting point. We are looking for contributors who can help with:  

- Designing robust metrics  
- Building integrations
- Improving analysis pipelines  
- Validating approaches with real-world projects  

### Git Workflow

We use a simple, main-branch workflow with automated publishing:

1. **Create Feature Branch**

   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

2. **Make Changes & Commit**

   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

3. **Add Changeset** (for version bumps)

   ```bash
   pnpm changeset
   # Select packages to version
   # Choose version bump type (patch/minor/major)
   # Add description for changelog
   ```

4. **Open Pull Request**
   - Target: `main` branch
   - Include changeset file if versioning needed
   - Describe changes and testing

5. **Merge & Auto-Publish**
   - Once merged, GitHub Actions automatically publishes to NPM
   - Feature branch gets deleted after merge

### AI Attribution Convention

If you use AI assistants (Claude, Copilot, ChatGPT, Cursor, Windsurf, etc.) while contributing, please add a `Co-Authored-By` trailer to your commit messages:

```bash
git commit -m "feat: add new feature

Co-Authored-By: Claude <noreply@anthropic.com>"
```

Common trailers:

- `Co-Authored-By: Claude <noreply@anthropic.com>`
- `Co-Authored-By: GitHub Copilot <noreply@github.com>`
- `Co-Authored-By: ChatGPT <noreply@openai.com>`

This helps AIDA accurately track AI contribution metrics — and it's what we're building this tool to measure.

### Branch Rules

- **Main branch only** - no separate dev/release branches
- **Feature branches** - `feat/xyz`, `fix/abc`, `docs/update-readme`
- **Clean history** - squash merge preferred
- **Auto-publish** - changesets trigger NPM releases

Feel free to open an **Issue** or start a **Discussion**.

## Call to Action

AI participation in software work is becoming ambient.
To account for it properly, we need evidence with visible limits.

**Join us in building AIDA.**

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Format code
pnpm format

# Lint code
pnpm lint
```

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Package Manager**: pnpm with workspaces
- **Build**: tsup (ESM output)
- **Testing**: vitest with coverage
- **Git**: simple-git for repository analysis
- **Validation**: zod for schema validation
- **CLI**: commander for command-line interface

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## License

MIT License
