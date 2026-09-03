import { describe, it, expect } from 'vitest';
import { Commit, CommitStream } from '@evidtrail/core';
import { calculateOutcomeCorrelation } from './outcome-correlation.js';

function makeCommit(overrides: Partial<Commit> & { hash: string }): Commit {
  const commit: Commit = {
    authorName: 'Test',
    authorEmail: 'test@example.com',
    authorDate: '2025-01-01T00:00:00.000Z',
    committerName: 'Test',
    committerEmail: 'test@example.com',
    committerDate: '2025-01-01T00:00:00.000Z',
    message: 'commit',
    parents: [],
    inDefaultBranchAncestry: true,
    revertsCommit: null,
    tags: { attribution: 'unknown', automated: false, mode: 'unknown', evidence: 'none', level: 'none', sources: [] },
    stats: { totalAdditions: 1, totalDeletions: 0, files: [] },
    ...overrides,
  };
  if (overrides.authorDate && overrides.committerDate === undefined) {
    commit.committerDate = overrides.authorDate;
  }
  return commit;
}

function makeStream(commits: Commit[]): CommitStream {
  return {
    schemaVersion: 3,
    repoPath: '/test',
    defaultBranch: 'main',
    scope: 'default-branch',
    headSha: 'head',
    generatedAt: '2025-02-01T00:00:00.000Z',
    aiPatterns: [],
    commits: [...commits].reverse(),
  };
}

const aiTags: Commit['tags'] = { attribution: 'ai', automated: false, mode: 'agent', evidence: 'inferred', level: 'explicit', sources: [] };
const humanTags: Commit['tags'] = { attribution: 'human', automated: false, mode: 'none', evidence: 'declared', level: 'none', sources: [] };

describe('reverts', () => {
  it('attributes a resolved revert to the reverted commit, not the revert itself', () => {
    const result = calculateOutcomeCorrelation(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'r1', tags: humanTags, revertsCommit: 'a1' }),
      ])
    );
    expect(result.reverts.total).toBe(1);
    expect(result.reverts.resolved).toBe(1);
    expect(result.reverts.byAttribution.ai).toBe(1); // a1's cohort, not r1's
    expect(result.reverts.byMode.agent).toBe(1);
  });

  it('counts an unresolvable revert target without failing', () => {
    const result = calculateOutcomeCorrelation(
      makeStream([makeCommit({ hash: 'r1', revertsCommit: 'not-in-stream' })])
    );
    expect(result.reverts.total).toBe(1);
    expect(result.reverts.resolved).toBe(0);
    expect(result.reverts.byAttribution.ai).toBe(0);
  });

  it('reports zero reverts when none are present', () => {
    const result = calculateOutcomeCorrelation(makeStream([makeCommit({ hash: 'a1' })]));
    expect(result.reverts.total).toBe(0);
    expect(result.reverts.resolved).toBe(0);
  });
});

