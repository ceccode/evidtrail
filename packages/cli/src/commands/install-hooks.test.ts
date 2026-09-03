import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import type { Command } from 'commander';
import { createInstallHooksCommand } from './install-hooks.js';
import { createCollectCommand } from './collect.js';
import { createAnalyzeCommand } from './analyze.js';
import { HOOK_SCRIPT } from '../hooks/prepare-commit-msg.js';

let repoPath: string;

// The suite may itself run inside an agent environment (it did during
// development: the hook correctly detected Claude Code and stamped every
// commit). Tests must therefore control detection inputs explicitly.
const DETECTION_VARS = ['EVIDTRAIL_MODE', 'AIDA_MODE', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CURSOR_TRACE_ID'];

function git(cmd: string, env: Record<string, string> = {}) {
  const clean = { ...process.env };
  for (const key of DETECTION_VARS) delete clean[key];
  execSync(cmd, { cwd: repoPath, env: { ...clean, ...env } });
}

function run(command: Command, args: string[]): Promise<Command> {
  return command.parseAsync(args, { from: 'user' });
}

function hookPath(): string {
  return join(repoPath, '.git', 'hooks', 'prepare-commit-msg');
}

beforeEach(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'evidtrail-hooks-'));
  git('git init -q -b main');
  git('git config user.name test && git config user.email test@example.com');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repoPath, { recursive: true, force: true });
});

