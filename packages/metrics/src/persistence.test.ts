import { describe, it, expect } from 'vitest';
import { calculateBaselinePersistence, calculatePersistence } from './persistence.js';
import type { CommitStream } from '@evidtrail/core';

function makeCommit(overrides: Partial<CommitStream['commits'][0]>): CommitStream['commits'][0] {
  const commit: CommitStream['commits'][0] = {
    hash: 'abc123',
    authorName: 'Test',
    authorEmail: 'test@test.com',
    authorDate: '2024-01-01T00:00:00.000Z',
    committerName: 'Test',
    committerEmail: 'test@test.com',
    committerDate: '2024-01-01T00:00:00.000Z',
    message: 'test commit',
    parents: [],
    inDefaultBranchAncestry: true,
    revertsCommit: null,
    tags: { attribution: 'unknown' as const, automated: false, mode: 'unknown' as const, evidence: 'none' as const, level: 'none', sources: [] },
    stats: { totalAdditions: 10, totalDeletions: 0, files: [] },
    ...overrides,
  };
  if (overrides.authorDate && overrides.committerDate === undefined) {
    commit.committerDate = overrides.authorDate;
  }
  return commit;
}

function makeStream(commits: CommitStream['commits']): CommitStream {
  return {
    schemaVersion: 3,
    repoPath: '/test',
    defaultBranch: 'main',
    scope: 'default-branch',
    headSha: 'head',
    generatedAt: '2024-06-01T00:00:00.000Z',
    aiPatterns: [],
    commits: [...commits].reverse(),
  };
}

