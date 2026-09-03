import { PRStream, PullRequest } from '@evidtrail/core';
import { AcceptanceStats, PRAcceptance } from './schema/metrics.js';

// PR acceptance (#51): the successor to merge ratio. Unlike git history, a
// forge keeps closed-unmerged PRs, so the negative outcome is observable.

// A PR's attribution is the strongest AI signal among its commits: if any
// commit is AI-attributed, AI participated in that PR. Automated commits
// (merge commits inside the branch) are ignored — they are not authored work.
export function prAttribution(pr: PullRequest): 'ai' | 'human' | 'unknown' {
  if (!pr.commitsComplete) return 'unknown';
  const authored = pr.commits.filter((c) => c.tags.attribution !== 'automated');
  if (authored.length === 0) return 'unknown';
  if (authored.some((c) => c.tags.attribution === 'ai')) return 'ai';
  if (authored.every((c) => c.tags.attribution === 'human')) return 'human';
  return 'unknown';
}

const MODE_RANK = { agent: 4, assisted: 3, autocomplete: 2, none: 1, unknown: 0 } as const;
type Mode = keyof typeof MODE_RANK;

// A PR's mode is the highest autonomy level present in it: the riskiest kind
// of participation is what characterizes the change.
export function prMode(pr: PullRequest): Mode {
  if (!pr.commitsComplete) return 'unknown';
  const authored = pr.commits.filter((c) => c.tags.attribution !== 'automated');
  return authored.reduce<Mode>(
    (highest, c) => (MODE_RANK[c.tags.mode] > MODE_RANK[highest] ? c.tags.mode : highest),
    'unknown'
  );
}

function stats(prs: PullRequest[]): AcceptanceStats | null {
  if (prs.length === 0) return null;
  const merged = prs.filter((pr) => pr.state === 'merged').length;
  return {
    total: prs.length,
    merged,
    closed: prs.length - merged,
    acceptanceRate: Math.round((merged / prs.length) * 10000) / 10000,
  };
}

export function calculatePRAcceptance(prStream: PRStream): PRAcceptance {
  const { prs } = prStream;

  const byAttribution = {
    ai: stats(prs.filter((pr) => prAttribution(pr) === 'ai')),
    human: stats(prs.filter((pr) => prAttribution(pr) === 'human')),
    unknown: stats(prs.filter((pr) => prAttribution(pr) === 'unknown')),
  };

  const byMode = {
    agent: stats(prs.filter((pr) => prMode(pr) === 'agent')),
    assisted: stats(prs.filter((pr) => prMode(pr) === 'assisted')),
    autocomplete: stats(prs.filter((pr) => prMode(pr) === 'autocomplete')),
    none: stats(prs.filter((pr) => prMode(pr) === 'none')),
    unknown: stats(prs.filter((pr) => prMode(pr) === 'unknown')),
  };

  return {
    provider: prStream.provider,
    repo: prStream.repo,
    fetchedAt: prStream.fetchedAt,
    truncated: prStream.truncated,
    overall: stats(prs) ?? { total: 0, merged: 0, closed: 0, acceptanceRate: 0 },
    byAttribution,
    byMode,
  };
}
