# @evidtrail/cli

Command-line interface and GitHub Action for evidtrail — AI provenance for git: declared at commit time, checked in CI, traceable to the agent session.

- A commit hook writes `AI-Mode:` and `Assisted-by:` (the Linux kernel, Fedora and LLVM convention), and with `git config evidtrail.recordSession true` an `AI-Session:` link to the agent session.
- `evidtrail verify` fails a pull request whose commits do not state how they were produced, like a DCO check for `Signed-off-by`.
- `evidtrail trail <commit>` follows a commit to what it states and to its session, without opening the transcript.
- The report opens with provenance; change signals (retouch, reverts, hotfixes, trend) follow as an appendix and are churn, not a quality score.

## Installation

```bash
npm install -g @evidtrail/cli
```

## Usage

### Quick start

```bash
evidtrail init      # config + commit hook + prepare script + CI workflow, nothing overwritten
evidtrail doctor    # is this clone safe to measure? shallow clone, hook, config, CI
evidtrail           # collect → analyze → report (same as `evidtrail run`)
```

### Basic workflow

```bash
# Collect commits from last 90 days
evidtrail collect --since 90d

# Analyze collected data
evidtrail analyze

# Generate the Markdown report
evidtrail report
```

This workflow stays local. It records declared, inferred, and missing provenance, plus repository change signals as an appendix; it does not infer productivity, defects, causality, or developer performance.

To declare provenance for future commits, install the hook. Set `EVIDTRAIL_MODE` or configure a truthful `defaultMode` in `.evidtrail.json`; when no mode can be determined, evidtrail writes no trailer and preserves `unknown`.

```bash
evidtrail install-hooks
```

### Commands

#### `evidtrail collect`

Collect commits and generate `commit-stream.json`

Options:

- `--repo <path>` - Repository path (default: current directory)
- `--since <date>` - Start date (ISO or relative like 90d)
- `--until <date>` - End date (ISO or relative)
- `--scope <value>` - `default-branch` (default) or `all-refs`
- `--ai-pattern <pattern>` - Custom AI detection pattern (repeatable)
- `--default-branch <name>` - Default branch name (auto-detect if omitted)
- `--out-dir <path>` - Output directory (default: ./evidtrail-output)
- `--verbose` - Verbose logging

#### `evidtrail verify`

Fail (exit 1) when a commit in scope does not state its provenance. `--require declared` (default) accepts `AI-Mode:`, `Assisted-by:` or the attribution manifest; `--require evidence` accepts any signal. Automated commits are skipped, and a `defaultMode` prior never passes. Run it on a PR range (`evidtrail collect --pr`).

#### `evidtrail trail [revs...]`

Show what each commit states about how it was produced and, when it carries `AI-Session:`, whether that session's transcript exists on this machine. Read-only; it never opens the transcript.

#### `evidtrail analyze`

Analyze commit stream and generate `metrics.json`

#### `evidtrail report`

Generate human-readable reports from metrics

Options:

- `--out-dir <path>` - Output directory containing `metrics.json`

## Output Files

- `commit-stream.json` - Normalized commit data with AI tagging
- `metrics.json` - Scoped attribution, rapid-retouch, trend, and outcome metrics
- `report.md` - Human-readable Markdown report

Run `evidtrail --help` for the complete command reference. The repository [README](../../README.md) documents metric contracts, optional GitHub PR outcomes, and GitHub Actions/GitLab CI comments.
