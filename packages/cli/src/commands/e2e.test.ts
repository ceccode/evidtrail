import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Command } from 'commander';
import { createCollectCommand } from './collect.js';
import { createAnalyzeCommand } from './analyze.js';
import { createReportCommand } from './report.js';
import { createCommentCommand } from './comment.js';
import { createFetchPRsCommand } from './fetch-prs.js';

// End-to-end coverage for the collect → analyze → report pipeline (#53).
// Every schema change so far passed CI while this wiring was untested; the
// mismatches were caught by hand-dogfooding instead.

let repoPath: string;
let outDir: string;

function git(cmd: string) {
  execSync(cmd, { cwd: repoPath });
}

function run(command: Command, args: string[]): Promise<Command> {
  return command.parseAsync(args, { from: 'user' });
}

beforeAll(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'evidtrail-e2e-repo-'));
  outDir = mkdtempSync(join(tmpdir(), 'evidtrail-e2e-out-'));

  git('git init -q -b main');
  git('git config user.name test && git config user.email test@example.com');

  writeFileSync(join(repoPath, 'app.ts'), 'export const a = 1;\n');
  git('git add -A');
  git('git commit -q -m "feat: human work"');

  writeFileSync(join(repoPath, 'app.ts'), 'export const a = 2;\n');
  writeFileSync(join(repoPath, 'app.test.ts'), 'test("a", () => {});\n');
  git('git add -A');
  git(
    'git commit -q -m "feat: agent work" -m "Co-Authored-By: Claude <noreply@anthropic.com>"'
  );

  // Silence CLI logging so test output stays readable
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

