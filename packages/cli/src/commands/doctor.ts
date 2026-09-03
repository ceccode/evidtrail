import { Command } from 'commander';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { createLogger, describeError } from '@evidtrail/core';
import { CONFIG_FILENAME, findConfigFile, loadAidaConfig } from '../config/load.js';
import { isAidaHookInstalled, isGitRepository } from '../hooks/detect.js';

const execFileAsync = promisify(execFile);

// `evidtrail doctor`: every way a run can be quietly wrong, checked up front.
//
// Each of these has produced a confidently wrong report at least once: a
// shallow clone truncating history, a partial clone that fails or lazily
// downloads everything, a clone without the hook so nothing declares its
// mode, a `.evidtrail.json` still carrying a retired key. The individual commands
// warn about them mid-run; this asks all the questions before any run, and
// answers each with the one-line fix.

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

async function git(repoPath: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoPath });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(repoPath: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  if (!(await isGitRepository(repoPath))) {
    return [
      {
        name: 'git repository',
        status: 'fail',
        detail: `${repoPath} is not inside a git work tree`,
        fix: 'Run evidtrail from a clone, or pass --repo <path>.',
      },
    ];
  }
  checks.push({ name: 'git repository', status: 'ok', detail: repoPath });

  const count = await git(repoPath, ['rev-list', '--count', '--all']);
  if (count === '0') {
    checks.push({
      name: 'history',
      status: 'warn',
      detail: 'no commits yet — nothing to measure until the first commit',
    });
  } else {
    checks.push({ name: 'history', status: 'ok', detail: `${count ?? '?'} commits reachable` });
  }

  // A shallow clone is the single most likely way for CI to produce a
  // confidently wrong report: actions/checkout defaults to fetch-depth 1.
  const shallow = await git(repoPath, ['rev-parse', '--is-shallow-repository']);
  checks.push(
    shallow === 'true'
      ? {
          name: 'clone depth',
          status: 'fail',
          detail: 'shallow clone — history is truncated, every metric would describe a fragment',
          fix: 'git fetch --unshallow; in CI set fetch-depth: 0 (actions/checkout) or GIT_DEPTH: 0 (GitLab).',
        }
      : { name: 'clone depth', status: 'ok', detail: 'full history' }
  );

  // A blobless/treeless partial clone has the commits but not the contents
  // `git log --numstat` and `git blame` need: it either fails outright or
  // lazily downloads everything, which defeats the point of the filter.
  const promisor = await git(repoPath, ['config', '--get', 'remote.origin.promisor']);
  const filter = await git(repoPath, ['config', '--get', 'remote.origin.partialclonefilter']);
  checks.push(
    promisor === 'true' || filter
      ? {
          name: 'clone contents',
          status: 'warn',
          detail: `partial clone (${filter || 'promisor'}) — collect and blame need blob contents and will fetch them on demand, slowly`,
          fix: 'Clone without --filter for evidtrail, or run git fetch --refetch once.',
        }
      : { name: 'clone contents', status: 'ok', detail: 'blobs present' }
  );

  const originHead = await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const branch = originHead?.replace(/^origin\//, '') ?? null;
  checks.push(
    branch
      ? { name: 'default branch', status: 'ok', detail: branch }
      : {
          name: 'default branch',
          status: 'warn',
          detail: 'origin/HEAD is not set — evidtrail falls back to main/master or the current branch',
          fix: 'git remote set-head origin --auto, or pass --default-branch <name> to collect.',
        }
  );

  // Fail-fast on the config, exactly as analyze does: a malformed or
  // retired-key .evidtrail.json silently applying defaults is the failure this
  // project keeps designing against.
  const configFile = await findConfigFile(repoPath);
  if (configFile) {
    try {
      const config = await loadAidaConfig(repoPath);
      const validity = config.defaultMode
        ? `valid — defaultMode: ${config.defaultMode} (a prior: joins cohorts, never counts as evidence)`
        : 'valid — no defaultMode prior';
      checks.push(
        configFile.legacy
          ? {
              // Still read, so not a failure — but a name that stops working
              // next major deserves to be said out loud now, not then.
              name: CONFIG_FILENAME,
              status: 'warn',
              detail: `${validity}, but stored as ${configFile.name} (pre-rename name)`,
              fix: `git mv ${configFile.name} ${CONFIG_FILENAME}`,
            }
          : { name: CONFIG_FILENAME, status: 'ok', detail: validity }
      );
    } catch (error) {
      checks.push({
        name: CONFIG_FILENAME,
        status: 'fail',
        detail: describeError(error).split('\n')[0],
        fix: 'Fix the file; evidtrail analyze refuses to run with a broken config rather than apply defaults.',
      });
    }
  } else {
    checks.push({
      name: CONFIG_FILENAME,
      status: 'warn',
      detail: 'absent — defaults apply (no prior, coverage threshold 70%)',
      fix: 'evidtrail init writes a starter config.',
    });
  }

  // The hook is per-clone state. A repo can be fully set up while the clone
  // in front of you declares nothing, and nothing visibly breaks (#75).
  const hooked = await isAidaHookInstalled(repoPath);
  checks.push(
    hooked
      ? { name: 'commit hook (this clone)', status: 'ok', detail: 'AI-Mode trailer will be stamped' }
      : {
          name: 'commit hook (this clone)',
          status: 'warn',
          detail: 'not installed — commits made from this clone declare no autonomy mode',
          fix: 'evidtrail install-hooks, or evidtrail init to also wire it into package.json prepare.',
        }
  );

  const pkgPath = join(repoPath, 'package.json');
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as {
        scripts?: Record<string, string>;
      };
      const prepare = pkg.scripts?.prepare ?? '';
      checks.push(
        /evidtrail\s+install-hooks|install-hooks\.mjs/.test(prepare)
          ? { name: 'prepare script', status: 'ok', detail: 'every clone installs the hook on install' }
          : {
              name: 'prepare script',
              status: 'warn',
              detail: 'package.json has no evidtrail prepare step — each clone must install the hook by hand',
              fix: 'evidtrail init adds "prepare": "evidtrail install-hooks --if-git".',
            }
      );
    } catch {
      checks.push({ name: 'prepare script', status: 'warn', detail: 'package.json is not valid JSON' });
    }
  }

  const workflowDir = join(repoPath, '.github', 'workflows');
  if (await exists(join(repoPath, '.github'))) {
    let hasAida = false;
    try {
      for (const file of await fs.readdir(workflowDir)) {
        const body = await fs.readFile(join(workflowDir, file), 'utf-8');
        if (/evidtrail/i.test(body)) hasAida = true;
      }
    } catch {
      // no workflows dir
    }
    checks.push(
      hasAida
        ? { name: 'CI workflow', status: 'ok', detail: 'a workflow runs evidtrail' }
        : {
            name: 'CI workflow',
            status: 'warn',
            detail: 'no workflow runs evidtrail — PRs get no evidence comment',
            fix: 'evidtrail init writes .github/workflows/evidtrail.yml.',
          }
    );
  }

  return checks;
}

