import { describe, it, expect } from 'vitest';
import { calculatePersistence } from './persistence.js';
import type { Commit, CommitStream } from '@evidtrail/core';

const isAI = (commit: Commit) => commit.tags.attribution === 'ai';
const horizon = (result: ReturnType<typeof calculatePersistence>, days: number) =>
  result.rapidRetouch.find((r) => r.windowDays === days)!;

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
  it('returns zeros when no commit is a target', () => {
    const stream = makeStream([makeCommit({})]);
    const result = calculatePersistence(stream, isAI);
    expect(result.commitsConsidered).toBe(0);
    expect(result.filesConsidered).toBe(0);
    expect(horizon(result, 7).rate).toBeNull();
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
    const result = calculatePersistence(stream, isAI);
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
    const result = calculatePersistence(stream, isAI);
    expect(result.commitsConsidered).toBe(1);
    // retouched on day 10: outside the 7-day horizon, inside the 30-day one
    expect(horizon(result, 7)).toMatchObject({ retouched: 0, eligible: 1 });
    expect(horizon(result, 30)).toMatchObject({ retouched: 1, eligible: 1 });
  });

  it('classifies each file per horizon: retouched, or eligible after an event-free horizon', () => {
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
    const result = calculatePersistence(stream, isAI);
    // b.ts: modified after 5 days → retouched within 7
    // a.ts: never touched again, observed 152 days → eligible, not retouched
    expect(horizon(result, 7)).toMatchObject({ retouched: 1, eligible: 2, tooRecent: 0 });
    expect(result.filesConsidered).toBe(2);
  });

  it('counts a file never modified again as eligible and not retouched, not as missing', () => {
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
    const result = calculatePersistence(stream, isAI);
    // stream generatedAt is 2024-06-01 → observed 152 days with no event
    expect(horizon(result, 90)).toMatchObject({ retouched: 0, eligible: 1, tooRecent: 0, rate: 0 });
  });

  it('dates the retouch at the first subsequent touch, same author group included', () => {
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
    const result = calculatePersistence(stream, isAI);
    // the retouch is the FIRST subsequent touch (2 days), not the last (29)
    expect(horizon(result, 7).retouched).toBe(1);
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
    const result = calculatePersistence(stream, isAI);
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
    const result = calculatePersistence(stream, isAI);
    // Deletion is the first subsequent event, on day 19
    expect(horizon(result, 7)).toMatchObject({ retouched: 0, eligible: 1 });
    expect(horizon(result, 30)).toMatchObject({ retouched: 1, eligible: 1 });
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

    expect(calculatePersistence(stream, isAI).rapidRetouch[0]).toEqual({
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

    const result = calculatePersistence(stream, isAI);
    // the child is the retouch, and an impossible negative clock gap clamps
    // to day 0 instead of falling outside every horizon
    expect(horizon(result, 7)).toMatchObject({ retouched: 1, eligible: 1 });
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

    expect(calculatePersistence(stream, isAI).rapidRetouch[0]).toEqual({
      windowDays: 7,
      retouched: 0,
      eligible: 0,
      tooRecent: 1,
      rate: null,
    });
  });
});

describe('observation end under --until', () => {
  // Found by an external review: with `--until 2 Jan`, a file added on 1 Jan
  // and edited on 4 Jan was reported as "survived 7 days untouched" (0%),
  // because the edit was outside the stream while the clock ran on to the
  // collection date months later. Observation stops at the bound.
  const aiTags = { attribution: 'ai' as const, automated: false, mode: 'agent' as const, evidence: 'declared' as const, level: 'explicit' as const, sources: ['trailer'] };

  it('counts a file first touched just before the bound as too recent, not as untouched', () => {
    const stream: CommitStream = {
      ...makeStream([
        makeCommit({
          hash: 'a1',
          authorDate: '2026-01-01T10:00:00.000Z',
          tags: aiTags,
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'f.ts', additions: 1, deletions: 0 }] },
        }),
      ]),
      generatedAt: '2026-09-18T00:00:00.000Z',
      until: '2026-01-02T00:00:00.000Z',
    };
    const week = calculatePersistence(stream, isAI).rapidRetouch.find((r) => r.windowDays === 7)!;
    expect(week).toMatchObject({ retouched: 0, eligible: 0, tooRecent: 1, rate: null });
    // and the same file, observed to the collection date, is eligible
    const unbounded = calculatePersistence({ ...stream, until: undefined }, isAI).rapidRetouch.find((r) => r.windowDays === 7)!;
    expect(unbounded).toMatchObject({ retouched: 0, eligible: 1, tooRecent: 0, rate: 0 });
  });

  it('ignores a bound later than the collection time, and one that is not an absolute date', () => {
    const base = makeStream([
      makeCommit({
        hash: 'a1',
        authorDate: '2024-01-01T00:00:00.000Z',
        tags: aiTags,
        stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'f.ts', additions: 1, deletions: 0 }] },
      }),
    ]);
    const later = calculatePersistence({ ...base, until: '2030-01-01T00:00:00.000Z' }, isAI);
    const relative = calculatePersistence({ ...base, until: '10d' }, isAI); // pre-fix streams stored the flag text
    const plain = calculatePersistence(base, isAI);
    expect(later).toEqual(plain);
    expect(relative).toEqual(plain);
  });
});

