import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// Every other test drives the command objects directly. This one runs the
// BUILT BINARY, because the bug it guards lived only in index.ts: options
// declared on the root program swallowed `--out-dir` from subcommands, so
// `aida collect --out-dir ./.aida` wrote to ./aida-output and CI could not
// find the report it had just produced. Nothing below index.ts could see it.
const BIN = resolve(__dirname, '../../dist/index.js');

let repoPath: string;

function aida(args: string[], cwd = repoPath): string {
  return execFileSync('node', [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, AIDA_MODE: '', CLAUDECODE: '' },
  });
}

beforeAll(() => {
  if (!existsSync(BIN)) throw new Error(`built binary missing at ${BIN} — run pnpm build first`);
  repoPath = mkdtempSync(join(tmpdir(), 'aida-dispatch-'));
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
    const out = mkdtempSync(join(tmpdir(), 'aida-out-'));
    try {
      aida(['collect', '--repo', repoPath, '--out-dir', out]);
      expect(existsSync(join(out, 'commit-stream.json'))).toBe(true);
      // ...and nothing leaked into the subcommand's default directory
      expect(existsSync(join(repoPath, 'aida-output'))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('bare `aida` runs collect → analyze → report with the given --out-dir', () => {
    const out = mkdtempSync(join(tmpdir(), 'aida-out-'));
    try {
      const log = aida(['--repo', repoPath, '--out-dir', out]);
      expect(existsSync(join(out, 'commit-stream.json'))).toBe(true);
      expect(existsSync(join(out, 'metrics.json'))).toBe(true);
      expect(existsSync(join(out, 'report.md'))).toBe(true);
      expect(log).toContain('Markdown report written to');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('`aida run` is the same pipeline, explicitly', () => {
    const out = mkdtempSync(join(tmpdir(), 'aida-out-'));
    try {
      aida(['run', '--repo', repoPath, '--out-dir', out]);
      expect(existsSync(join(out, 'report.md'))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('every subcommand is still reachable and --help lists them', () => {
    const help = aida(['--help']);
    for (const cmd of ['collect', 'analyze', 'report', 'blame', 'fetch-prs', 'comment', 'install-hooks', 'init', 'doctor', 'run']) {
      expect(help).toContain(cmd);
    }
  });
});
