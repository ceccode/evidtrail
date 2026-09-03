import { describe, it, expect } from 'vitest';
import { PRCommit, PRStream, PullRequest } from '@evidtrail/core';
import { calculatePRAcceptance, prAttribution, prMode } from './pr-acceptance.js';

function commit(
  attribution: PRCommit['tags']['attribution'],
  mode: PRCommit['tags']['mode'] = 'unknown'
): PRCommit {
  return {
    sha: 'a'.repeat(40),
    tags: {
      attribution,
      automated: attribution === 'automated',
      mode,
      evidence: mode === 'unknown' ? 'none' : 'inferred',
      level: attribution === 'ai' ? 'explicit' : 'none',
      sources: [],
    },
  };
}

function pr(number: number, state: 'merged' | 'closed', commits: PRCommit[]): PullRequest {
  return {
    number,
    state,
    createdAt: '2026-01-01T00:00:00.000Z',
    closedAt: '2026-01-02T00:00:00.000Z',
    mergedAt: state === 'merged' ? '2026-01-02T00:00:00.000Z' : null,
    commits,
    commitsComplete: true,
  };
}

function stream(prs: PullRequest[], truncated = false): PRStream {
  return {
    schemaVersion: 2,
    provider: 'github',
    repo: 'owner/name',
    fetchedAt: '2026-01-03T00:00:00.000Z',
    truncated,
    prs,
  };
}

describe('prAttribution', () => {
  it('is ai when any authored commit is ai', () => {
    expect(prAttribution(pr(1, 'merged', [commit('human'), commit('ai')]))).toBe('ai');
  });

  it('is human only when every authored commit is human', () => {
    expect(prAttribution(pr(1, 'merged', [commit('human'), commit('human')]))).toBe('human');
    expect(prAttribution(pr(1, 'merged', [commit('human'), commit('unknown')]))).toBe('unknown');
  });

  it('ignores automated commits when deciding', () => {
    expect(prAttribution(pr(1, 'merged', [commit('automated'), commit('human')]))).toBe('human');
  });

  it('is unknown for a PR of only automated commits', () => {
    expect(prAttribution(pr(1, 'merged', [commit('automated')]))).toBe('unknown');
  });
});

describe('prMode', () => {
  it('takes the highest autonomy present — the riskiest participation', () => {
    expect(prMode(pr(1, 'merged', [commit('ai', 'autocomplete'), commit('ai', 'agent')]))).toBe(
      'agent'
    );
    expect(prMode(pr(1, 'merged', [commit('ai', 'assisted'), commit('human', 'none')]))).toBe(
      'assisted'
    );
  });

  it('is unknown for an empty or automated-only PR', () => {
    expect(prMode(pr(1, 'merged', [commit('automated', 'none')]))).toBe('unknown');
  });
});

describe('calculatePRAcceptance', () => {
  it('computes acceptance overall and per cohort, null for empty cohorts', () => {
    const result = calculatePRAcceptance(
      stream([
        pr(1, 'merged', [commit('ai', 'agent')]),
        pr(2, 'merged', [commit('ai', 'agent')]),
        pr(3, 'closed', [commit('ai', 'agent')]),
        pr(4, 'merged', [commit('human', 'none')]),
      ])
    );

    expect(result.overall).toEqual({ total: 4, merged: 3, closed: 1, acceptanceRate: 0.75 });
    expect(result.byAttribution.ai).toEqual({
      total: 3,
      merged: 2,
      closed: 1,
      acceptanceRate: 0.6667,
    });
    expect(result.byAttribution.human?.acceptanceRate).toBe(1);
    expect(result.byAttribution.unknown).toBeNull();
    expect(result.byMode.agent?.total).toBe(3);
    expect(result.byMode.assisted).toBeNull();
  });

  it('counts closed-unmerged PRs — the outcome git history destroys', () => {
    const result = calculatePRAcceptance(
      stream([pr(1, 'closed', [commit('ai')]), pr(2, 'closed', [commit('ai')])])
    );
    expect(result.byAttribution.ai).toEqual({
      total: 2,
      merged: 0,
      closed: 2,
      acceptanceRate: 0,
    });
  });

  it('carries provenance and the truncation flag through', () => {
    const result = calculatePRAcceptance(stream([pr(1, 'merged', [commit('ai')])], true));
    expect(result.provider).toBe('github');
    expect(result.repo).toBe('owner/name');
    expect(result.truncated).toBe(true);
  });

  it('handles an empty PR stream without inventing a rate', () => {
    const result = calculatePRAcceptance(stream([]));
    expect(result.overall.total).toBe(0);
    expect(result.byAttribution.ai).toBeNull();
  });
});
