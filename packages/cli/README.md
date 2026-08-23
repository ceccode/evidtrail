# @aida-dev/cli

Command-line interface for AIDA — an auditable evidence ledger for AI-assisted software development.

## Installation

```bash
npm install -g @aida-dev/cli
```

## Usage

### Basic workflow

```bash
# Collect commits from last 90 days
aida collect --since 90d

# Analyze collected data
aida analyze

# Generate the Markdown report
aida report
```

This workflow stays local. It records repository change signals plus declared, inferred, and missing provenance; it does not infer productivity, defects, causality, or developer performance.

To declare provenance for future commits, install the hook. Set `AIDA_MODE` or configure a truthful `defaultMode` in `.aida.json`; when no mode can be determined, AIDA writes no trailer and preserves `unknown`.

```bash
aida install-hooks
```

### Commands

#### `aida collect`

Collect commits and generate `commit-stream.json`

Options:

- `--repo <path>` - Repository path (default: current directory)
- `--since <date>` - Start date (ISO or relative like 90d)
- `--until <date>` - End date (ISO or relative)
- `--scope <value>` - `default-branch` (default) or `all-refs`
- `--ai-pattern <pattern>` - Custom AI detection pattern (repeatable)
- `--default-branch <name>` - Default branch name (auto-detect if omitted)
- `--out-dir <path>` - Output directory (default: ./aida-output)
- `--verbose` - Verbose logging

#### `aida analyze`

Analyze commit stream and generate `metrics.json`

#### `aida report`

Generate human-readable reports from metrics

Options:

- `--out-dir <path>` - Output directory containing `metrics.json`

## Output Files

- `commit-stream.json` - Normalized commit data with AI tagging
- `metrics.json` - Scoped attribution, rapid-retouch, trend, and outcome metrics
- `report.md` - Human-readable Markdown report

Run `aida --help` for the complete command reference. The repository [README](../../README.md) documents metric contracts, optional GitHub PR outcomes, and GitHub Actions/GitLab CI comments.