describe('calculatePersistence', () => {
  it('returns zeros when no AI commits', () => {
    const stream = makeStream([makeCommit({})]);
    const result = calculatePersistence(stream);
    expect(result.commitsConsidered).toBe(0);
    expect(result.avgDays).toBe(0);
    expect(result.medianDays).toBe(0);
  });

  it('counts AI commits correctly', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        tags: { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit', sources: ['tag:[ai]'] },
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'foo.ts', additions: 5, deletions: 0 }] },
      }),
      makeCommit({
        hash: 'a2',
        tags: { attribution: 'unknown' as const, automated: false, mode: 'unknown' as const, evidence: 'none' as const, level: 'none', sources: [] },
      }),
    ]);
    const result = calculatePersistence(stream);
    expect(result.commitsConsidered).toBe(1);
  });

  it('calculates persistence for files touched by AI then seen later', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit', sources: ['tag:[ai]'] },
        stats: {
          totalAdditions: 5,
          totalDeletions: 0,
          files: [{ path: 'foo.ts', additions: 5, deletions: 0 }],
        },
      }),
      makeCommit({
        hash: 'a2',
        authorDate: '2024-01-11T00:00:00.000Z',
        tags: { attribution: 'unknown' as const, automated: false, mode: 'unknown' as const, evidence: 'none' as const, level: 'none', sources: [] },
        stats: {
          totalAdditions: 2,
          totalDeletions: 1,
          files: [{ path: 'foo.ts', additions: 2, deletions: 1, status: 'modified' }],
        },
      }),
    ]);
    const result = calculatePersistence(stream);
    expect(result.commitsConsidered).toBe(1);
    expect(result.avgDays).toBe(10);
    expect(result.medianDays).toBe(10);
  });

  it('buckets persistence correctly', () => {
    const stream = makeStream([
      // AI commit touching file A (0 days persistence — only seen once)
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit', sources: ['tag:[ai]'] },
        stats: {
          totalAdditions: 5,
          totalDeletions: 0,
          files: [{ path: 'a.ts', additions: 5, deletions: 0 }],
        },
      }),
      // AI commit touching file B
      makeCommit({
        hash: 'a2',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit', sources: ['tag:[ai]'] },
        stats: {
          totalAdditions: 5,
          totalDeletions: 0,
          files: [{ path: 'b.ts', additions: 5, deletions: 0 }],
        },
      }),
      // Non-AI commit touching file B 5 days later
      makeCommit({
        hash: 'a3',
        authorDate: '2024-01-06T00:00:00.000Z',
        tags: { attribution: 'unknown' as const, automated: false, mode: 'unknown' as const, evidence: 'none' as const, level: 'none', sources: [] },
        stats: {
          totalAdditions: 2,
          totalDeletions: 0,
          files: [{ path: 'b.ts', additions: 2, deletions: 0, status: 'modified' }],
        },
      }),
    ]);
    const result = calculatePersistence(stream);
    // b.ts: modified after 5 days → event, d2_7
    // a.ts: never touched again → censored at stream end (2024-06-01, 152d) → d90_plus
    expect(result.buckets.d2_7).toBe(1); // b.ts
    expect(result.buckets.d90_plus).toBe(1); // a.ts, censored
    expect(result.censored).toBe(1);
    expect(result.filesConsidered).toBe(2);
  });

  it('censors files never modified again at the observation end, not zero', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit', sources: ['tag:[ai]'] },
        stats: {
          totalAdditions: 5,
          totalDeletions: 0,
          files: [{ path: 'stable.ts', additions: 5, deletions: 0 }],
        },
      }),
    ]);
    const result = calculatePersistence(stream);
    // stream generatedAt is 2024-06-01 → survived 152 days, the best outcome
    expect(result.avgDays).toBe(152);
    expect(result.censored).toBe(1);
  });

  it('ends the survival clock at the first subsequent touch, same cohort included', () => {
    const aiTags: CommitStream['commits'][0]['tags'] = { attribution: 'ai', automated: false, mode: 'agent', evidence: 'inferred', level: 'explicit', sources: ['tag:[ai]'] };
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'foo.ts', additions: 5, deletions: 0 }] },
      }),
      makeCommit({
        hash: 'a2',
        authorDate: '2024-01-03T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'foo.ts', additions: 1, deletions: 0, status: 'modified' }] },
      }),
      makeCommit({
        hash: 'a3',
        authorDate: '2024-01-30T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'foo.ts', additions: 1, deletions: 0, status: 'modified' }] },
      }),
    ]);
    const result = calculatePersistence(stream);
    // survival ends at the FIRST subsequent touch (2 days), not the last (29)
    expect(result.avgDays).toBe(2);
  });

  it('excludes migrations and generated files from persistence by default', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit', sources: ['tag:[ai]'] },
        stats: {
          totalAdditions: 3,
          totalDeletions: 0,
          files: [
            { path: 'db/migrations/001_init.sql', additions: 1, deletions: 0 },
            { path: 'pnpm-lock.yaml', additions: 1, deletions: 0 },
            { path: 'src/app.ts', additions: 1, deletions: 0 },
          ],
        },
      }),
    ]);
    const result = calculatePersistence(stream);
    expect(result.filesConsidered).toBe(1); // src/app.ts only
    expect(result.filesExcluded).toBe(2);
  });

  it('handles deleted files by not extending persistence', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit', sources: ['tag:[ai]'] },
        stats: {
          totalAdditions: 5,
          totalDeletions: 0,
          files: [{ path: 'temp.ts', additions: 5, deletions: 0 }],
        },
      }),
      makeCommit({
        hash: 'a2',
        authorDate: '2024-01-20T00:00:00.000Z',
        tags: { attribution: 'unknown' as const, automated: false, mode: 'unknown' as const, evidence: 'none' as const, level: 'none', sources: [] },
        stats: {
          totalAdditions: 0,
          totalDeletions: 5,
          files: [{ path: 'temp.ts', additions: 0, deletions: 5, status: 'deleted' }],
        },
      }),
    ]);
    const result = calculatePersistence(stream);
    // Deletion is the first subsequent event: the file survived 19 days
    expect(result.avgDays).toBe(19);
    expect(result.censored).toBe(0);
  });
});