describe('evidtrail install-hooks', () => {
  it('installs an executable hook', async () => {
    await run(createInstallHooksCommand(), ['--repo', repoPath]);

    expect(existsSync(hookPath())).toBe(true);
    expect(statSync(hookPath()).mode & 0o111).toBeTruthy();
    expect(readFileSync(hookPath(), 'utf-8')).toContain('AI-Mode');
  });

  it('upgrades a hook written before the rename instead of refusing it as foreign', async () => {
    writeFileSync(
      hookPath(),
      '#!/bin/sh\n# >>> aida-metrics mode stamp >>>\necho old body\n# <<< aida-metrics mode stamp <<<\n',
      { mode: 0o755 }
    );
    await run(createInstallHooksCommand(), ['--repo', repoPath]);
    expect(readFileSync(hookPath(), 'utf-8')).toBe(HOOK_SCRIPT);
  });

  it('is idempotent', async () => {
    await run(createInstallHooksCommand(), ['--repo', repoPath]);
    const first = readFileSync(hookPath(), 'utf-8');
    await run(createInstallHooksCommand(), ['--repo', repoPath]);
    expect(readFileSync(hookPath(), 'utf-8')).toBe(first);
  });

  it('refuses to clobber a hook it did not write', async () => {
    writeFileSync(hookPath(), '#!/bin/sh\necho mine\n', { mode: 0o755 });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(run(createInstallHooksCommand(), ['--repo', repoPath])).rejects.toThrow(
      'process.exit'
    );
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('not written by evidtrail');
    // The foreign hook is untouched
    expect(readFileSync(hookPath(), 'utf-8')).toContain('echo mine');

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('overwrites a foreign hook only with --force', async () => {
    writeFileSync(hookPath(), '#!/bin/sh\necho mine\n', { mode: 0o755 });
    await run(createInstallHooksCommand(), ['--repo', repoPath, '--force']);
    expect(readFileSync(hookPath(), 'utf-8')).toContain('AI-Mode');
  });

  it('uninstalls what it installed', async () => {
    await run(createInstallHooksCommand(), ['--repo', repoPath]);
    await run(createInstallHooksCommand(), ['--repo', repoPath, '--uninstall']);
    expect(existsSync(hookPath())).toBe(false);
  });

  // #75: `prepare` runs on every install, including the many that have no
  // git to hook into — a tarball install, `npm ci` in a container, a Docker
  // build. Erroring there would break unrelated installs.
  describe('--if-git (safe in a package.json prepare script)', () => {
    it('exits quietly outside a git repository instead of failing', async () => {
      const bare = mkdtempSync(join(tmpdir(), 'evidtrail-nogit-'));
      try {
        await expect(
          run(createInstallHooksCommand(), ['--repo', bare, '--if-git'])
        ).resolves.toBeDefined();
        expect(existsSync(join(bare, '.git'))).toBe(false);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });

    it('still installs normally when there IS a git repository', async () => {
      await run(createInstallHooksCommand(), ['--repo', repoPath, '--if-git']);
      expect(existsSync(hookPath())).toBe(true);
    });

    it('stays idempotent across repeated prepare runs', async () => {
      await run(createInstallHooksCommand(), ['--repo', repoPath, '--if-git']);
      const first = readFileSync(hookPath(), 'utf-8');
      await run(createInstallHooksCommand(), ['--repo', repoPath, '--if-git']);
      expect(readFileSync(hookPath(), 'utf-8')).toBe(first);
    });

    it('still refuses to clobber a foreign hook, prepare script or not', async () => {
      writeFileSync(hookPath(), '#!/bin/sh\necho someone elses hook\n', { mode: 0o755 });
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);
      await expect(
        run(createInstallHooksCommand(), ['--repo', repoPath, '--if-git'])
      ).rejects.toThrow();
      exit.mockRestore();
      expect(readFileSync(hookPath(), 'utf-8')).toContain('someone elses hook');
    });
  });

  it('uninstall is a no-op when no evidtrail hook is present', async () => {
    writeFileSync(hookPath(), '#!/bin/sh\necho mine\n', { mode: 0o755 });
    await run(createInstallHooksCommand(), ['--repo', repoPath, '--uninstall']);
    expect(readFileSync(hookPath(), 'utf-8')).toContain('echo mine');
  });
});

describe('this repository prepare bootstrap', () => {
  it('installs the canonical hook on a fresh clone before the CLI is built', () => {
    // Regression: root `pnpm install` used to skip installation whenever
    // packages/cli/dist/index.js did not exist — exactly the state of a fresh
    // clone. Nothing failed, but every subsequent commit silently lost its
    // provenance and evidtrail reported it as unknown.
    const installer = fileURLToPath(
      new URL('../../../../scripts/install-hooks.mjs', import.meta.url)
    );
    const result = spawnSync(process.execPath, [installer], {
      cwd: repoPath,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(readFileSync(hookPath(), 'utf8')).toBe(HOOK_SCRIPT);
    expect(statSync(hookPath()).mode & 0o111).toBeTruthy();
  });
});

describe('the installed hook, running for real', () => {
  beforeEach(async () => {
    await run(createInstallHooksCommand(), ['--repo', repoPath]);
  });

  it('stamps AI-Mode from EVIDTRAIL_MODE and collect reads it as declared', async () => {
    git('git commit -q --allow-empty -m "feat: agent work"', { EVIDTRAIL_MODE: 'agent' });

    const message = execSync('git log -1 --format=%B', { cwd: repoPath }).toString();
    expect(message).toContain('AI-Mode: agent');

    const outDir = mkdtempSync(join(tmpdir(), 'evidtrail-hooks-out-'));
    try {
      await run(createCollectCommand(), ['--repo', repoPath, '--out-dir', outDir]);
      const stream = JSON.parse(readFileSync(join(outDir, 'commit-stream.json'), 'utf-8'));
      const commit = stream.commits[0];
      expect(commit.tags.mode).toBe('agent');
      expect(commit.tags.evidence).toBe('declared');
      expect(commit.tags.attribution).toBe('ai');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('declares human authorship with EVIDTRAIL_MODE=none', async () => {
    git('git commit -q --allow-empty -m "fix: hand written"', { EVIDTRAIL_MODE: 'none' });

    const outDir = mkdtempSync(join(tmpdir(), 'evidtrail-hooks-out-'));
    try {
      await run(createCollectCommand(), ['--repo', repoPath, '--out-dir', outDir]);
      const stream = JSON.parse(readFileSync(join(outDir, 'commit-stream.json'), 'utf-8'));
      // The first real source of `human` attribution that isn't the manifest
      expect(stream.commits[0].tags.attribution).toBe('human');
      expect(stream.commits[0].tags.mode).toBe('none');
      expect(stream.commits[0].tags.evidence).toBe('declared');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('writes nothing when the mode is unknown — absence stays honest', () => {
    git('git commit -q --allow-empty -m "chore: no mode known"');
    const message = execSync('git log -1 --format=%B', { cwd: repoPath }).toString();
    expect(message).not.toContain('AI-Mode');
  });

  it('rejects an invalid EVIDTRAIL_MODE instead of stamping garbage', () => {
    git('git commit -q --allow-empty -m "chore: bogus mode"', { EVIDTRAIL_MODE: 'wizard' });
    const message = execSync('git log -1 --format=%B', { cwd: repoPath }).toString();
    expect(message).not.toContain('AI-Mode');
  });

  it('does not double-stamp a message that already declares a mode', () => {
    git('git commit -q --allow-empty -m "feat: x" -m "AI-Mode: assisted"', {
      EVIDTRAIL_MODE: 'agent',
    });
    const message = execSync('git log -1 --format=%B', { cwd: repoPath }).toString();
    expect(message.match(/AI-Mode:/g)).toHaveLength(1);
    expect(message).toContain('AI-Mode: assisted');
  });

  it('honours the pre-rename AIDA_MODE when EVIDTRAIL_MODE is unset', () => {
    git('git commit -q --allow-empty -m "feat: old env"', { AIDA_MODE: 'assisted' });
    const message = execSync('git log -1 --format=%B', { cwd: repoPath }).toString();
    expect(message).toContain('AI-Mode: assisted');
  });

  it('lets EVIDTRAIL_MODE win over AIDA_MODE when both are set', () => {
    git('git commit -q --allow-empty -m "feat: both env"', { EVIDTRAIL_MODE: 'agent', AIDA_MODE: 'none' });
    const message = execSync('git log -1 --format=%B', { cwd: repoPath }).toString();
    expect(message).toContain('AI-Mode: agent');
  });

  it('reads defaultMode from the pre-rename .aida.json when nothing else determines it', () => {
    writeFileSync(join(repoPath, '.aida.json'), JSON.stringify({ defaultMode: 'autocomplete' }));
    git('git add -A && git commit -q -m "chore: old config"');
    const message = execSync('git log -1 --format=%B', { cwd: repoPath }).toString();
    expect(message).toContain('AI-Mode: autocomplete');
  });

  it('reads defaultMode from .evidtrail.json when nothing else determines it', () => {
    writeFileSync(join(repoPath, '.evidtrail.json'), JSON.stringify({ defaultMode: 'assisted' }));
    git('git add -A && git commit -q -m "chore: config"');
    const message = execSync('git log -1 --format=%B', { cwd: repoPath }).toString();
    expect(message).toContain('AI-Mode: assisted');
  });

  it('never blocks a commit, even if the hook body fails', () => {
    // A hook whose logic throws must still let the commit through
    writeFileSync(
      hookPath(),
      '#!/bin/sh\n# >>> evidtrail mode stamp >>>\nthis-command-does-not-exist 2>/dev/null || true\nexit 0\n# <<< evidtrail mode stamp <<<\n',
      { mode: 0o755 }
    );
    expect(() => git('git commit -q --allow-empty -m "chore: survives"')).not.toThrow();
  });
});

// #75 point 3: the low-coverage warning is where eyes already are, so when
// the repo is configured for evidtrail but this clone is not, say exactly that
// instead of repeating generic advice.
describe('low-coverage warning names a missing hook in a configured repo', () => {
  let outDir: string;

  async function analyzeAndCaptureWarnings(): Promise<string> {
    const warnings: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((m: string) => {
      warnings.push(String(m));
    });
    try {
      await run(createCollectCommand(), ['--repo', repoPath, '--out-dir', outDir]);
      await run(createAnalyzeCommand(), ['--out-dir', outDir]);
    } finally {
      spy.mockRestore();
    }
    return warnings.join('\n');
  }

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'evidtrail-warn-out-'));
    // A commit with no declaration at all: coverage 0%, warning guaranteed
    git('git commit -q --allow-empty -m "chore: undeclared"');
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('names the hook when .evidtrail.json exists but the clone has none', async () => {
    writeFileSync(join(repoPath, '.evidtrail.json'), JSON.stringify({ coverageThreshold: 0.7 }));

    const warnings = await analyzeAndCaptureWarnings();

    expect(warnings).toContain('THIS CLONE');
    expect(warnings).toContain('prepare-commit-msg');
    expect(warnings).toContain('--if-git');
  });

  it('stays generic when the clone already has the hook', async () => {
    writeFileSync(join(repoPath, '.evidtrail.json'), JSON.stringify({ coverageThreshold: 0.7 }));
    await run(createInstallHooksCommand(), ['--repo', repoPath]);

    const warnings = await analyzeAndCaptureWarnings();

    expect(warnings).toContain('Coverage is below');
    expect(warnings).not.toContain('THIS CLONE');
  });

  it('stays generic on a repo that never opted into evidtrail', async () => {
    // e.g. someone running evidtrail over a repo they do not own: no .evidtrail.json,
    // so a missing hook is not a misconfiguration to complain about
    const warnings = await analyzeAndCaptureWarnings();

    expect(warnings).toContain('Coverage is below');
    expect(warnings).not.toContain('THIS CLONE');
    expect(warnings).toContain('A defaultMode prior does not increase coverage');
  });
});
