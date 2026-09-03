import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runInit } from './init.js';
import { runDoctor, formatDoctor } from './doctor.js';

// `evidtrail init` and `evidtrail doctor` exist because adoption dies in the first ten
// minutes. These tests pin the two properties that make them safe to run
// anywhere: init never overwrites, doctor never lies about a clone.

let repoPath: string;

function git(cmd: string) {
  execSync(cmd, { cwd: repoPath, env: { ...process.env, EVIDTRAIL_MODE: '', CLAUDECODE: '' } });
}

beforeEach(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'evidtrail-onboard-'));
  git('git init -q -b main');
  git('git config user.name test && git config user.email test@example.com');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repoPath, { recursive: true, force: true });
});

describe('evidtrail init', () => {
  it('sets up config, hook, prepare script and workflow in one pass', async () => {
    writeFileSync(join(repoPath, 'package.json'), '{\n  "name": "x",\n  "scripts": {\n    "test": "vitest"\n  }\n}\n');

    const steps = await runInit({ repoPath, workflow: true, prepare: true });

    expect(JSON.parse(readFileSync(join(repoPath, '.evidtrail.json'), 'utf-8'))).toEqual({});
    expect(existsSync(join(repoPath, '.git', 'hooks', 'prepare-commit-msg'))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf-8'));
    expect(pkg.scripts.prepare).toBe('evidtrail install-hooks --if-git');
    expect(pkg.scripts.test).toBe('vitest'); // nothing else touched
    const workflow = readFileSync(join(repoPath, '.github', 'workflows', 'evidtrail.yml'), 'utf-8');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('--redact-authors');
    expect(workflow).toContain('pull-requests: write');
    expect(workflow).not.toContain('id-token');
    expect(steps.map((s) => s.status)).toEqual(['created', 'installed', 'created', 'created']);
  });

  // The property that makes init safe to re-run and safe on a hand-tuned
  // repo: nothing that exists is ever rewritten.
  it('is additive: existing files and scripts are reported, never overwritten', async () => {
    writeFileSync(join(repoPath, '.evidtrail.json'), '{"defaultMode":"agent"}\n');
    writeFileSync(join(repoPath, 'package.json'), '{"scripts":{"prepare":"husky"}}\n');
    writeFileSync(join(repoPath, '.git', 'hooks', 'prepare-commit-msg'), '#!/bin/sh\necho mine\n', { mode: 0o755 });

    const steps = await runInit({ repoPath, workflow: false, prepare: true });

    expect(readFileSync(join(repoPath, '.evidtrail.json'), 'utf-8')).toBe('{"defaultMode":"agent"}\n');
    expect(readFileSync(join(repoPath, '.git', 'hooks', 'prepare-commit-msg'), 'utf-8')).toContain('echo mine');
    expect(JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf-8')).scripts.prepare).toBe('husky');
    expect(steps.find((s) => s.target === '.evidtrail.json')?.status).toBe('exists');
    expect(steps.find((s) => s.target === 'commit hook')?.status).toBe('skipped');
    expect(steps.find((s) => s.target === 'package.json prepare')?.status).toBe('skipped');
  });

  // Found by dogfooding init on this very repository, whose workflow is
  // evidtrail.yml: matching only our own filename would have written a
  // second, competing workflow beside the existing one.
  it('recognises an evidtrail workflow under any filename and does not add a second one', async () => {
    const dir = join(repoPath, '.github', 'workflows');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ci.yml'), 'name: CI\njobs:\n  x:\n    steps:\n      - run: npx @evidtrail/cli collect\n');

    const steps = await runInit({ repoPath, workflow: true, prepare: false });

    expect(existsSync(join(dir, 'evidtrail.yml'))).toBe(false);
    const wf = steps.find((s) => s.target === '.github/workflows/evidtrail.yml')!;
    expect(wf.status).toBe('exists');
    expect(wf.note).toContain('ci.yml');
  });

  it('writes a prior only when asked — an assumption is opted into, not defaulted', async () => {
    await runInit({ repoPath, workflow: false, prepare: false, defaultMode: 'agent' });
    expect(JSON.parse(readFileSync(join(repoPath, '.evidtrail.json'), 'utf-8'))).toEqual({ defaultMode: 'agent' });
  });

  it('refuses outside a git repository instead of scattering files', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'evidtrail-nogit-'));
    try {
      await expect(runInit({ repoPath: bare, workflow: true, prepare: true })).rejects.toThrow(/not a git repository/);
      expect(existsSync(join(bare, '.evidtrail.json'))).toBe(false);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('evidtrail doctor', () => {
  it('reports a fresh clone honestly: no hook, no config, no workflow — and no blocker', async () => {
    writeFileSync(join(repoPath, 'a.ts'), 'export const a = 1;\n');
    git('git add -A && git commit -q -m "init"');

    const checks = await runDoctor(repoPath);
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));

    expect(byName['git repository'].status).toBe('ok');
    expect(byName['clone depth'].status).toBe('ok');
    expect(byName['commit hook (this clone)'].status).toBe('warn');
    expect(byName['.evidtrail.json'].status).toBe('warn');
    expect(checks.some((c) => c.status === 'fail')).toBe(false);
    // Every warning carries its fix
    for (const c of checks.filter((c) => c.status !== 'ok')) expect(c.fix).toBeTruthy();
  });

  it('flags a shallow clone as blocking — the classic confidently-wrong CI report', async () => {
    writeFileSync(join(repoPath, 'a.ts'), 'export const a = 1;\n');
    git('git add -A && git commit -q -m "one"');
    writeFileSync(join(repoPath, 'a.ts'), 'export const a = 2;\n');
    git('git add -A && git commit -q -m "two"');
    const shallow = mkdtempSync(join(tmpdir(), 'evidtrail-shallow-'));
    try {
      execSync(`git clone -q --depth 1 file://${repoPath} ${shallow}`);
      const checks = await runDoctor(shallow);
      const depth = checks.find((c) => c.name === 'clone depth')!;
      expect(depth.status).toBe('fail');
      expect(depth.fix).toContain('fetch-depth: 0');
    } finally {
      rmSync(shallow, { recursive: true, force: true });
    }
  });

  it('fails on a retired config key instead of letting defaults apply silently', async () => {
    writeFileSync(join(repoPath, '.evidtrail.json'), '{"defaultAttribution":"ai"}\n');
    const checks = await runDoctor(repoPath);
    const config = checks.find((c) => c.name === '.evidtrail.json')!;
    expect(config.status).toBe('fail');
    expect(config.detail).toContain('defaultMode');
  });

  it('reads a pre-rename .aida.json and asks for the rename, without failing', async () => {
    writeFileSync(join(repoPath, '.aida.json'), '{"defaultMode":"agent"}\n');
    const checks = await runDoctor(repoPath);
    const config = checks.find((c) => c.name === '.evidtrail.json')!;
    expect(config.status).toBe('warn');
    expect(config.detail).toContain('defaultMode: agent');
    expect(config.detail).toContain('.aida.json');
    expect(config.fix).toContain('git mv .aida.json .evidtrail.json');

    // init sees the same file as "already configured": no second config
    const steps = await runInit({ repoPath, workflow: false, prepare: false });
    expect(steps.find((s) => s.target === '.evidtrail.json')?.status).toBe('exists');
    expect(existsSync(join(repoPath, '.evidtrail.json'))).toBe(false);
  });

  it('passes clean after init', async () => {
    writeFileSync(join(repoPath, 'package.json'), '{"name":"x"}\n');
    writeFileSync(join(repoPath, 'a.ts'), 'export const a = 1;\n');
    git('git add -A && git commit -q -m "init"');
    await runInit({ repoPath, workflow: true, prepare: true });

    const checks = await runDoctor(repoPath);
    const notOk = checks.filter((c) => c.status !== 'ok').map((c) => c.name);
    // origin/HEAD cannot exist in a local-only repo; everything else is green
    expect(notOk).toEqual(['default branch']);
    expect(formatDoctor(checks)).toContain('✓ commit hook (this clone)');
  });

  it('is not a git repository → single blocking check with the fix', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'evidtrail-nogit-'));
    try {
      const checks = await runDoctor(bare);
      expect(checks).toHaveLength(1);
      expect(checks[0].status).toBe('fail');
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
