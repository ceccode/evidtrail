# @evidtrail/cli

Command-line interface for evidtrail — an auditable evidence ledger for AI-assisted software development.

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

This workflow stays local. It records repository change signals plus declared, inferred, and missing provenance; it does not infer productivity, defects, causality, or developer performance.

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
