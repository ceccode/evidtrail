import { describe, it, expect } from 'vitest';
import { BlameStream, Commit, CommitStream } from '@evidtrail/core';
import { calculateLineSurvival } from './line-survival.js';

function makeCommit(hash: string, tags: Partial<Commit['tags']>, additions = 0): Commit {
  return {
    hash,
    authorName: 'Test',
    authorEmail: 'test@example.com',
    authorDate: '2026-01-01T00:00:00.000Z',
    committerName: 'Test',
    committerEmail: 'test@example.com',
    committerDate: '2026-01-01T00:00:00.000Z',
    message: 'commit',
    parents: [],
    inDefaultBranchAncestry: true,
    revertsCommit: null,
    tags: {
      attribution: 'unknown', automated: false,
      mode: 'unknown',
      evidence: 'none',
      level: 'none',
      sources: [],
      ...tags,
    },
    // Additions land on a blamed path by default, so the survival
    // denominator sees them (see `makeBlame`'s blamedPaths).
    stats: {
      totalAdditions: additions,
      totalDeletions: 0,
      files: additions
        ? [{ path: 'src/app.ts', status: 'modified' as const, additions, deletions: 0 }]
        : [],
    },
  };
}

function makeStream(commits: Commit[]): CommitStream {
  return {
    schemaVersion: 3,
    repoPath: '/test',
    defaultBranch: 'main',
    scope: 'default-branch',
    headSha: 'head',
    generatedAt: '2026-02-01T00:00:00.000Z',
    aiPatterns: [],
    commits: [...commits].reverse(),
  };
}

function makeBlame(linesBySha: Record<string, number>, overrides: Partial<BlameStream> = {}): BlameStream {
  const totalLines = Object.values(linesBySha).reduce((a, b) => a + b, 0);
  return {
    schemaVersion: 3,
    repoPath: '/test',
    headSha: 'head',
    generatedAt: '2026-02-01T00:00:00.000Z',
    filesBlamed: 3,
    filesSkipped: 0,
    filesFailed: 0,
    filesExcluded: 0,
    truncated: false,
    totalLines,
    linesBySha,
    blamedPaths: ['src/app.ts'],
    ...overrides,
  };
}

describe('calculateLineSurvival', () => {
  it('attributes surviving lines by cohort and by autonomy mode', () => {
    const result = calculateLineSurvival(
      makeBlame({ a1: 300, h1: 100, b1: 50 }),
      makeStream([
        makeCommit('a1', { attribution: 'ai', automated: false, mode: 'agent', evidence: 'declared' }, 400),
        makeCommit('h1', { attribution: 'human', automated: false, mode: 'none', evidence: 'declared' }),
        makeCommit('b1', { attribution: 'automated', automated: true, mode: 'none', evidence: 'inferred' }),
      ])
    );

    expect(result.byAttribution).toEqual({ ai: 300, human: 100, automated: 50, unknown: 0 });
    expect(result.byMode.agent).toBe(300);
    expect(result.byMode.none).toBe(150); // human + automated
    expect(result.aiShare).toBeCloseTo(300 / 450, 4);
  });

  it('reports lines from commits outside the collected window separately', () => {
    const result = calculateLineSurvival(
      makeBlame({ a1: 100, ancient: 900 }),
      makeStream([makeCommit('a1', { attribution: 'ai', automated: false, mode: 'agent' }, 100)])
    );

    expect(result.linesOutsideWindow).toBe(900);
    // Share is computed over attributable lines only, not diluted by them
    expect(result.aiShare).toBe(1);
  });

  it('derives an approximate survival rate against AI additions', () => {
    const result = calculateLineSurvival(
      makeBlame({ a1: 60 }),
      makeStream([makeCommit('a1', { attribution: 'ai', automated: false, mode: 'agent' }, 200)])
    );
    expect(result.introducedByAI).toBe(200);
    expect(result.approxSurvivalRate).toBe(0.3);
  });

  it('caps the approximate rate at 1 when rewrites inflate the denominator', () => {
    // Two AI commits added 10 lines total but 40 survive (other commits'
    // lines were reattributed by later AI edits): the ratio is meaningless
    // above 1, so it is capped rather than reported as 400%.
    const result = calculateLineSurvival(
      makeBlame({ a1: 40 }),
      makeStream([makeCommit('a1', { attribution: 'ai', automated: false, mode: 'agent' }, 10)])
    );
    expect(result.approxSurvivalRate).toBe(1);
  });

  // Found by running evidtrail against babel: `--max-files 500` over 27,648 files
  // reported "1.7% of AI lines survive" by dividing survivors found in 453
  // files by additions counted across the entire history.
  it('counts only additions to files blame actually visited', () => {
    const commit = makeCommit('a1', { attribution: 'ai', automated: false, mode: 'agent' }, 100);
    commit.stats.files = [
      { path: 'src/app.ts', status: 'modified', additions: 40, deletions: 0 },
      // Never blamed: excluded as generated, or beyond --max-files
      { path: 'dist/bundle.js', status: 'modified', additions: 60, deletions: 0 },
    ];

    const result = calculateLineSurvival(
      makeBlame({ a1: 20 }, { blamedPaths: ['src/app.ts'], truncated: true }),
      makeStream([commit])
    );

    // 40, not 100: the unblamed file cannot contribute survivors, so it must
    // not contribute additions either
    expect(result.introducedByAI).toBe(40);
    expect(result.approxSurvivalRate).toBe(0.5);
  });

  it('does not report a survival rate inflated by unblamed files', () => {
    const commit = makeCommit('a1', { attribution: 'ai', automated: false, mode: 'agent' }, 1000);
    commit.stats.files = [
      { path: 'src/app.ts', status: 'modified', additions: 10, deletions: 0 },
      { path: 'other/huge.ts', status: 'modified', additions: 990, deletions: 0 },
    ];

    const result = calculateLineSurvival(
      makeBlame({ a1: 10 }, { blamedPaths: ['src/app.ts'], truncated: true }),
      makeStream([commit])
    );

    // Before the fix this read 1% — "AI code barely survives" — when the
    // real answer for the files examined is "all of it did".
    expect(result.approxSurvivalRate).toBe(1);
  });

  it('handles an empty tree without dividing by zero', () => {
    const result = calculateLineSurvival(makeBlame({}), makeStream([]));
    expect(result.aiShare).toBe(0);
    expect(result.approxSurvivalRate).toBe(0);
    expect(result.totalLines).toBe(0);
  });

  it('carries the truncation flag and file counters through', () => {
    const result = calculateLineSurvival(
      makeBlame({ a1: 10 }, { truncated: true, filesSkipped: 2, filesExcluded: 5 }),
      makeStream([makeCommit('a1', { attribution: 'ai', automated: false, mode: 'agent' }, 10)])
    );
    expect(result.truncated).toBe(true);
    expect(result.filesSkipped).toBe(2);
    expect(result.filesExcluded).toBe(5);
  });
});