describe('rework rate (#22)', () => {
  const aiTags: CommitStream['commits'][0]['tags'] = { attribution: 'ai', automated: false, mode: 'agent', evidence: 'inferred', level: 'explicit', sources: [] };

  it('counts a file reworked inside the window', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'src/a.ts', additions: 5, deletions: 0 }] },
      }),
      makeCommit({
        hash: 'a2',
        authorDate: '2024-01-03T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 1, files: [{ path: 'src/a.ts', additions: 1, deletions: 1, status: 'modified' }] },
      }),
    ]);
    const result = calculatePersistence(stream, undefined, { reworkWindowDays: 7 });
    expect(result.rework).toEqual({
      windowDays: 7,
      reworked: 1,
      determined: 1,
      undetermined: 0,
      rate: 1,
    });
  });

  it('does not count a file reworked after the window', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'src/a.ts', additions: 5, deletions: 0 }] },
      }),
      makeCommit({
        hash: 'a2',
        authorDate: '2024-02-01T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 1, files: [{ path: 'src/a.ts', additions: 1, deletions: 1, status: 'modified' }] },
      }),
    ]);
    const result = calculatePersistence(stream, undefined, { reworkWindowDays: 7 });
    expect(result.rework?.reworked).toBe(0);
    expect(result.rework?.determined).toBe(1);
    expect(result.rework?.rate).toBe(0);
  });

  it('excludes files too recent to judge from both numerator and denominator', () => {
    // Stream ends 2024-06-01; this file is first touched 2 days before that,
    // so a 7-day question has no answer for it either way.
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-05-30T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'src/fresh.ts', additions: 5, deletions: 0 }] },
      }),
      makeCommit({
        hash: 'a2',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'src/old.ts', additions: 5, deletions: 0 }] },
      }),
    ]);
    const result = calculatePersistence(stream, undefined, { reworkWindowDays: 7 });
    expect(result.rework?.undetermined).toBe(1); // fresh.ts
    expect(result.rework?.determined).toBe(1); // old.ts, observed long enough
    expect(result.rework?.reworked).toBe(0);
  });

  it('is null when no file has a determined outcome', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-05-31T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'src/fresh.ts', additions: 1, deletions: 0 }] },
      }),
    ]);
    expect(calculatePersistence(stream, undefined, { reworkWindowDays: 30 }).rework).toBeNull();
  });
});

describe('calculateBaselinePersistence', () => {
  it('measures persistence over human-attributed commits only, ignoring AI commits', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'h1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: { attribution: 'human' as const, automated: false, mode: 'none' as const, evidence: 'declared' as const, level: 'none', sources: [] },
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'foo.ts', additions: 5, deletions: 0 }] },
      }),
      makeCommit({
        hash: 'ai1',
        authorDate: '2024-01-06T00:00:00.000Z',
        tags: { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit', sources: ['tag:[ai]'] },
        stats: { totalAdditions: 2, totalDeletions: 0, files: [{ path: 'foo.ts', additions: 2, deletions: 0, status: 'modified' }] },
      }),
    ]);
    const result = calculateBaselinePersistence(stream);
    // 1 non-AI commit; foo.ts first seen at h1 (Jan 1), last seen at ai1 (Jan 6) → 5 days
    expect(result.commitsConsidered).toBe(1);
    expect(result.avgDays).toBe(5);
  });

  it('returns zeros when there are no human-attributed commits', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'ai1',
        tags: { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit', sources: ['tag:[ai]'] },
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'x.ts', additions: 1, deletions: 0 }] },
      }),
    ]);
    const result = calculateBaselinePersistence(stream);
    expect(result.commitsConsidered).toBe(0);
    expect(result.avgDays).toBe(0);
  });
});

describe('maxObservationDays (#29 age-normalization)', () => {
  const aiTags = { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit' as const, sources: [] };

  it('caps survival for a file reworked after the cap, treating it as censored at the cap', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'foo.ts', additions: 5, deletions: 0 }] },
      }),
      // Real rework happens 30 days later — outside a 10-day cap
      makeCommit({
        hash: 'a2',
        authorDate: '2024-01-31T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'foo.ts', additions: 1, deletions: 0, status: 'modified' }] },
      }),
    ]);
    const uncapped = calculatePersistence(stream);
    expect(uncapped.avgDays).toBe(30); // sees the real rework

    const capped = calculatePersistence(stream, undefined, { maxObservationDays: 10 });
    expect(capped.avgDays).toBe(10); // cap cuts observation off before the event
    expect(capped.censored).toBe(1); // treated as "no event observed", not as the real rework
  });

  it('does not cap survival for an event that happens within the cap', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'foo.ts', additions: 5, deletions: 0 }] },
      }),
      makeCommit({
        hash: 'a2',
        authorDate: '2024-01-03T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'foo.ts', additions: 1, deletions: 0, status: 'modified' }] },
      }),
    ]);
    const result = calculatePersistence(stream, undefined, { maxObservationDays: 10 });
    expect(result.avgDays).toBe(2); // real event, well inside the cap
    expect(result.censored).toBe(0);
  });

  it('caps a censored (never-touched-again) file at the cap instead of the full window', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z', // stream ends 2024-06-01: 152 days uncapped
        tags: aiTags,
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'stable.ts', additions: 5, deletions: 0 }] },
      }),
    ]);
    const result = calculatePersistence(stream, undefined, { maxObservationDays: 20 });
    expect(result.avgDays).toBe(20);
    expect(result.censored).toBe(1);
  });

  it('leaves uncapped behaviour untouched when maxObservationDays is not set', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 5, totalDeletions: 0, files: [{ path: 'stable.ts', additions: 5, deletions: 0 }] },
      }),
    ]);
    expect(calculatePersistence(stream).avgDays).toBe(152);
  });
});