describe('collect → analyze → report end to end', () => {
  it('collects a versioned commit stream', async () => {
    await run(createCollectCommand(), ['--repo', repoPath, '--out-dir', outDir]);

    const stream = JSON.parse(readFileSync(join(outDir, 'commit-stream.json'), 'utf-8'));
    expect(stream.schemaVersion).toBe(3);
    expect(stream.commits).toHaveLength(2);
    // The trailer commit is detected as AI, the other stays unknown
    const attributions = stream.commits.map((c: { tags: { attribution: string } }) => c.tags.attribution).sort();
    expect(attributions).toEqual(['ai', 'unknown']);
  });

  it('always includes outcomeCorrelation, even with no reverts or hotfixes', async () => {
    await run(createAnalyzeCommand(), ['--out-dir', outDir]);
    const metrics = JSON.parse(readFileSync(join(outDir, 'metrics.json'), 'utf-8'));
    expect(metrics.outcomeCorrelation.reverts.total).toBe(0);
    expect(metrics.outcomeCorrelation.hotfixes.total).toBe(0);
  });

  it('analyzes into versioned metrics with every block populated', async () => {
    await run(createAnalyzeCommand(), ['--out-dir', outDir]);

    const metrics = JSON.parse(readFileSync(join(outDir, 'metrics.json'), 'utf-8'));
    expect(metrics.schemaVersion).toBe(3);
    expect(metrics.attribution.coverage).toBeCloseTo(0.5);
    expect(metrics.attribution.modes.agent).toBe(0);
    expect(metrics.attribution.modes.unknown).toBe(2);
    expect(metrics.persistence).toHaveProperty('censored');
    expect(metrics.cohorts.ai.taskMix).not.toBeNull();
    expect(metrics.byMode.agent).toBeNull();
    expect(metrics.byMode.unknown).not.toBeNull();
    // Trend is always present, and refuses to compare immature periods (#77)
    expect(metrics.trend.periods.length).toBeGreaterThan(0);
    expect(metrics.trend.periods.every((p: { mature: boolean }) => !p.mature)).toBe(true);
    expect(metrics.trend.latestComparison).toBeNull();
    // No human-attributed commits → no invented comparison
    expect(metrics.baseline).toBeNull();
    expect(metrics.delta).toBeNull();
    expect(metrics).not.toHaveProperty('mergeRatio');
  });

  it('renders a report containing every section the metrics support', async () => {
    await run(createReportCommand(), ['--out-dir', outDir]);

    const report = readFileSync(join(outDir, 'report.md'), 'utf-8');
    expect(report).toContain('# evidtrail Report');
    // Quality first (#77 step 2): the repo-level section opens the report,
    // the autonomy lens follows, coverage sits at the bottom as Data Quality
    expect(report).toContain('## Repository Change Signals');
    expect(report).toContain('## Autonomy');
    expect(report).toContain('## Data Quality');
    expect(report.indexOf('## Repository Change Signals')).toBeLessThan(report.indexOf('## Autonomy'));
    expect(report.indexOf('## Data Quality')).toBeGreaterThan(report.indexOf('## By Autonomy Level'));
    // The autonomy breakdown is the primary table (#25), and the three-state
    // view is labelled as the projection it is
    expect(report).toContain('| Autonomy level | Commits |');
    expect(report).toContain('*Three-state view:*');
    expect(report).toContain('## By Autonomy Level');
    // The trend lives inside Repository Change Signals
    expect(report).toContain('### Trend (monthly, 30-day observation window)');
    // Every commit in this fixture was made moments ago, so no period can be
    // mature: the report must decline to compare rather than invent a trend
    expect(report).toContain('**No comparison yet**');
    expect(report).toContain('Too recent to judge');
    expect(report).toContain('## Cohort Fairness');
    // The old generic-looking persistence section rendered the AI cohort's
    // numbers under a repo-level label; bounded change signals replaced it
    expect(report).not.toContain('## Persistence (file-level survival)');
    expect(report).toContain('### Caveats');
    // Removed metric must not resurface anywhere
    expect(report.toLowerCase()).not.toContain('merge ratio');
    // No unresolved template placeholders
    expect(report).not.toContain('undefined');
    expect(report).not.toContain('NaN');
  });

  it('prints the report on comment --dry-run without needing a CI provider', async () => {
    const printed: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      printed.push(String(msg));
    });
    await run(createCommentCommand(), ['--out-dir', outDir, '--dry-run']);
    logSpy.mockRestore();
    expect(printed.join('\n')).toContain('## Autonomy');
  });

  it('applies --redact-authors through the CLI', async () => {
    const redactedDir = mkdtempSync(join(tmpdir(), 'evidtrail-e2e-redacted-'));
    try {
      await run(createCollectCommand(), [
        '--repo',
        repoPath,
        '--out-dir',
        redactedDir,
        '--redact-authors',
      ]);
      const stream = JSON.parse(readFileSync(join(redactedDir, 'commit-stream.json'), 'utf-8'));
      for (const commit of stream.commits) {
        expect(commit.authorName).toMatch(/^redacted-[0-9a-f]{12}$/);
      }
    } finally {
      rmSync(redactedDir, { recursive: true, force: true });
    }
  });
});