describe('hotfixes', () => {
  it('links a hotfix to the most recent prior touch of the same file, within the window', () => {
    const result = calculateOutcomeCorrelation(
      makeStream([
        makeCommit({
          hash: 'a1',
          tags: aiTags,
          authorDate: '2025-01-01T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'app.ts', additions: 1, deletions: 0 }] },
        }),
        makeCommit({
          hash: 'f1',
          message: 'fix: null pointer',
          authorDate: '2025-01-03T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'app.ts', additions: 1, deletions: 0, status: 'modified' }] },
        }),
      ]),
      { hotfixWindowDays: 7 }
    );
    expect(result.hotfixes.total).toBe(1);
    expect(result.hotfixes.linked).toBe(1);
    expect(result.hotfixes.byAttribution.ai).toBe(1); // a1's cohort
  });

  it('does not link a hotfix to a touch outside the window', () => {
    const result = calculateOutcomeCorrelation(
      makeStream([
        makeCommit({
          hash: 'a1',
          tags: aiTags,
          authorDate: '2025-01-01T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'app.ts', additions: 1, deletions: 0 }] },
        }),
        makeCommit({
          hash: 'f1',
          message: 'fix: something unrelated by now',
          authorDate: '2025-02-01T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'app.ts', additions: 1, deletions: 0, status: 'modified' }] },
        }),
      ]),
      { hotfixWindowDays: 7 }
    );
    expect(result.hotfixes.total).toBe(1);
    expect(result.hotfixes.linked).toBe(0);
  });

  it('picks the closest antecedent when a hotfix touches multiple files', () => {
    const result = calculateOutcomeCorrelation(
      makeStream([
        makeCommit({
          hash: 'old',
          tags: humanTags,
          authorDate: '2025-01-01T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'a.ts', additions: 1, deletions: 0 }] },
        }),
        makeCommit({
          hash: 'recent',
          tags: aiTags,
          authorDate: '2025-01-05T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'b.ts', additions: 1, deletions: 0 }] },
        }),
        makeCommit({
          hash: 'f1',
          message: 'hotfix: both',
          authorDate: '2025-01-06T00:00:00.000Z',
          stats: {
            totalAdditions: 2,
            totalDeletions: 0,
            files: [
              { path: 'a.ts', additions: 1, deletions: 0, status: 'modified' },
              { path: 'b.ts', additions: 1, deletions: 0, status: 'modified' },
            ],
          },
        }),
      ]),
      { hotfixWindowDays: 30 }
    );
    // b.ts (recent, 1 day gap) is closer than a.ts (old, 5 day gap)
    expect(result.hotfixes.byAttribution.ai).toBe(1);
    expect(result.hotfixes.byAttribution.human).toBe(0);
  });

  it('recognizes conventional-commit fix and hotfix prefixes, ignores unrelated commits', () => {
    const result = calculateOutcomeCorrelation(
      makeStream([
        makeCommit({ hash: 'c1', message: 'fix(auth): token refresh' }),
        makeCommit({ hash: 'c2', message: 'hotfix: rollback bad deploy' }),
        makeCommit({ hash: 'c3', message: 'feat: add dashboard' }),
      ])
    );
    expect(result.hotfixes.total).toBe(2);
  });

  it('lets a chained hotfix attribute to the immediately preceding hotfix', () => {
    const result = calculateOutcomeCorrelation(
      makeStream([
        makeCommit({
          hash: 'a1',
          tags: aiTags,
          authorDate: '2025-01-01T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'app.ts', additions: 1, deletions: 0 }] },
        }),
        makeCommit({
          hash: 'f1',
          tags: humanTags,
          message: 'fix: first attempt',
          authorDate: '2025-01-02T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'app.ts', additions: 1, deletions: 0, status: 'modified' }] },
        }),
        makeCommit({
          hash: 'f2',
          message: 'fix: actually fix it this time',
          authorDate: '2025-01-03T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'app.ts', additions: 1, deletions: 0, status: 'modified' }] },
        }),
      ]),
      { hotfixWindowDays: 7 }
    );
    expect(result.hotfixes.total).toBe(2);
    expect(result.hotfixes.linked).toBe(2);
    // f1 links to a1 (ai); f2 links to f1 (human), not back to a1
    expect(result.hotfixes.byAttribution.ai).toBe(1);
    expect(result.hotfixes.byAttribution.human).toBe(1);
  });

  it('reports zero hotfixes when none are present', () => {
    const result = calculateOutcomeCorrelation(makeStream([makeCommit({ hash: 'a1' })]));
    expect(result.hotfixes.total).toBe(0);
    expect(result.hotfixes.linked).toBe(0);
  });
});

