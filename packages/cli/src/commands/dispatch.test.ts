import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execSync, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// Every other test drives the command objects directly. This one runs the
// BUILT BINARY, because the bug it guards lived only in index.ts: options
// declared on the root program swallowed `--out-dir` from subcommands, so
// `evidtrail collect --out-dir ./.evidtrail` wrote to ./evidtrail-output and CI could not
// find the report it had just produced. Nothing below index.ts could see it.
const BIN = resolve(__dirname, '../../dist/index.js');

let repoPath: string;

function evidtrail(args: string[], cwd = repoPath): string {
  return execFileSync('node', [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, EVIDTRAIL_MODE: '', CLAUDECODE: '' },
  });
}

beforeAll(() => {
  if (!existsSync(BIN)) throw new Error(`built binary missing at ${BIN} — run pnpm build first`);
  repoPath = mkdtempSync(join(tmpdir(), 'evidtrail-dispatch-'));
  execSync('git init -q -b main', { cwd: repoPath });
  execSync('git config user.name test && git config user.email test@example.com', { cwd: repoPath });
  writeFileSync(join(repoPath, 'a.ts'), 'export const a = 1;\n');
  execSync('git add -A && git commit -q -m "feat: a" -m "AI-Mode: agent"', { cwd: repoPath });
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
});

describe('binary dispatch (index.ts)', () => {
  it('a subcommand keeps its own --out-dir', () => {
    const out = mkdtempSync(join(tmpdir(), 'evidtrail-out-'));
    try {
      evidtrail(['collect', '--repo', repoPath, '--out-dir', out]);
      expect(existsSync(join(out, 'commit-stream.json'))).toBe(true);
      // ...and nothing leaked into the subcommand's default directory
      expect(existsSync(join(repoPath, 'evidtrail-output'))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('bare `evidtrail` runs collect → analyze → report with the given --out-dir', () => {
    const out = mkdtempSync(join(tmpdir(), 'evidtrail-out-'));
    try {
      const log = evidtrail(['--repo', repoPath, '--out-dir', out]);
      expect(existsSync(join(out, 'commit-stream.json'))).toBe(true);
      expect(existsSync(join(out, 'metrics.json'))).toBe(true);
      expect(existsSync(join(out, 'report.md'))).toBe(true);
      expect(log).toContain('Markdown report written to');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('`evidtrail run` is the same pipeline, explicitly', () => {
    const out = mkdtempSync(join(tmpdir(), 'evidtrail-out-'));
    try {
      evidtrail(['run', '--repo', repoPath, '--out-dir', out]);
      expect(existsSync(join(out, 'report.md'))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('invoked as `aida` still works, with a one-line rename notice on stderr', () => {
    // The bin alias survives one release so existing `prepare` scripts and CI
    // steps keep working; the notice must not pollute stdout, which CI pipes.
    const dir = mkdtempSync(join(tmpdir(), 'evidtrail-alias-'));
    try {
      const alias = join(dir, 'aida');
      symlinkSync(BIN, alias);
      const result = spawnSync('node', [alias, '--help'], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('evidtrail');
      expect(result.stderr).toContain('renamed to evidtrail');
      // ...and the canonical name is silent
      expect(spawnSync('node', [BIN, '--help'], { encoding: 'utf8' }).stderr).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every subcommand is still reachable and --help lists them', () => {
    const help = evidtrail(['--help']);
    for (const cmd of ['collect', 'analyze', 'report', 'blame', 'fetch-prs', 'comment', 'install-hooks', 'init', 'doctor', 'run']) {
      expect(help).toContain(cmd);
    }
  });
});
