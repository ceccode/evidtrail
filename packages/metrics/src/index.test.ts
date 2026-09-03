import { describe, it, expect, vi } from 'vitest';
import { calculateMetrics } from './index.js';
import { Commit, CommitStream } from '@evidtrail/core';

function makeCommit(overrides: Partial<Commit> & { hash: string }): Commit {
  const commit: Commit = {
    authorName: 'Test User',
    authorEmail: 'test@example.com',
    authorDate: '2025-01-01T00:00:00.000Z',
    committerName: 'Test User',
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
    repoPath: '/test/repo',
    defaultBranch: 'main',
    scope: 'default-branch',
    headSha: 'head',
    generatedAt: '2025-01-01T00:00:00.000Z',
    aiPatterns: [],
    commits: [...commits].reverse(),
  };
}

const aiTags: Commit['tags'] = { attribution: 'ai', automated: false, mode: 'agent', evidence: 'inferred', level: 'explicit', sources: ['tag:[ai]'] };
const humanTags: Commit['tags'] = { attribution: 'human', automated: false, mode: 'none', evidence: 'declared', level: 'none', sources: [] };
const unknownTags: Commit['tags'] = { attribution: 'unknown', automated: false, mode: 'unknown', evidence: 'none', level: 'none', sources: [] };

describe('calculateMetrics attribution coverage', () => {
  it('is byte-deterministic for the same collected snapshot', () => {
    const stream = makeStream([makeCommit({ hash: 'a1', tags: aiTags })]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const first = calculateMetrics(stream);
      vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
      const second = calculateMetrics(stream);

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.generatedAt).toBe(stream.generatedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports coverage as (ai + human) / total', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'h1', tags: humanTags }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
        makeCommit({ hash: 'u2', tags: unknownTags }),
      ])
    );

    expect(metrics.attribution.commitsTotal).toBe(4);
    expect(metrics.attribution.ai).toBe(1);
    expect(metrics.attribution.human).toBe(1);
    expect(metrics.attribution.unknown).toBe(2);
    expect(metrics.attribution.coverage).toBe(0.5);
    expect(metrics.attribution.belowThreshold).toBe(true); // default threshold 0.7
    expect(metrics.attribution.missingEvidence).toEqual({
      commits: [
        { hash: 'u2', subject: 'commit' },
        { hash: 'u1', subject: 'commit' },
      ],
      truncated: false,
    });
  });

  it('bounds the evidence-gap diagnostic without hiding the total', () => {
    const metrics = calculateMetrics(
      makeStream(
        Array.from({ length: 21 }, (_, index) =>
          makeCommit({ hash: `u${index + 1}`, message: `undeclared ${index + 1}`, tags: unknownTags })
        )
      )
    );

    expect(metrics.attribution.unknown).toBe(21);
    expect(metrics.attribution.missingEvidence.commits).toHaveLength(20);
    expect(metrics.attribution.missingEvidence.truncated).toBe(true);
  });

  it('counts automated commits toward coverage — their provenance is known', () => {
    const automatedTags: Commit['tags'] = {
      attribution: 'automated', automated: true,
      mode: 'none',
      evidence: 'inferred',
      level: 'none',
      sources: ['automated:bot'],
    };
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'b1', tags: automatedTags }),
        makeCommit({ hash: 'b2', tags: automatedTags }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
      ])
    );

    expect(metrics.attribution.automated).toBe(2);
    expect(metrics.attribution.coverage).toBe(0.75); // (1 ai + 0 human + 2 automated) / 4
    // automated joins no cohort
    expect(metrics.persistence.commitsConsidered).toBe(1);
  });

  it('reports recent-window coverage alongside all-time (#52)', () => {
    const recent = '2024-12-27T00:00:00.000Z';
    const old = '2023-12-01T00:00:00.000Z';
    const metrics = calculateMetrics(
      makeStream([
        // Old, untagged: drags all-time coverage down forever
        makeCommit({ hash: 'o1', tags: unknownTags, authorDate: old }),
        makeCommit({ hash: 'o2', tags: unknownTags, authorDate: old }),
        makeCommit({ hash: 'o3', tags: unknownTags, authorDate: old }),
        // Recent, tagged: current hygiene is perfect
        makeCommit({ hash: 'r1', tags: aiTags, authorDate: recent }),
      ])
    );

    expect(metrics.attribution.coverage).toBe(0.25); // all-time: bleak
    expect(metrics.attribution.belowThreshold).toBe(true);
    expect(metrics.attribution.recent?.coverage).toBe(1); // recent: perfect
    expect(metrics.attribution.recent?.commitsTotal).toBe(1);
    expect(metrics.attribution.recent?.belowThreshold).toBe(false);
  });

  it('has a null recent block when the window contains no commits', () => {
    const old = '2023-12-01T00:00:00.000Z';
    const metrics = calculateMetrics(
      makeStream([makeCommit({ hash: 'o1', tags: aiTags, authorDate: old })]),
      { coverageWindowDays: 30 }
    );
    expect(metrics.attribution.recent).toBeNull();
  });

  it('flags belowThreshold using a custom coverageThreshold', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
      ]),
      { coverageThreshold: 0.4 }
    );

    expect(metrics.attribution.coverage).toBe(0.5);
    expect(metrics.attribution.belowThreshold).toBe(false);
  });

  it('handles an empty stream', () => {
    const metrics = calculateMetrics(makeStream([]));
    expect(metrics.attribution.coverage).toBe(0);
    expect(metrics.baseline).toBeNull();
    expect(metrics.delta).toBeNull();
  });
});

