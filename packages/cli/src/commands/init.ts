import { Command } from 'commander';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { createLogger, describeError } from '@evidtrail/core';
import { isGitRepository } from '../hooks/detect.js';
import { installAidaHook } from '../hooks/install.js';
import { CONFIG_FILENAME, findConfigFile } from '../config/load.js';

const execFileAsync = promisify(execFile);

// `evidtrail init`: the whole setup in one command, and never a byte overwritten.
//
// Adoption dies in the first ten minutes. Before this, a team had to write
// .evidtrail.json by hand, remember install-hooks in every clone, and copy a
// 99-line workflow. Each step is small; together they are the reason a tool
// gets evaluated on a laptop and never reaches CI. Everything here is
// additive: a file that exists is left alone and reported, so re-running is
// free and a hand-edited setup is never clobbered.

const MODES = ['none', 'autocomplete', 'assisted', 'agent'] as const;
type Mode = (typeof MODES)[number];

export interface InitOptions {
  repoPath: string;
  defaultMode?: Mode;
  workflow: boolean;
  prepare: boolean;
}

export type InitStep = { target: string; status: 'created' | 'exists' | 'skipped' | 'installed'; note?: string };

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function existingAidaWorkflow(workflowDir: string): Promise<string | null> {
  try {
    for (const file of await fs.readdir(workflowDir)) {
      if (!/\.ya?ml$/.test(file)) continue;
      const body = await fs.readFile(join(workflowDir, file), 'utf-8');
      if (/evidtrail/i.test(body)) return file;
    }
  } catch {
    // no workflows directory yet
  }
  return null;
}

async function detectDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: repoPath }
    );
    return stdout.trim().replace(/^origin\//, '') || 'main';
  } catch {
    return 'main';
  }
}

// Generic, npm-based: users are not building evidtrail from source. Actions are
// referenced by major tag so the template stays readable; the comment tells
// security-minded teams to pin to SHAs, as this repository does for itself.
// The comment is posted by GitHub's preinstalled `gh`, in its own step, so
// the write-capable token never touches code built from the PR.
export function workflowTemplate(defaultBranch: string): string {
  return `# evidtrail — provenance and change-signal evidence for AI-assisted development.
# Written by \`evidtrail init\`. Pin the actions below to commit SHAs if your
# security policy requires it.
name: evidtrail

on:
  push:
    branches: [${defaultBranch}]
  pull_request:

permissions:
  contents: read

jobs:
  evidtrail:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v5
        with:
          # evidtrail reads history. A shallow clone silently truncates every metric.
          fetch-depth: 0
          persist-credentials: false

      - uses: actions/setup-node@v5
        with:
          node-version: 24

      - name: evidtrail on the PR change set
        if: github.event_name == 'pull_request'
        run: |
          npx --yes @evidtrail/cli@1 collect --pr --out-dir ./.evidtrail --redact-authors
          npx --yes @evidtrail/cli@1 analyze --out-dir ./.evidtrail
          npx --yes @evidtrail/cli@1 report --out-dir ./.evidtrail

      - name: evidtrail on ${defaultBranch}
        if: github.event_name == 'push'
        run: |
          npx --yes @evidtrail/cli@1 collect --out-dir ./.evidtrail --redact-authors
          npx --yes @evidtrail/cli@1 analyze --out-dir ./.evidtrail
          npx --yes @evidtrail/cli@1 report --out-dir ./.evidtrail

      - name: Post the PR comment (upserted, one per PR)
        if: github.event_name == 'pull_request'
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
        run: |
          marker='<!-- evidtrail-report -->'
          comment_id=$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \\
            --jq '.[] | select(.body | startswith("<!-- evidtrail-report -->") or startswith("<!-- aida-metrics-report -->")) | .id' | head -n 1)
          payload=$(jq -Rs --arg marker "$marker" '{body: ($marker + "\\n" + .)}' < ./.evidtrail/report.md)
          if [ -n "$comment_id" ]; then
            printf '%s' "$payload" | gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$comment_id" --input -
          else
            printf '%s' "$payload" | gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --input -
          fi

      - uses: actions/upload-artifact@v4
        with:
          name: evidtrail-report
          include-hidden-files: true
          path: |
            ./.evidtrail/commit-stream.json
            ./.evidtrail/metrics.json
            ./.evidtrail/report.md
`;
}