describe('outcome rates against the base rate', () => {
  // A revert commit is itself authored work, so it belongs in the base-rate
  // denominator. These fixtures therefore attribute each revert to the same
  // cohort as its target, which is what an 80%-AI repo actually looks like.
  function repoWith(revertTargets: Array<'ai' | 'human'>) {
    const commits: Commit[] = [];
    for (let i = 0; i < 8; i++) commits.push(makeCommit({ hash: `ai${i}`, tags: aiTags }));
    for (let i = 0; i < 2; i++) commits.push(makeCommit({ hash: `h${i}`, tags: humanTags }));
    // Separate counters: the target must be a commit that actually exists,
    // or the revert reads as unresolved and drops out of the denominator.
    let nextAi = 0;
    let nextHuman = 0;
    revertTargets.forEach((cohort, i) => {
      const target = cohort === 'ai' ? `ai${nextAi++}` : `h${nextHuman++}`;
      commits.push(
        makeCommit({
          hash: `rev${i}`,
          message: 'Revert x',
          revertsCommit: target,
          tags: cohort === 'ai' ? aiTags : humanTags,
        })
      );
    });
    return makeStream(commits);
  }

  it('reports a ratio of ~1 when a cohort is reverted exactly as often as its size predicts', () => {
    // 12 of 15 authored commits are AI (80%); 4 of 5 reverts hit AI (80%)
    const result = calculateOutcomeCorrelation(repoWith(['ai', 'ai', 'ai', 'ai', 'human']));
    const ai = result.reverts.rates.ai;
    expect(ai.count).toBe(4);
    expect(ai.share).toBeCloseTo(0.8, 2);
    expect(ai.baseRate).toBeCloseTo(0.8, 2);
    // The headline point: AI dominates the raw count and yet there is no signal
    expect(ai.ratio).toBeCloseTo(1, 1);
  });

  it('reports a ratio above 1 only when a cohort is genuinely over-represented', () => {
    // Every revert hits AI: 100% of reverts against an 86.7% base rate
    const result = calculateOutcomeCorrelation(repoWith(['ai', 'ai', 'ai', 'ai', 'ai']));
    const ai = result.reverts.rates.ai;
    expect(ai.share).toBe(1);
    expect(ai.ratio).toBeGreaterThan(1);
    expect(ai.ratio).toBeLessThan(1.2);
  });

  it('flags an under-represented cohort taking more than its share', () => {
    // Humans: 3 of 12 authored commits (25%) but 1 of 2 reverts (50%) → 2x
    const result = calculateOutcomeCorrelation(repoWith(['ai', 'human']));
    const human = result.reverts.rates.human;
    expect(human.share).toBeCloseTo(0.5, 2);
    expect(human.ratio).toBeGreaterThan(1.5);
    expect(result.reverts.rates.ai.ratio).toBeLessThan(1);
  });

  it('excludes automated commits from the base rate — they are not authored work', () => {
    const automatedTags: Commit['tags'] = {
      attribution: 'automated', automated: true,
      mode: 'none',
      evidence: 'inferred',
      level: 'none',
      sources: ['automated:bot'],
    };
    const stream = makeStream([
      makeCommit({ hash: 'a1', tags: aiTags }),
      makeCommit({ hash: 'h1', tags: humanTags }),
      // 20 bot commits must not dilute the base rate toward ~5%
      ...Array.from({ length: 20 }, (_, i) => makeCommit({ hash: `b${i}`, tags: automatedTags })),
      makeCommit({ hash: 'r1', message: 'Revert', revertsCommit: 'a1', tags: aiTags }),
    ]);
    const result = calculateOutcomeCorrelation(stream);
    // 2 AI of 3 authored (a1, h1, r1) — the bots are excluded entirely
    expect(result.reverts.rates.ai.baseRate).toBeCloseTo(2 / 3, 2);
    expect(result.reverts.rates.ai.share).toBe(1);
  });

  it('leaves rates null when there is nothing to divide by', () => {
    const result = calculateOutcomeCorrelation(makeStream([makeCommit({ hash: 'a1', tags: aiTags })]));
    expect(result.reverts.rates.ai.share).toBeNull();
    expect(result.reverts.rates.ai.ratio).toBeNull();
    expect(result.reverts.rates.ai.count).toBe(0);
  });
});