describe('calculateMetrics baseline cohort', () => {
  it('returns null baseline and delta when no commits are attributed human', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
      ])
    );

    expect(metrics.baseline).toBeNull();
    expect(metrics.delta).toBeNull();
    expect(metrics.caveats.some((c) => c.includes('No baseline'))).toBe(true);
  });

  it('builds the baseline from explicitly human-attributed commits', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'h1', tags: humanTags }),
        makeCommit({ hash: 'h2', tags: humanTags, inDefaultBranchAncestry: false }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
      ])
    );

    expect(metrics.baseline).not.toBeNull();
    expect(metrics.baseline!.assumed).toBe(false);
    expect(metrics.baseline!.persistence.commitsConsidered).toBe(2); // unknown excluded
    expect(metrics.delta).not.toBeNull();
  });

  it('assigns no-evidence commits to the baseline with defaultMode: none, marked assumed', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
        makeCommit({ hash: 'u2', tags: unknownTags }),
      ]),
      { defaultMode: 'none' }
    );

    expect(metrics.baseline).not.toBeNull();
    expect(metrics.baseline!.assumed).toBe(true);
    expect(metrics.baseline!.persistence.commitsConsidered).toBe(2);
    // A prior joins a cohort but is not evidence: coverage still reports how
    // little this repo actually knows about itself (#25).
    expect(metrics.attribution.unknown).toBe(2);
    expect(metrics.attribution.evidence.none).toBe(2);
    expect(metrics.attribution.coverage).toBeCloseTo(1 / 3);
    expect(metrics.caveats.some((c) => c.includes("assumed autonomy level 'none'"))).toBe(true);
  });

  it('never assigns automated commits to a cohort, even with a prior', () => {
    const excludedTags: Commit['tags'] = {
      attribution: 'automated', automated: true,
      mode: 'none',
      evidence: 'declared',
      level: 'none',
      sources: ['manifest:excluded'],
    };
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'x1', tags: excludedTags }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
      ]),
      { defaultMode: 'assisted' }
    );

    // prior pulls u1 into the AI cohort, but never x1
    expect(metrics.persistence.commitsConsidered).toBe(2);
  });

  it('reports cohort age and task mix per cohort, null when a cohort is empty', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({
          hash: 'a1',
          tags: aiTags,
          stats: {
            totalAdditions: 2,
            totalDeletions: 0,
            files: [
              { path: 'src/a.ts', additions: 1, deletions: 0 },
              { path: 'src/a.test.ts', additions: 1, deletions: 0 },
            ],
          },
        }),
      ])
    );

    expect(metrics.cohorts.ai.age?.commits).toBe(1);
    expect(metrics.cohorts.ai.age?.avgAgeDays).toBe(0); // measured at stream.generatedAt
    expect(metrics.cohorts.ai.taskMix?.source).toBe(1);
    expect(metrics.cohorts.ai.taskMix?.tests).toBe(1);
    expect(metrics.cohorts.baseline.age).toBeNull();
    expect(metrics.cohorts.baseline.taskMix).toBeNull();
  });

  it('computes per-mode stats, excluding automated commits, null for empty modes', () => {
    const assistedTags: Commit['tags'] = {
      attribution: 'ai', automated: false,
      mode: 'assisted',
      evidence: 'inferred',
      level: 'implicit',
      sources: ['implicit:x'],
    };
    const automatedTags: Commit['tags'] = {
      attribution: 'automated', automated: true,
      mode: 'none',
      evidence: 'inferred',
      level: 'none',
      sources: ['automated:bot'],
    };
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }), // agent
        makeCommit({ hash: 'a2', tags: aiTags, inDefaultBranchAncestry: false }), // agent, unmerged
        makeCommit({ hash: 's1', tags: assistedTags }),
        makeCommit({ hash: 'b1', tags: automatedTags }), // mode none, but automated → excluded
      ])
    );

    expect(metrics.byMode.agent?.commits).toBe(2);
    expect(metrics.byMode.assisted?.commits).toBe(1);
    expect(metrics.byMode.none).toBeNull(); // the automated commit doesn't count
    expect(metrics.byMode.autocomplete).toBeNull();
  });

  it('assigns no-evidence commits to the AI cohort with an AI-level defaultMode', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'h1', tags: humanTags }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
      ]),
      { defaultMode: 'assisted' }
    );

    expect(metrics.persistence.commitsConsidered).toBe(2); // ai + no-evidence
    expect(metrics.baseline!.persistence.commitsConsidered).toBe(1); // human only
    expect(metrics.baseline!.assumed).toBe(false);
  });
});