describe('onlyCategory (#36 within-category comparison)', () => {
  const aiTags = { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit' as const, sources: [] };

  it('restricts consideration to a single category, bypassing the default exclusions', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: aiTags,
        stats: {
          totalAdditions: 3,
          totalDeletions: 0,
          files: [
            { path: 'src/app.ts', additions: 1, deletions: 0 },
            { path: 'src/app.test.ts', additions: 1, deletions: 0 },
            { path: 'db/migrations/001.sql', additions: 1, deletions: 0 },
          ],
        },
      }),
    ]);

    const sourceOnly = calculatePersistence(stream, undefined, {
      onlyCategory: 'source',
      excludeCategories: [],
    });
    expect(sourceOnly.filesConsidered).toBe(1);
    expect(sourceOnly.filesExcluded).toBe(2);

    const testsOnly = calculatePersistence(stream, undefined, {
      onlyCategory: 'tests',
      excludeCategories: [],
    });
    expect(testsOnly.filesConsidered).toBe(1);

    // Migrations are excluded by default everywhere else, but onlyCategory
    // explicitly asks for them — the caller gets real data, not zero.
    const migrationsOnly = calculatePersistence(stream, undefined, {
      onlyCategory: 'migrations',
      excludeCategories: [],
    });
    expect(migrationsOnly.filesConsidered).toBe(1);
  });
});

describe('fixed-horizon rapid retouch contract', () => {
  const aiTags = { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'inferred' as const, level: 'explicit' as const, sources: [] };

  it('includes an event exactly on the horizon boundary', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'first',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }] },
      }),
      makeCommit({
        hash: 'boundary',
        authorDate: '2024-01-08T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }] },
      }),
    ]);

    expect(calculatePersistence(stream).rapidRetouch[0]).toEqual({
      windowDays: 7,
      retouched: 1,
      eligible: 1,
      tooRecent: 0,
      rate: 1,
    });
  });

  it('uses stream topology when commit timestamps move backwards', () => {
    const stream = makeStream([
      makeCommit({
        hash: 'parent',
        authorDate: '2024-01-10T00:00:00.000Z',
        committerDate: '2024-01-10T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }] },
      }),
      makeCommit({
        hash: 'child',
        parents: ['parent'],
        // A bad/replayed clock must not move this child before its parent.
        authorDate: '2024-01-05T00:00:00.000Z',
        committerDate: '2024-01-05T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }] },
      }),
    ]);

    const result = calculatePersistence(stream);
    expect(result.censored).toBe(0);
    expect(result.avgDays).toBe(0); // elapsed time clamps an impossible negative clock gap
  });

  it('keeps a too-recent file outside the denominator', () => {
    const stream = {
      ...makeStream([
        makeCommit({
          hash: 'fresh',
          authorDate: '2024-01-01T00:00:00.000Z',
          tags: aiTags,
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }] },
        }),
      ]),
      generatedAt: '2024-01-06T00:00:00.000Z',
    };

    expect(calculatePersistence(stream).rapidRetouch[0]).toEqual({
      windowDays: 7,
      retouched: 0,
      eligible: 0,
      tooRecent: 1,
      rate: null,
    });
  });
});
