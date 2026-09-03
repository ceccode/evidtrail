import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { blameFileLineCounts, collectBlame } from './blame.js';

let repoPath: string;
let firstSha: string;
let secondSha: string;

function git(cmd: string) {
  execSync(cmd, { cwd: repoPath });
}

beforeAll(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'evidtrail-blame-'));
  git('git init -q -b main');
  git('git config user.name test && git config user.email test@example.com');

  // 4 lines from the first commit
  writeFileSync(join(repoPath, 'app.ts'), 'a\nb\nc\nd\n');
  git('git add -A && git commit -q -m "feat: first"');
  firstSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();

  // Rewrite 2 of them, so blame splits between the two commits
  writeFileSync(join(repoPath, 'app.ts'), 'a\nb\nCC\nDD\n');
  writeFileSync(join(repoPath, 'pnpm-lock.yaml'), 'lock\nlock\nlock\n');
  git('git add -A && git commit -q -m "fix: second"');
  secondSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
});

describe('blameFileLineCounts', () => {
  it('splits surviving lines between the commits that last wrote them', async () => {
    const counts = await blameFileLineCounts(repoPath, 'app.ts');
    expect(counts.get(firstSha)).toBe(2); // a, b
    expect(counts.get(secondSha)).toBe(2); // CC, DD
  });

  it('rejects a path that does not exist rather than reporting zero', async () => {
    await expect(blameFileLineCounts(repoPath, 'nope.ts')).rejects.toThrow();
  });

  // A repository controls its own file names. The old implementation passed
  // a JSON-stringified path to `exec`, where `$()` and backticks still execute
  // inside double quotes. This regression proves the absence of execution,
  // rather than merely proving that ordinary paths continue to work.
  it('treats hostile git paths as data and never executes them', async () => {
    const hostile = mkdtempSync(join(tmpdir(), 'evidtrail-blame-hostile-'));
    execSync('git init -q -b main', { cwd: hostile });
    execSync('git config user.name test && git config user.email test@example.com', {
      cwd: hostile,
    });
    const paths = [
      '$(touch AIDA_DOLLAR_PWNED)',
      '`touch AIDA_BACKTICK_PWNED`',
      "single'quote.ts",
      'double"quote.ts',
      'line\nbreak.ts',
      '-leading-dash.ts',
    ];
    for (const path of paths) writeFileSync(join(hostile, path), 'safe\n');
    execSync('git add -A && git commit -q -m "hostile paths"', { cwd: hostile });

    try {
      const stream = await collectBlame({ repoPath: hostile });
      expect(stream.filesFailed).toBe(0);
      expect(stream.filesBlamed).toBe(paths.length);
      expect(stream.blamedPaths.sort()).toEqual([...paths].sort());
      expect(() => execSync('test ! -e AIDA_DOLLAR_PWNED', { cwd: hostile })).not.toThrow();
      expect(() => execSync('test ! -e AIDA_BACKTICK_PWNED', { cwd: hostile })).not.toThrow();
    } finally {
      rmSync(hostile, { recursive: true, force: true });
    }
  });
});