describe('fairComparison (#29 age-normalization)', () => {
  it('is null when there is no baseline cohort', () => {
    const metrics = calculateMetrics(makeStream([makeCommit({ hash: 'a1', tags: aiTags })]));
    expect(metrics.fairComparison).toBeNull();
  });

  it('caps both cohorts to the younger cohort average age, unlike the raw comparison', () => {
    // Baseline: old commit whose file was never touched again — accumulates
    // a lot of raw persistence purely from clock time.
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    // AI: recent commit, also never touched again. 9.5 days, not 10:
    // `daysBetween` ceils, and the age is measured against a `new Date()`
    // taken inside calculateMetrics, milliseconds AFTER this line — an
    // exact 10-day offset ceils to 10 or 11 depending on whether that
    // millisecond has ticked, which made this test flaky under load.
    // Anywhere strictly inside the (9, 10] interval ceils to 10 stably.
    const recentDate = new Date(Date.now() - 9.5 * 24 * 60 * 60 * 1000).toISOString();

    const metrics = calculateMetrics({
      ...makeStream([
        makeCommit({
          hash: 'h1',
          tags: humanTags,
          authorDate: oldDate,
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'old.ts', additions: 1, deletions: 0 }] },
        }),
        makeCommit({
          hash: 'a1',
          tags: aiTags,
          authorDate: recentDate,
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'new.ts', additions: 1, deletions: 0 }] },
        }),
      ]),
      // Both commits post-date the fixed '2025-01-01' default: the
      // observation end must be "now" for their persistence to make sense.
      generatedAt: new Date().toISOString(),
    });

    // Raw comparison: baseline looks far more "persistent" just because it's old
    expect(metrics.baseline!.persistence.avgDays).toBeGreaterThan(150);
    expect(metrics.persistence.avgDays).toBeLessThan(15);

    // Fair comparison: both capped to ~10 days (the AI cohort's average age)
    expect(metrics.fairComparison).not.toBeNull();
    expect(metrics.fairComparison!.capDays).toBeCloseTo(10, 0);
    expect(metrics.fairComparison!.ai.avgDays).toBeLessThanOrEqual(10);
    expect(metrics.fairComparison!.baseline.avgDays).toBeLessThanOrEqual(10);
  });
});

describe('byCategory (#36 step 2 within-category comparison)', () => {
  it('is computed even without a baseline cohort', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({
          hash: 'a1',
          tags: aiTags,
          stats: {
            totalAdditions: 2,
            totalDeletions: 0,
            files: [
              { path: 'src/a.ts', additions: 1, deletions: 0 },
              { path: 'src/a.test.ts', additions: 1, deletions: 0 },
            ],
          },
        }),
      ])
    );

    expect(metrics.byCategory.source.ai?.filesConsidered).toBe(1);
    expect(metrics.byCategory.tests.ai?.filesConsidered).toBe(1);
    expect(metrics.byCategory.source.baseline).toBeNull();
    expect(metrics.byCategory.source.deltaAvgDays).toBeNull();
    expect(metrics.byCategory.migrations.ai).toBeNull(); // no migration files touched
  });

  it('computes a delta only when both sides have files in that category', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({
          hash: 'a1',
          tags: aiTags,
          authorDate: '2025-01-01T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }] },
        }),
        makeCommit({
          hash: 'a2',
          tags: aiTags,
          authorDate: '2025-01-10T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'src/a.ts', additions: 1, deletions: 0, status: 'modified' }] },
        }),
        makeCommit({
          hash: 'h1',
          tags: humanTags,
          authorDate: '2025-01-01T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'src/b.ts', additions: 1, deletions: 0 }] },
        }),
      ])
    );

    expect(metrics.byCategory.source.ai?.filesConsidered).toBe(1);
    expect(metrics.byCategory.source.baseline?.filesConsidered).toBe(1);
    expect(metrics.byCategory.source.deltaAvgDays).not.toBeNull();
    expect(metrics.byCategory.tests.ai).toBeNull();
    expect(metrics.byCategory.tests.deltaAvgDays).toBeNull();
  });
});