const ICON: Record<CheckStatus, string> = { ok: '✓', warn: '!', fail: '✗' };

export function formatDoctor(checks: DoctorCheck[]): string {
  const width = Math.max(...checks.map((c) => c.name.length));
  return checks
    .map((c) => {
      const line = `${ICON[c.status]} ${c.name.padEnd(width)}  ${c.detail}`;
      return c.fix && c.status !== 'ok' ? `${line}\n  ${' '.repeat(width)}  → ${c.fix}` : line;
    })
    .join('\n');
}

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Check this clone before running evidtrail: history depth, hook, config, CI wiring')
    .option('--repo <path>', 'Repository path', process.cwd())
    .option('--json', 'Machine-readable output', false)
    .action(async (options) => {
      const logger = createLogger(false);
      try {
        const checks = await runDoctor(options.repo);
        if (options.json) {
          console.log(JSON.stringify(checks, null, 2));
        } else {
          console.log(formatDoctor(checks));
          const fails = checks.filter((c) => c.status === 'fail').length;
          const warns = checks.filter((c) => c.status === 'warn').length;
          console.log(
            fails > 0
              ? `\n${fails} blocking issue(s), ${warns} warning(s). Fix the ✗ lines before trusting a report.`
              : warns > 0
                ? `\nReady to run, with ${warns} warning(s) worth fixing for complete evidence.`
                : '\nReady: every check passed.'
          );
        }
        // Only a hard failure exits non-zero: warnings describe incomplete
        // evidence, not a broken run, and must not break a prepare script.
        if (checks.some((c) => c.status === 'fail')) process.exit(1);
      } catch (error) {
        logger.error(`Doctor failed: ${describeError(error)}`);
        process.exit(1);
      }
    });
}