describe('collectBlame', () => {
  it('aggregates line counts across the tree', async () => {
    const stream = await collectBlame({ repoPath });
    expect(stream.schemaVersion).toBe(3);
    expect(stream.filesBlamed).toBe(2); // app.ts + pnpm-lock.yaml
    expect(stream.totalLines).toBe(7); // 4 + 3
    expect(stream.linesBySha[firstSha]).toBe(2);
    expect(stream.truncated).toBe(false);
    // The file list is what lets a consumer scope a survival denominator to
    // the same files the numerator came from.
    expect(stream.blamedPaths.sort()).toEqual(['app.ts', 'pnpm-lock.yaml']);
  });

  it('reports blamedPaths for the blamed files only, never the excluded ones', async () => {
    const stream = await collectBlame({
      repoPath,
      exclude: (path) => path.endsWith('.yaml'),
    });
    expect(stream.blamedPaths).toEqual(['app.ts']);
  });

  it('honours the exclude predicate and reports what it skipped', async () => {
    const stream = await collectBlame({
      repoPath,
      exclude: (path) => path.endsWith('.yaml'),
    });
    expect(stream.filesBlamed).toBe(1);
    expect(stream.filesExcluded).toBe(1);
    expect(stream.totalLines).toBe(4);
  });

  it('flags truncation when --max-files caps the walk', async () => {
    const stream = await collectBlame({ repoPath, maxFiles: 1 });
    expect(stream.truncated).toBe(true);
    expect(stream.filesBlamed).toBe(1);
  });

  // Found by running evidtrail against babel: `--max-files 500` over 27,648 files
  // blamed only paths sorted before `packages/babel-c*`, 183 of them from a
  // single package, and the report called the result "a sample".
  it('spreads a capped sample across the tree instead of taking a path-order prefix', async () => {
    const wide = mkdtempSync(join(tmpdir(), 'evidtrail-blame-wide-'));
    execSync('git init -q -b main', { cwd: wide });
    execSync('git config user.name test && git config user.email test@example.com', { cwd: wide });
    for (const pkg of ['a-pkg', 'm-pkg', 'z-pkg']) {
      mkdirSync(join(wide, pkg));
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(wide, pkg, `f${i}.ts`), 'x\n');
      }
    }
    execSync('git add -A && git commit -q -m "init"', { cwd: wide });

    try {
      const stream = await collectBlame({ repoPath: wide, maxFiles: 6 });
      expect(stream.truncated).toBe(true);
      expect(stream.filesBlamed).toBe(6);
      const packages = new Set(stream.blamedPaths.map((p) => p.split('/')[0]));
      // A prefix walk would return six files from `a-pkg` alone
      expect([...packages].sort()).toEqual(['a-pkg', 'm-pkg', 'z-pkg']);
    } finally {
      rmSync(wide, { recursive: true, force: true });
    }
  });

  // A blame that errors used to land in `filesSkipped` alongside binaries,
  // so a run that failed on half the tree read as a clean run with some
  // binaries in it. The overflow case that motivated this (stdout past
  // maxBuffer) is unreachable in practice — `--incremental` emits one line
  // per chunk, and babel's worst file produced 78KB against a 64MB cap — but
  // submodules and missing objects in a partial clone reach it routinely.
  it('counts a failing blame apart from a skipped one and warns', async () => {
    const broken = mkdtempSync(join(tmpdir(), 'evidtrail-blame-broken-'));
    execSync('git init -q -b main', { cwd: broken });
    execSync('git config user.name test && git config user.email test@example.com', {
      cwd: broken,
    });
    writeFileSync(join(broken, 'ok.ts'), 'a\nb\n');
    execSync('git add -A && git commit -q -m "init"', { cwd: broken });
    // A submodule gitlink: listed by ls-tree, has no blob to blame. The
    // commonest way a real monorepo makes `git blame` exit non-zero.
    const head = execSync('git rev-parse HEAD', { cwd: broken }).toString().trim();
    execSync(`git update-index --add --cacheinfo 160000,${head},vendor/sub`, { cwd: broken });
    execSync('git commit -q -m "add submodule"', { cwd: broken });

    const warnings: string[] = [];
    const logger = {
      info: () => {},
      warn: (m: string) => warnings.push(m),
      error: () => {},
      debug: () => {},
    };

    try {
      const stream = await collectBlame({ repoPath: broken, logger });
      expect(stream.filesFailed).toBe(1);
      expect(stream.filesBlamed).toBe(1);
      expect(stream.blamedPaths).toEqual(['ok.ts']);
      // The failure is stated, not inferable only by subtracting counters
      expect(warnings.join(' ')).toMatch(/failed on 1 of 2 file/);
      expect(warnings.join(' ')).toContain('vendor/sub');
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });

  it('excludes binary files, which git blame would otherwise count as one line each', async () => {
    writeFileSync(join(repoPath, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255, 0]));
    git('git add -A && git commit -q -m "chore: binary"');

    const stream = await collectBlame({ repoPath });
    expect(stream.filesSkipped).toBe(1); // blob.bin
    expect(stream.filesBlamed).toBe(2); // app.ts + pnpm-lock.yaml
    // The binary blob contributed no phantom line
    expect(stream.totalLines).toBe(7);
  });
});