describe('outcomeCorrelation (#26)', () => {
  it('is always present and reflects reverts/hotfixes end to end via calculateMetrics', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({
          hash: 'a1',
          tags: aiTags,
          authorDate: '2025-01-01T00:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'app.ts', additions: 1, deletions: 0 }] },
        }),
        makeCommit({
          hash: 'r1',
          message: 'Revert "feat: a1"',
          authorDate: '2025-01-02T00:00:00.000Z',
          revertsCommit: 'a1',
        }),
      ]),
      { hotfixWindowDays: 7 }
    );

    expect(metrics.outcomeCorrelation.reverts.total).toBe(1);
    expect(metrics.outcomeCorrelation.reverts.resolved).toBe(1);
    expect(metrics.outcomeCorrelation.reverts.byAttribution.ai).toBe(1);
  });

  it('is present (all zero) even for a stream with no reverts or hotfixes', () => {
    const metrics = calculateMetrics(makeStream([makeCommit({ hash: 'a1', tags: aiTags })]));
    expect(metrics.outcomeCorrelation.reverts.total).toBe(0);
    expect(metrics.outcomeCorrelation.hotfixes.total).toBe(0);
  });
});

describe('coverage is the evidence axis (#25)', () => {
  it('counts declared and inferred provenance, whatever the attribution is', () => {
    const declaredHuman: Commit['tags'] = {
      attribution: 'human',
      automated: false,
      mode: 'none',
      evidence: 'declared',
      level: 'none',
      sources: ['trailer:AI-Mode'],
    };
    // AI participated, level unknown: real evidence, no autonomy level.
    // The old model had to call this state 'no evidence' and undercounted it.
    const anonymousAI: Commit['tags'] = {
      attribution: 'ai',
      automated: false,
      mode: 'unknown',
      evidence: 'inferred',
      level: 'explicit',
      sources: ['tag:[ai]'],
    };

    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'h1', tags: declaredHuman }),
        makeCommit({ hash: 'a1', tags: anonymousAI }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
        makeCommit({ hash: 'u2', tags: unknownTags }),
      ])
    );

    expect(metrics.attribution.evidence).toEqual({ declared: 1, inferred: 1, none: 2 });
    expect(metrics.attribution.coverage).toBe(0.5);
  });

  it('is never raised by a prior — an assumption is not evidence', () => {
    const stream = makeStream([
      makeCommit({ hash: 'u1', tags: unknownTags }),
      makeCommit({ hash: 'u2', tags: unknownTags }),
    ]);

    const withoutPrior = calculateMetrics(stream);
    const withPrior = calculateMetrics(stream, { defaultMode: 'agent' });

    expect(withoutPrior.attribution.coverage).toBe(0);
    expect(withPrior.attribution.coverage).toBe(0);
    // The prior moves cohorts, not knowledge
    expect(withPrior.byMode.agent?.commits).toBe(2);
    expect(withoutPrior.byMode.agent).toBeNull();
  });

  it('keeps automated commits covered — their provenance is known', () => {
    const automated: Commit['tags'] = {
      attribution: 'automated',
      automated: true,
      mode: 'none',
      evidence: 'inferred',
      level: 'none',
      sources: ['automated:merge-commit'],
    };
    const metrics = calculateMetrics(
      makeStream([makeCommit({ hash: 'm1', tags: automated })]),
      { defaultMode: 'agent' }
    );

    expect(metrics.attribution.coverage).toBe(1);
    // ...but a prior still never drags them into a cohort
    expect(metrics.byMode.agent).toBeNull();
    expect(metrics.byMode.none).toBeNull();
  });
});