describe('renames follow the file', () => {
  const aiTags: CommitStream['commits'][0]['tags'] = { attribution: 'ai', automated: false, mode: 'agent', evidence: 'declared', level: 'explicit', sources: [] };
  const file = (path: string, additions: number, deletions: number, previousPath?: string) => ({
    path,
    additions,
    deletions,
    ...(previousPath ? { previousPath, status: 'renamed' as const } : {}),
  });
  const commit = (hash: string, date: string, files: ReturnType<typeof file>[]) =>
    makeCommit({ hash, authorDate: date, tags: aiTags, stats: { totalAdditions: 0, totalDeletions: 0, files } });
  const week = (stream: CommitStream) =>
    calculatePersistence(stream, isAI).rapidRetouch.find((r) => r.windowDays === 7)!;

  it('counts an edit after a rename as a retouch of the original file', () => {
    // old.ts (1 Jan) → new.ts (2 Jan, pure rename) → edited (4 Jan). Before:
    // three eligible files and no retouch — 0%. The truth is one file,
    // retouched on day 3 — 100%.
    const stream = makeStream([
      commit('a', '2024-01-01T00:00:00.000Z', [file('old.ts', 2, 0)]),
      commit('b', '2024-01-02T00:00:00.000Z', [file('new.ts', 0, 0, 'old.ts')]),
      commit('c', '2024-01-04T00:00:00.000Z', [file('new.ts', 1, 1)]),
    ]);
    expect(week(stream)).toMatchObject({ retouched: 1, eligible: 1, tooRecent: 0, rate: 1 });
    expect(calculatePersistence(stream, isAI).filesConsidered).toBe(1);
  });

  it('does not count a pure rename as a touch, and does not open a lifecycle with one', () => {
    const stream = makeStream([
      commit('a', '2024-01-01T00:00:00.000Z', [file('old.ts', 2, 0)]),
      commit('b', '2024-01-02T00:00:00.000Z', [file('new.ts', 0, 0, 'old.ts')]),
      // nothing else: the file survives under its new name
    ]);
    expect(week(stream)).toMatchObject({ retouched: 0, eligible: 1, tooRecent: 0, rate: 0 });

    // a target commit that only moves a file it never wrote starts no clock
    const moveOnly = makeStream([
      makeCommit({
        hash: 'h',
        authorDate: '2024-01-01T00:00:00.000Z',
        stats: { totalAdditions: 2, totalDeletions: 0, files: [file('old.ts', 2, 0)] },
      }), // not a target commit
      commit('b', '2024-01-02T00:00:00.000Z', [file('new.ts', 0, 0, 'old.ts')]),
    ]);
    expect(calculatePersistence(moveOnly, isAI).filesConsidered).toBe(0);
  });

  it('counts a rename that also edits as a touch', () => {
    const stream = makeStream([
      commit('a', '2024-01-01T00:00:00.000Z', [file('old.ts', 2, 0)]),
      commit('b', '2024-01-03T00:00:00.000Z', [file('new.ts', 1, 1, 'old.ts')]),
    ]);
    expect(week(stream)).toMatchObject({ retouched: 1, eligible: 1 });
  });
});
