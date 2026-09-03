import { describe, it, expect } from 'vitest';
import { Commit, CommitStream } from '@evidtrail/core';
import { calculateTrend } from './trend.js';

const NOW = new Date('2026-07-15T00:00:00.000Z');

function at(date: string): string {
  return new Date(date).toISOString();
}

function makeCommit(hash: string, date: string, files: string[], automated = false): Commit {
  return {
    hash,
    authorName: 'Test',
    authorEmail: 'test@example.com',
    authorDate: at(date),
    committerName: 'Test',
    committerEmail: 'test@example.com',
    committerDate: at(date),
    message: 'commit',
    parents: [],
    inDefaultBranchAncestry: true,
    revertsCommit: null,
    tags: {
      attribution: automated ? 'automated' : 'unknown',
      automated,
      mode: automated ? 'none' : 'unknown',
      evidence: automated ? 'inferred' : 'none',
      level: 'none',
      sources: [],
    },
    stats: {
      totalAdditions: files.length,
      totalDeletions: 0,
      files: files.map((path) => ({ path, status: 'modified' as const, additions: 1, deletions: 0 })),
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
    generatedAt: NOW.toISOString(),
    aiPatterns: [],
    commits: [...commits].reverse(),
  };
}

describe('calculateTrend', () => {
  it('buckets authored commits into calendar periods, keeping empty ones', () => {
    const trend = calculateTrend(
      makeStream([
        makeCommit('a', '2026-03-05T00:00:00Z', ['src/a.ts']),
        // nothing in April
        makeCommit('b', '2026-05-05T00:00:00Z', ['src/b.ts']),
      ]),
      { observationEnd: NOW }
    );

    expect(trend.periods.map((p) => p.label)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    // A month nobody committed in is signal, and dropping it would misspace
    // the series
    const april = trend.periods.find((p) => p.label === '2026-04')!;
    expect(april.commitsAuthored).toBe(0);
    expect(april.persistence).toBeNull();
  });

  // The defect this feature is built around: without an equal window and a
  // maturity gate, the newest period has had the least time to be reworked,
  // so every report ever generated would find quality "declining".
  it('marks a period immature until it has been over for the full window', () => {
    const trend = calculateTrend(
      makeStream([
        makeCommit('old', '2026-03-05T00:00:00Z', ['src/a.ts']),
        makeCommit('recent', '2026-07-05T00:00:00Z', ['src/b.ts']),
      ]),
      { observationEnd: NOW, observationDays: 30 }
    );

    // March ended 2026-04-01, more than 30 days before 2026-07-15
    expect(trend.periods.find((p) => p.label === '2026-03')!.mature).toBe(true);
    // June ended 2026-07-01, only 14 days ago
    expect(trend.periods.find((p) => p.label === '2026-06')!.mature).toBe(false);
    // July has not even ended
    expect(trend.periods.find((p) => p.label === '2026-07')!.mature).toBe(false);
  });

  it('never compares an immature period, however much data it holds', () => {
    // Two periods with data, but the later one is too recent to judge
    const trend = calculateTrend(
      makeStream([
        makeCommit('a1', '2026-03-05T00:00:00Z', ['src/a.ts']),
        makeCommit('a2', '2026-03-20T00:00:00Z', ['src/a.ts']),
        makeCommit('b1', '2026-07-02T00:00:00Z', ['src/b.ts']),
        makeCommit('b2', '2026-07-04T00:00:00Z', ['src/b.ts']),
      ]),
      { observationEnd: NOW, observationDays: 30 }
    );

    // Only March is mature, so there is no second point: no comparison at all
    // rather than a comparison against an unfinished period
    expect(trend.latestComparison).toBeNull();
    expect(trend.periods.find((p) => p.label === '2026-07')!.persistence).not.toBeNull();
  });

  it('compares the two most recent mature periods', () => {
    const commits: Commit[] = [];
    // January: files reworked fast (1 day)
    commits.push(makeCommit('j1', '2026-01-05T00:00:00Z', ['src/jan.ts']));
    commits.push(makeCommit('j2', '2026-01-06T00:00:00Z', ['src/jan.ts']));
    // February: files never touched again -> survive the full window
    commits.push(makeCommit('f1', '2026-02-05T00:00:00Z', ['src/feb.ts']));

    const trend = calculateTrend(makeStream(commits), {
      observationEnd: NOW,
      observationDays: 30,
    });

    expect(trend.latestComparison).not.toBeNull();
    expect(trend.latestComparison!.from).toBe('2026-01');
    expect(trend.latestComparison!.to).toBe('2026-02');
    // February's file survived the whole capped window, January's lasted a day
    expect(trend.latestComparison!.avgPersistenceDays.delta).toBeGreaterThan(0);
  });

  // Age-normalization (#29) applied to time instead of cohorts: an old period
  // must not win simply for having existed longer.
  it('caps every period to the same observation window', () => {
    const trend = calculateTrend(
      makeStream([
        makeCommit('old', '2026-01-05T00:00:00Z', ['src/old.ts']),
        makeCommit('new', '2026-05-05T00:00:00Z', ['src/new.ts']),
      ]),
      { observationEnd: NOW, observationDays: 30 }
    );

    const jan = trend.periods.find((p) => p.label === '2026-01')!.persistence!;
    const may = trend.periods.find((p) => p.label === '2026-05')!.persistence!;
    // Neither file was ever touched again: both are censored at exactly the
    // window, not at their real age (191 days vs 71)
    expect(jan.avgDays).toBe(30);
    expect(may.avgDays).toBe(30);
  });

  it('reports both denominators: coverage over all commits, quality over authored', () => {
    const trend = calculateTrend(
      makeStream([
        makeCommit('a', '2026-03-05T00:00:00Z', ['src/a.ts']),
        makeCommit('m', '2026-03-06T00:00:00Z', ['src/a.ts'], true), // automated
      ]),
      { observationEnd: NOW }
    );

    const march = trend.periods.find((p) => p.label === '2026-03')!;
    expect(march.commitsTotal).toBe(2);
    expect(march.commitsAuthored).toBe(1);
    // The automated commit carries inferred evidence, so coverage is 1/2
    expect(march.coverage).toBe(0.5);
    // ...while quality counts the authored commit only
    expect(march.persistence!.commitsConsidered).toBe(1);
  });

  it('caps the series so a decade-old repo does not render a hundred rows', () => {
    const commits = Array.from({ length: 24 }, (_, i) =>
      makeCommit(`c${i}`, `2024-${String((i % 12) + 1).padStart(2, '0')}-05T00:00:00Z`, ['src/a.ts'])
    );
    const trend = calculateTrend(makeStream(commits), { observationEnd: NOW, maxPeriods: 6 });

    expect(trend.periods).toHaveLength(6);
    // The most recent periods are the ones kept
    expect(trend.periods[trend.periods.length - 1].label).toBe('2026-07');
  });

  it('supports quarterly granularity', () => {
    const trend = calculateTrend(
      makeStream([makeCommit('a', '2026-02-05T00:00:00Z', ['src/a.ts'])]),
      { observationEnd: NOW, granularity: 'quarter' }
    );

    expect(trend.periods.map((p) => p.label)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3']);
  });

  it('returns an empty trend rather than inventing one for a repo with no authored commits', () => {
    const trend = calculateTrend(
      makeStream([makeCommit('m', '2026-03-05T00:00:00Z', ['src/a.ts'], true)]),
      { observationEnd: NOW }
    );

    expect(trend.periods).toEqual([]);
    expect(trend.latestComparison).toBeNull();
  });
});