describe('automated commits stay off the autonomy axis (#25/#39)', () => {
  // Found by dogfooding the two-axis report on this repo: 37 merge/bot
  // commits carry `mode: 'none'`, and the headline table counted them as
  // hand-written — while `byMode`, which excludes automation, showed none.
  // Two tables in one report disagreeing about the same commits.
  it('excludes automated commits from the per-mode counts', () => {
    const automated: Commit['tags'] = {
      attribution: 'automated',
      automated: true,
      mode: 'none',
      evidence: 'inferred',
      level: 'none',
      sources: ['automated:merge-commit'],
    };
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'm1', tags: automated }),
        makeCommit({ hash: 'm2', tags: automated }),
      ])
    );

    expect(metrics.attribution.modes.none).toBe(0);
    expect(metrics.attribution.automated).toBe(2);
    // The headline table and the per-level table now describe the same set
    expect(metrics.byMode.none).toBeNull();
  });
});

describe('per-mode cohorts separate observed from assumed (#25)', () => {
  // Found running evidtrail against varano-239: one report said `agent 5` in the
  // observed table and `agent 16` in the per-level table. Both were correct
  // under their own definition, neither said which definition it used, and
  // the reader takes the bigger number for the real one.
  it('reports how many commits a prior placed in each cohort', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
        makeCommit({ hash: 'u2', tags: unknownTags }),
      ]),
      { defaultMode: 'agent' }
    );

    expect(metrics.byMode.agent!.commits).toBe(3);
    expect(metrics.byMode.agent!.assumed).toBe(2);
    // The observed table keeps reporting only what commits actually declare
    expect(metrics.attribution.modes.agent).toBe(1);
    expect(metrics.attribution.evidence.none).toBe(2);
  });

  it('reports zero assumed when no prior is configured', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
      ])
    );

    expect(metrics.byMode.agent!.commits).toBe(1);
    expect(metrics.byMode.agent!.assumed).toBe(0);
    // With no prior the two tables agree exactly
    expect(metrics.byMode.agent!.commits).toBe(metrics.attribution.modes.agent);
  });
});

describe('repo-level quality (#77 step 1)', () => {
  // The quality-first premise: these numbers must mean something on a repo
  // where nobody declares anything — the normal case, per #77's assumption.
  it('is fully populated at 0% evidence coverage', () => {
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'u1', tags: unknownTags }),
        makeCommit({ hash: 'u2', tags: unknownTags }),
        makeCommit({ hash: 'u3', tags: unknownTags }),
      ])
    );

    expect(metrics.attribution.coverage).toBe(0);
    expect(metrics.repo.commitsAuthored).toBe(3);
    expect(metrics.repo.persistence.commitsConsidered).toBe(3);
    // ...while the cohort view is rightly empty: no evidence, no cohorts
    expect(metrics.persistence.commitsConsidered).toBe(0);
  });

  // The honesty property: "assume everything is AI" must never become
  // "trust the assumption". The prior moves cohorts; it must not be able to
  // move the repo-level numbers by a single unit.
  it('is byte-identical with and without a defaultMode prior', () => {
    const commits = [
      makeCommit({ hash: 'a1', tags: aiTags }),
      makeCommit({ hash: 'u1', tags: unknownTags }),
      makeCommit({ hash: 'u2', tags: unknownTags }),
    ];

    const withoutPrior = calculateMetrics(makeStream(commits));
    const withPrior = calculateMetrics(makeStream(commits), { defaultMode: 'agent' });

    expect(withPrior.repo).toEqual(withoutPrior.repo);
    // Sanity: the prior did change the cohort view, so the comparison above
    // is not vacuous
    expect(withPrior.persistence.commitsConsidered).not.toBe(
      withoutPrior.persistence.commitsConsidered
    );
  });

  it('excludes automation from authored commits and from persistence', () => {
    const automated: Commit['tags'] = {
      attribution: 'automated',
      automated: true,
      mode: 'none',
      evidence: 'inferred',
      level: 'none',
      sources: ['automated:merge-commit'],
    };
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }),
        makeCommit({ hash: 'u1', tags: unknownTags }),
        makeCommit({ hash: 'm1', tags: automated }),
      ])
    );

    expect(metrics.repo.commitsAuthored).toBe(2);
    expect(metrics.repo.commitsAutomated).toBe(1);
    expect(metrics.repo.persistence.commitsConsidered).toBe(2);
  });
});
