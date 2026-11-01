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
    // automation is not authored work
    expect(metrics.repo.persistence.commitsConsidered).toBe(2);
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
    expect(metrics.repo.commitsAuthored).toBe(0);
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
    expect(withPrior.attribution.unknown).toBe(2);
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
    // ...and a prior never moves them onto the autonomy axis
    expect(metrics.attribution.modes.agent).toBe(0);
  });
});

describe('automated commits stay off the autonomy axis (#25/#39)', () => {
  // Found by dogfooding the two-axis report on this repo: 37 merge/bot
  // commits carry `mode: 'none'`, and the headline table counted them as
  // hand-written — while the per-mode cohorts, which excluded automation,
  // showed none. Two tables in one report disagreeing about the same commits.
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
  });

  // The honesty property, in its 2.0 form: "assume everything is AI" must
  // never become "trust the assumption". Up to 1.x a prior could still move
  // commits into cohorts, and every report had to label which numbers it
  // touched. With the cohorts gone it moves nothing: a repository setting is
  // not a statement about any past commit. Only the recorded setting differs.
  it('is identical with and without a defaultMode prior, except the recorded setting', () => {
    const commits = [
      makeCommit({ hash: 'a1', tags: aiTags }),
      makeCommit({ hash: 'u1', tags: unknownTags }),
      makeCommit({ hash: 'u2', tags: unknownTags }),
    ];

    const withoutPrior = calculateMetrics(makeStream(commits));
    const withPrior = calculateMetrics(makeStream(commits), { defaultMode: 'agent' });

    expect(withPrior.attribution.defaultMode).toBe('agent');
    expect(withoutPrior.attribution.defaultMode).toBeNull();
    expect({ ...withPrior, attribution: { ...withPrior.attribution, defaultMode: null } }).toEqual(
      withoutPrior
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

describe('observation end (window.observationEnd)', () => {
  it('is the --until bound when earlier than the collection time, and every elapsed-time metric uses it', () => {
    const stream: CommitStream = {
      ...makeStream([
        makeCommit({
          hash: 'a1',
          tags: aiTags,
          authorDate: '2026-01-01T10:00:00.000Z',
          committerDate: '2026-01-01T10:00:00.000Z',
          stats: { totalAdditions: 1, totalDeletions: 0, files: [{ path: 'f.ts', additions: 1, deletions: 0 }] },
        }),
      ]),
      generatedAt: '2026-09-18T00:00:00.000Z',
      until: '2026-01-02T00:00:00.000Z',
    };
    const metrics = calculateMetrics(stream);
    expect(metrics.window.observationEnd).toBe('2026-01-02T00:00:00.000Z');
    // generatedAt of the artifact is the observation end, not the wall clock
    expect(metrics.generatedAt).toBe('2026-01-02T00:00:00.000Z');
    const week = metrics.repo.persistence.rapidRetouch.find((r) => r.windowDays === 7)!;
    expect(week).toMatchObject({ eligible: 0, tooRecent: 1 });
    // the recent-coverage window is anchored to the bound too: the one commit is inside it
    expect(metrics.attribution.recent?.commitsTotal).toBe(1);
  });

  it('is the collection time when there is no bound', () => {
    const metrics = calculateMetrics(makeStream([makeCommit({ hash: 'a1', tags: aiTags })]));
    expect(metrics.window.observationEnd).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('aiModeUnknown', () => {
  it('counts AI commits whose evidence names a tool but no autonomy level', () => {
    const toolOnly: Commit['tags'] = { attribution: 'ai', automated: false, mode: 'unknown', evidence: 'inferred', level: 'explicit', sources: ['tool:copilot'] };
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags }), // mode agent
        makeCommit({ hash: 'a2', tags: toolOnly }),
        makeCommit({ hash: 'a3', tags: toolOnly }),
      ])
    );
    expect(metrics.attribution.ai).toBe(3);
    expect(metrics.attribution.coverage).toBe(1);
    expect(metrics.attribution.aiModeUnknown).toBe(2);
    expect(metrics.attribution.modes.unknown).toBe(2);
  });
});

describe('attribution.sessions', () => {
  // The report prints "N of the M AI commits link to an agent session". If a
  // session on a non-AI commit counted, N could include commits M does not,
  // and the sentence would compare two different sets.
  it('counts AI commits with a session, and distinct sessions, never other commits', () => {
    const session = (id: string) => ({ agent: 'claude-code', id });
    const human: Commit['tags'] = { attribution: 'human', automated: false, mode: 'none', evidence: 'declared', level: 'none', sources: ['trailer:AI-Mode'] };
    const metrics = calculateMetrics(
      makeStream([
        makeCommit({ hash: 'a1', tags: aiTags, session: session('s1') }),
        makeCommit({ hash: 'a2', tags: aiTags, session: session('s1') }),
        makeCommit({ hash: 'a3', tags: aiTags, session: session('s2') }),
        makeCommit({ hash: 'a4', tags: aiTags }),
        makeCommit({ hash: 'h1', tags: human, session: session('s3') }),
      ])
    );
    expect(metrics.attribution.sessions).toEqual({ linked: 3, distinct: 2 });
  });
});
