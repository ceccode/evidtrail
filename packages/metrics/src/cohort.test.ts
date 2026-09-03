import { describe, it, expect } from 'vitest';
import { calculateAgeStats, calculateCategoryCounts, categorizeFile } from './cohort.js';
import { Commit } from '@evidtrail/core';

function makeCommit(authorDate: string, files: string[] = []): Commit {
  return {
    hash: 'x'.repeat(40),
    authorName: 'Test',
    authorEmail: 'test@example.com',
    authorDate,
    committerName: 'Test',
    committerEmail: 'test@example.com',
    committerDate: authorDate,
    message: 'commit',
    parents: [],
    inDefaultBranchAncestry: true,
    revertsCommit: null,
    tags: { attribution: 'unknown', automated: false, mode: 'unknown', evidence: 'none', level: 'none', sources: [] },
    stats: {
      totalAdditions: 1,
      totalDeletions: 0,
      files: files.map((path) => ({ path, additions: 1, deletions: 0 })),
    },
  };
}

describe('calculateAgeStats', () => {
  const now = new Date('2026-01-31T00:00:00.000Z');

  it('computes avg and median age in days', () => {
    const stats = calculateAgeStats(
      [
        makeCommit('2026-01-01T00:00:00.000Z'), // 30d
        makeCommit('2026-01-21T00:00:00.000Z'), // 10d
        makeCommit('2026-01-29T00:00:00.000Z'), // 2d
      ],
      now
    );
    expect(stats).not.toBeNull();
    expect(stats!.commits).toBe(3);
    expect(stats!.avgAgeDays).toBe(14);
    expect(stats!.medianAgeDays).toBe(10);
  });

  it('returns null for an empty cohort', () => {
    expect(calculateAgeStats([], now)).toBeNull();
  });
});

describe('categorizeFile', () => {
  it('classifies by path heuristics, first match wins', () => {
    expect(categorizeFile('src/index.ts')).toBe('source');
    expect(categorizeFile('src/utils/dates.test.ts')).toBe('tests');
    expect(categorizeFile('__tests__/foo.js')).toBe('tests');
    expect(categorizeFile('db/migrations/001_init.sql')).toBe('migrations');
    expect(categorizeFile('README.md')).toBe('docs');
    expect(categorizeFile('docs/index.html')).toBe('docs');
    expect(categorizeFile('.evidtrail.json')).toBe('config');
    expect(categorizeFile('packages/core/tsconfig.json')).toBe('config');
    expect(categorizeFile('.github/workflows/ci.yml')).toBe('config');
    expect(categorizeFile('pnpm-lock.yaml')).toBe('generated');
    expect(categorizeFile('packages/cli/CHANGELOG.md')).toBe('generated');
    expect(categorizeFile('src/__snapshots__/app.snap')).toBe('generated');
  });

  it('prefers generated over docs and config for lockfiles/changelogs', () => {
    expect(categorizeFile('CHANGELOG.md')).toBe('generated');
    expect(categorizeFile('package-lock.json')).toBe('generated');
  });
});

describe('calculateCategoryCounts', () => {
  it('counts file touches per category across the cohort', () => {
    const counts = calculateCategoryCounts([
      makeCommit('2026-01-01T00:00:00.000Z', ['src/a.ts', 'src/a.test.ts']),
      makeCommit('2026-01-02T00:00:00.000Z', ['src/a.ts', 'README.md']),
    ]);
    expect(counts).toEqual({
      source: 2, // a.ts touched twice
      tests: 1,
      migrations: 0,
      config: 0,
      docs: 1,
      generated: 0,
    });
  });

  it('returns null for an empty cohort', () => {
    expect(calculateCategoryCounts([])).toBeNull();
  });
});