export async function runInit(options: InitOptions): Promise<InitStep[]> {
  const steps: InitStep[] = [];
  const { repoPath } = options;

  if (!(await isGitRepository(repoPath))) {
    throw new Error(`${repoPath} is not a git repository. Run evidtrail init from a clone.`);
  }

  // .evidtrail.json — written only when absent, and without a prior unless asked:
  // a prior is an assumption, and assumptions are opted into, not defaulted.
  const configPath = join(repoPath, CONFIG_FILENAME);
  const existingConfig = await findConfigFile(repoPath);
  if (existingConfig) {
    // A pre-rename .aida.json is this repository's config, not a missing one:
    // writing a second file next to it would split the truth in two.
    steps.push({
      target: CONFIG_FILENAME,
      status: 'exists',
      note: existingConfig.legacy
        ? `found as ${existingConfig.name} (pre-rename name) — git mv ${existingConfig.name} ${CONFIG_FILENAME}`
        : 'left untouched',
    });
  } else {
    const config: Record<string, unknown> = {};
    if (options.defaultMode) config.defaultMode = options.defaultMode;
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    steps.push({
      target: '.evidtrail.json',
      status: 'created',
      note: options.defaultMode
        ? `defaultMode: ${options.defaultMode} — a prior for history with no evidence; it never counts as evidence`
        : 'no prior; add "defaultMode" later if you want no-evidence history assigned to a level',
    });
  }

  // The hook, for this clone, now.
  const hook = await installAidaHook(repoPath);
  steps.push(
    hook.status === 'refused'
      ? {
          target: 'commit hook',
          status: 'skipped',
          note: `${hook.hookPath} exists and is not evidtrail's — run evidtrail install-hooks --force to replace it`,
        }
      : { target: 'commit hook', status: hook.status === 'installed' ? 'installed' : 'exists', note: hook.hookPath }
  );

  // The hook, for every other clone: the `prepare` recipe (#75). Only when
  // there is a package.json to carry it, and only if prepare is free — an
  // existing prepare script belongs to the project, not to us.
  const pkgPath = join(repoPath, 'package.json');
  if (options.prepare && (await exists(pkgPath))) {
    const raw = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const prepare = pkg.scripts?.prepare;
    if (!prepare) {
      pkg.scripts = { prepare: 'evidtrail install-hooks --if-git', ...(pkg.scripts ?? {}) };
      // Preserve the file's indentation instead of normalising someone's package.json
      const indent = /^(\s+)"/m.exec(raw)?.[1] ?? '  ';
      await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`);
      steps.push({ target: 'package.json prepare', status: 'created', note: 'evidtrail install-hooks --if-git' });
    } else if (/evidtrail\s+install-hooks|install-hooks\.mjs/.test(prepare)) {
      steps.push({ target: 'package.json prepare', status: 'exists', note: 'already installs the hook' });
    } else {
      steps.push({
        target: 'package.json prepare',
        status: 'skipped',
        note: `prepare is already "${prepare}" — append "&& evidtrail install-hooks --if-git" yourself`,
      });
    }
  }

  // The workflow. Only for GitHub for now; GitLab users have the README recipe.
  // "Exists" means any workflow that already runs evidtrail, whatever its file is
  // called — this repository's own is evidtrail.yml. Matching only our
  // filename would have written a second, competing workflow next to it.
  if (options.workflow) {
    const workflowDir = join(repoPath, '.github', 'workflows');
    const workflowPath = join(workflowDir, 'evidtrail.yml');
    const existing = await existingAidaWorkflow(workflowDir);
    if (existing) {
      steps.push({
        target: '.github/workflows/evidtrail.yml',
        status: 'exists',
        note: `${existing} already runs evidtrail — left untouched`,
      });
    } else {
      await fs.mkdir(workflowDir, { recursive: true });
      await fs.writeFile(workflowPath, workflowTemplate(await detectDefaultBranch(repoPath)));
      steps.push({
        target: '.github/workflows/evidtrail.yml',
        status: 'created',
        note: 'PR comment + default-branch report, redacted authors, minimal permissions',
      });
    }
  }

  return steps;
}

export function createInitCommand(): Command {
  return new Command('init')
    .description('Set up evidtrail in this repository: config, commit hook, prepare script, CI workflow')
    .option('--repo <path>', 'Repository path', process.cwd())
    .option('--default-mode <value>', 'Prior for history with no evidence: none | autocomplete | assisted | agent')
    .option('--no-workflow', 'Do not write .github/workflows/evidtrail.yml')
    .option('--no-prepare', 'Do not add the prepare script to package.json')
    .action(async (options) => {
      const logger = createLogger(false);
      try {
        if (options.defaultMode && !MODES.includes(options.defaultMode)) {
          throw new Error(`Invalid --default-mode "${options.defaultMode}": expected ${MODES.join(', ')}`);
        }
        const steps = await runInit({
          repoPath: options.repo,
          defaultMode: options.defaultMode,
          workflow: options.workflow !== false,
          prepare: options.prepare !== false,
        });
        const width = Math.max(...steps.map((s) => s.target.length));
        for (const step of steps) {
          const icon = step.status === 'created' || step.status === 'installed' ? '+' : step.status === 'exists' ? '=' : '-';
          console.log(`${icon} ${step.target.padEnd(width)}  ${step.status}${step.note ? ` — ${step.note}` : ''}`);
        }
        const changed = steps.some((s) => s.status === 'created' || s.status === 'installed');
        console.log(
          changed
            ? '\nNext: commit the new files, then `evidtrail` (or `evidtrail doctor` to check this clone).'
            : '\nNothing to do — this repository is already set up. `evidtrail doctor` checks this clone.'
        );
      } catch (error) {
        logger.error(`Init failed: ${describeError(error)}`);
        process.exit(1);
      }
    });
}
