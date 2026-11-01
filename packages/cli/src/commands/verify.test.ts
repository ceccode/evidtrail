import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Command } from 'commander';
import { createCollectCommand } from './collect.js';
import { createVerifyCommand, verifyStream } from './verify.js';

// `verify` is the check a CI job fails on. A wrong pass is worse than a
// wrong fail here: a green check is read as "every commit states its
// provenance", and nobody looks behind it.

let repoPath: string;
let outDir: string;

function git(cmd: string) {
  // No hook is installed in the temp repo, but keep the environment from
  // leaking an agent's variables into anything that might read them.
  execSync(cmd, {
    cwd: repoPath,
    env: { ...process.env, EVIDTRAIL_MODE: '', CLAUDECODE: '', CLAUDE_CODE_ENTRYPOINT: '' },
  });
}

function run(command: Command, args: string[]): Promise<Command> {
  return command.parseAsync(args, { from: 'user' });
}

async function collect() {
  await run(createCollectCommand(), ['--repo', repoPath, '--out-dir', outDir]);
  return JSON.parse(readFileSync(join(outDir, 'commit-stream.json'), 'utf-8'));
}

beforeEach(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'evidtrail-verify-repo-'));
  outDir = mkdtempSync(join(tmpdir(), 'evidtrail-verify-out-'));
  git('git init -q -b main');
  git('git config user.name test && git config user.email test@example.com');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

describe('verifyStream', () => {
  it('passes declared AI and declared hand-written work alike', async () => {
    // The check asks that provenance be stated, not that it be AI. Failing
    // `AI-Mode: none` would punish the one honest declaration of a human.
    git('git commit -q --allow-empty -m "feat: a" -m "AI-Mode: agent"');
    git('git commit -q --allow-empty -m "fix: b" -m "AI-Mode: none"');
    const result = verifyStream(await collect(), 'declared');
    expect(result.checked).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it('fails a commit that states nothing', async () => {
    git('git commit -q --allow-empty -m "feat: a" -m "AI-Mode: agent"');
    git('git commit -q --allow-empty -m "fix: silent"');
    const result = verifyStream(await collect(), 'declared');
    expect(result.failures.map((f) => f.subject)).toEqual(['fix: silent']);
  });

  it('does not let a defaultMode prior pass the check', async () => {
    // A prior is not evidence. If `.evidtrail.json` could turn the check
    // green, a repository could pass it by configuration while no commit
    // says anything.
    writeFileSync(join(repoPath, '.evidtrail.json'), JSON.stringify({ defaultMode: 'agent' }));
    git('git add -A && git commit -q -m "chore: config only"');
    const result = verifyStream(await collect(), 'declared');
    expect(result.failures).toHaveLength(1);
  });

  it('separates an inferred signal from a declaration', async () => {
    // A tool's co-author line is real signal, but nobody declared anything:
    // `declared` fails it, `evidence` accepts it.
    git(
      'git commit -q --allow-empty -m "feat: d" -m "Co-authored-by: Claude <noreply@anthropic.com>"'
    );
    const stream = await collect();
    expect(verifyStream(stream, 'declared').failures).toHaveLength(1);
    expect(verifyStream(stream, 'evidence').failures).toHaveLength(0);
  });

  it('skips merge commits instead of failing them', async () => {
    git('git commit -q --allow-empty -m "feat: base" -m "AI-Mode: agent"');
    git('git checkout -q -b topic');
    git('git commit -q --allow-empty -m "feat: topic" -m "AI-Mode: agent"');
    git('git checkout -q main');
    git('git commit -q --allow-empty -m "feat: main" -m "AI-Mode: none"');
    git('git merge -q --no-ff topic -m "Merge branch topic"');
    const result = verifyStream(await collect(), 'declared');
    expect(result.automated).toBe(1);
    expect(result.failures).toEqual([]);
  });
});

describe('evidtrail verify', () => {
  it('exits 1 when commits lack provenance and 2 when it cannot run', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    git('git commit -q --allow-empty -m "fix: silent"');
    await collect();
    await expect(run(createVerifyCommand(), ['--out-dir', outDir])).rejects.toThrow('exit 1');

    // A missing stream is a broken job, not a policy failure.
    const empty = mkdtempSync(join(tmpdir(), 'evidtrail-verify-empty-'));
    try {
      await expect(run(createVerifyCommand(), ['--out-dir', empty])).rejects.toThrow('exit 2');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    exit.mockRestore();
  });

  it('exits 0 when every commit declares', async () => {
    git('git commit -q --allow-empty -m "feat: a" -m "AI-Mode: agent"');
    await collect();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    await expect(run(createVerifyCommand(), ['--out-dir', outDir])).resolves.toBeDefined();
    exit.mockRestore();
  });
});
