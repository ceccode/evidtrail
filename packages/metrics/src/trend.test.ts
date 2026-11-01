import { describe, it, expect } from 'vitest';
import { Commit, CommitStream } from '@evidtrail/core';
import { calculateTrend } from './trend.js';
import { calculatePersistence } from './persistence.js';

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
    // February: files never touched again within the window
    commits.push(makeCommit('f1', '2026-02-05T00:00:00Z', ['src/feb.ts']));

    const trend = calculateTrend(makeStream(commits), {
      observationEnd: NOW,
      observationDays: 30,
    });

    expect(trend.latestComparison).not.toBeNull();
    expect(trend.latestComparison!.from).toBe('2026-01');
    expect(trend.latestComparison!.to).toBe('2026-02');
    // January's file was retouched the next day, February's never
    expect(trend.latestComparison!.rapidRetouchRate).toEqual({ from: 1, to: 0, delta: -1 });
  });

  // An old period must not win simply for having existed longer: each is
  // judged on the same fixed horizon, whatever its age.
  it('judges every period on the same horizon, not on its age', () => {
    const trend = calculateTrend(
      makeStream([
        makeCommit('old', '2026-01-05T00:00:00Z', ['src/old.ts']),
        makeCommit('new', '2026-05-05T00:00:00Z', ['src/new.ts']),
      ]),
      { observationEnd: NOW, observationDays: 30 }
    );

    const jan = trend.periods.find((p) => p.label === '2026-01')!.persistence!;
    const may = trend.periods.find((p) => p.label === '2026-05')!.persistence!;
    // Neither file was ever touched again. At 191 and 71 days old, both are
    // judged on the same 30-day question and give the same answer.
    expect(jan.rapidRetouch).toEqual(may.rapidRetouch);
    expect(jan.rapidRetouch).toEqual([
      { windowDays: 30, retouched: 0, eligible: 1, tooRecent: 0, rate: 0 },
    ]);
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

// Found comparing 1.3.1 with 2.0 on llama.cpp: the trend capped observation
// at exactly 30×24 hours after a file's first touch, while the repository
// table counts whole days. A file touched again 30.5 days later was
// "retouched within 30d" in one table and "not retouched" in the other —
// the same files, two definitions, one report. Both now use the
// repository's whole-day horizon.
describe('the trend and the repository table agree on the horizon', () => {
  it('counts a retouch on day 30 the same way in both', () => {
    const stream = makeStream([
      makeCommit('first', '2026-01-05T00:00:00Z', ['src/edge.ts']),
      makeCommit('again', '2026-02-04T12:00:00Z', ['src/edge.ts']), // 30.5 days later
    ]);

    const trend = calculateTrend(stream, { observationEnd: NOW, observationDays: 30 });
    const january = trend.periods.find((p) => p.label === '2026-01')!.persistence!;
    const repo = calculatePersistence(stream, (commit) => !commit.tags.automated, {
      observationEnd: NOW,
      retouchHorizons: [30],
    });

    expect(january.rapidRetouch[0]).toMatchObject({ retouched: 1, eligible: 1 });
    expect(january.rapidRetouch[0].retouched).toBe(repo.rapidRetouch[0].retouched);
  });
});

describe('maturity under --until', () => {
  // The bound ends observation. A month that ends after it has not had its
  // window at all, and a month that ended less than a window before it has
  // not had the full one — both must stay immature, or the comparison is
  // made on a truncated period that looks cleaner than it was observed.
  it('judges maturity against the bound, not the collection time', () => {
    const stream: CommitStream = {
      ...makeStream([
        makeCommit('jan', '2026-01-05T00:00:00Z', ['src/jan.ts']),
        makeCommit('feb', '2026-02-05T00:00:00Z', ['src/feb.ts']),
        makeCommit('mar', '2026-03-05T00:00:00Z', ['src/mar.ts']),
      ]),
      generatedAt: '2026-09-18T00:00:00.000Z',
      until: '2026-03-10T00:00:00.000Z',
    };
    const bounded = calculateTrend(stream, { observationDays: 30 });
    const byLabel = Object.fromEntries(bounded.periods.map((p) => [p.label, p]));
    expect(byLabel['2026-01'].mature).toBe(true); // ended 1 Feb, 30+ days before the bound
    expect(byLabel['2026-02'].mature).toBe(false); // ended 1 Mar, 9 days before the bound
    expect(byLabel['2026-03'].mature).toBe(false); // still running at the bound
    expect(bounded.periods.map((p) => p.label)).not.toContain('2026-09'); // no periods past the bound
    expect(bounded.latestComparison).toBeNull(); // only one mature period

    // Without the bound the same stream compares Feb → Mar, both long over
    const unbounded = calculateTrend({ ...stream, until: undefined }, { observationDays: 30 });
    expect(unbounded.latestComparison).toMatchObject({ from: '2026-02', to: '2026-03' });
  });
});

describe('size comparability (#102)', () => {
  // This repository's own case: 5 commits over 18 files against 18 commits
  // over 53 files, two empty months between, rendered as +60.9 pt. The
  // arithmetic was right; the pair was not alike enough for the delta to
  // mean what a reader takes it to mean.
  const files = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `src/${prefix}${i}.ts`);

  it('labels a pair whose sizes differ beyond the ratio as weak, and still computes the delta', () => {
    const commits: Commit[] = [];
    // April: 2 commits, 12 files; July: 8 commits, 40 files (3.3× and 4×)
    commits.push(makeCommit('a1', '2026-04-05T00:00:00Z', files('apr', 6)));
    commits.push(makeCommit('a2', '2026-04-06T00:00:00Z', files('aprb', 6)));
    for (let i = 0; i < 8; i++) commits.push(makeCommit(`j${i}`, `2026-07-0${i + 1}T00:00:00Z`, files(`jul${i}`, 5)));
    const trend = calculateTrend(makeStream(commits), {
      observationEnd: new Date('2026-09-18T00:00:00.000Z'),
      observationDays: 30,
    });
    const lc = trend.latestComparison!;
    expect(lc).toMatchObject({ from: '2026-04', to: '2026-07' });
    expect(lc.rapidRetouchRate).not.toBeNull();
    expect(lc.comparability).toMatchObject({
      status: 'weak',
      eligible: { from: 12, to: 40 },
      commits: { from: 2, to: 8 },
    });
    expect(lc.comparability!.reasons.join(' ')).toContain('12 vs 40 eligible files');
    expect(lc.comparability!.reasons.join(' ')).toContain('2 vs 8 commits');
  });

  it('withholds when a side has fewer eligible files than the minimum', () => {
    const trend = calculateTrend(
      makeStream([
        makeCommit('a1', '2026-04-05T00:00:00Z', files('apr', 3)),
        makeCommit('j1', '2026-07-05T00:00:00Z', files('jul', 30)),
      ]),
      { observationEnd: new Date('2026-09-18T00:00:00.000Z'), observationDays: 30 }
    );
    const cmp = trend.latestComparison!.comparability!;
    expect(cmp.status).toBe('insufficient');
    expect(cmp.reasons).toEqual(['2026-04 has 3 eligible files (fewer than 10)']);
  });

  it('is ok for two alike, sufficient periods', () => {
    const trend = calculateTrend(
      makeStream([
        makeCommit('a1', '2026-04-05T00:00:00Z', files('apr', 12)),
        makeCommit('a2', '2026-04-06T00:00:00Z', files('aprb', 12)),
        makeCommit('j1', '2026-07-05T00:00:00Z', files('jul', 15)),
        makeCommit('j2', '2026-07-06T00:00:00Z', files('julb', 15)),
      ]),
      { observationEnd: new Date('2026-09-18T00:00:00.000Z'), observationDays: 30 }
    );
    expect(trend.latestComparison!.comparability).toMatchObject({ status: 'ok', reasons: [] });
  });
});