describe('PR acceptance (#51)', () => {
  it('is absent — with a caveat, never a silent 0% — when fetch-prs has not run', async () => {
    const metrics = JSON.parse(readFileSync(join(outDir, 'metrics.json'), 'utf-8'));
    expect(metrics.prAcceptance).toBeNull();
    expect(metrics.caveats.join(' ')).toContain("run 'evidtrail fetch-prs'");

    const report = readFileSync(join(outDir, 'report.md'), 'utf-8');
    expect(report).not.toContain('## PR Merge Outcome');
  });

  it('is computed and rendered when a pr-stream.json is present', async () => {
    const prDir = mkdtempSync(join(tmpdir(), 'evidtrail-e2e-prs-'));
    try {
      await run(createCollectCommand(), ['--repo', repoPath, '--out-dir', prDir]);

      const aiCommit = {
        sha: 'a'.repeat(40),
        tags: {
          attribution: 'ai', automated: false,
          mode: 'agent',
          evidence: 'inferred',
          level: 'explicit',
          sources: ['trailer'],
        },
      };
      writeFileSync(
        join(prDir, 'pr-stream.json'),
        JSON.stringify({
          schemaVersion: 2,
          provider: 'github',
          repo: 'owner/name',
          fetchedAt: '2026-01-03T00:00:00.000Z',
          truncated: false,
          prs: [
            {
              number: 1,
              state: 'merged',
              createdAt: '2026-01-01T00:00:00.000Z',
              closedAt: '2026-01-02T00:00:00.000Z',
              mergedAt: '2026-01-02T00:00:00.000Z',
              commits: [aiCommit],
              commitsComplete: true,
            },
            {
              number: 2,
              state: 'closed',
              createdAt: '2026-01-01T00:00:00.000Z',
              closedAt: '2026-01-02T00:00:00.000Z',
              mergedAt: null,
              commits: [aiCommit],
              commitsComplete: true,
            },
          ],
        })
      );

      await run(createAnalyzeCommand(), ['--out-dir', prDir]);
      const metrics = JSON.parse(readFileSync(join(prDir, 'metrics.json'), 'utf-8'));
      expect(metrics.prAcceptance.overall).toEqual({
        total: 2,
        merged: 1,
        closed: 1,
        acceptanceRate: 0.5,
      });
      expect(metrics.prAcceptance.byAttribution.ai.acceptanceRate).toBe(0.5);

      await run(createReportCommand(), ['--out-dir', prDir]);
      const report = readFileSync(join(prDir, 'report.md'), 'utf-8');
      expect(report).toContain('## PR Merge Outcome');
      expect(report).toContain('Closed unmerged');
      expect(report).not.toContain('undefined');
    } finally {
      rmSync(prDir, { recursive: true, force: true });
    }
  });

  it('fetch-prs refuses to run without a token instead of failing silently', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const savedToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      await expect(
        run(createFetchPRsCommand(), ['--out-dir', outDir, '--github-repo', 'owner/name'])
      ).rejects.toThrow('process.exit');
      expect(errorSpy.mock.calls.flat().join(' ')).toContain('GITHUB_TOKEN is required');
    } finally {
      if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken;
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('schema version gate', () => {
  it('refuses an incompatible commit-stream instead of parsing it half-way', async () => {
    const staleDir = mkdtempSync(join(tmpdir(), 'evidtrail-e2e-stale-'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // A pre-versioning stream: valid JSON, no schemaVersion
      writeFileSync(
        join(staleDir, 'commit-stream.json'),
        JSON.stringify({ repoPath, defaultBranch: 'main', commits: [] })
      );

      await expect(run(createAnalyzeCommand(), ['--out-dir', staleDir])).rejects.toThrow(
        'process.exit'
      );
      expect(errorSpy.mock.calls.flat().join(' ')).toMatch(
        /no schemaVersion field.*Rerun 'evidtrail collect'/
      );
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
      rmSync(staleDir, { recursive: true, force: true });
    }
  });

  it('refuses to join blame data from another repository snapshot', async () => {
    const staleDir = mkdtempSync(join(tmpdir(), 'evidtrail-e2e-blame-snapshot-'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await run(createCollectCommand(), ['--repo', repoPath, '--out-dir', staleDir]);
      writeFileSync(
        join(staleDir, 'blame-stream.json'),
        JSON.stringify({
          schemaVersion: 3,
          repoPath,
          headSha: 'f'.repeat(40),
          generatedAt: new Date().toISOString(),
          filesBlamed: 0,
          filesSkipped: 0,
          filesFailed: 0,
          filesExcluded: 0,
          truncated: false,
          totalLines: 0,
          linesBySha: {},
          blamedPaths: [],
        })
      );

      await expect(run(createAnalyzeCommand(), ['--out-dir', staleDir])).rejects.toThrow(
        'process.exit'
      );
      expect(errorSpy.mock.calls.flat().join(' ')).toContain(
        'Rerun collect and blame from the same checkout'
      );
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
      rmSync(staleDir, { recursive: true, force: true });
    }
  });
});
