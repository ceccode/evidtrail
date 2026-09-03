import { z } from 'zod';

// Pull request stream (#51) — the successor data source to merge ratio.
//
// Git history cannot say whether work was accepted: squash merges erase
// branch commits and deleted branches erase abandoned work, so discarded
// outcomes vanish. Forge APIs keep them: a closed-unmerged PR is never
// deleted.
//
// Two deliberate constraints:
//   - **No author identity is ever stored.** evidtrail compares cohorts, never
//     people (#35). A PR record carries its number, terminal state, dates,
//     and the attribution of its commits — nothing that names anyone.
//   - **Attribution comes from the PR's own commit messages** as returned by
//     the API, not from a join against local git. That is what makes this
//     work for squash-merged PRs whose branches no longer exist.
export const PR_STREAM_SCHEMA_VERSION = 2;

export const PRCommit = z.object({
  sha: z.string(),
  // Same two-axis shape as a Commit's tags (#25)
  tags: z.object({
    mode: z.enum(['none', 'autocomplete', 'assisted', 'agent', 'unknown']),
    evidence: z.enum(['declared', 'inferred', 'none']),
    automated: z.boolean(),
    attribution: z.enum(['ai', 'human', 'automated', 'unknown']),
    level: z.enum(['explicit', 'implicit', 'mention', 'none']),
    sources: z.array(z.string()),
  }),
});

export const PullRequest = z.object({
  number: z.number().int().positive(),
  // Terminal states only: open and draft PRs have no outcome yet and are
  // excluded from both numerator and denominator.
  state: z.enum(['merged', 'closed']),
  createdAt: z.string().datetime(),
  closedAt: z.string().datetime(),
  mergedAt: z.string().datetime().nullable(),
  commits: z.array(PRCommit),
  // GitHub exposes at most 250 commits through this endpoint. Attribution
  // from an incomplete commit list must be labelled, never silently treated
  // as the whole PR.
  commitsComplete: z.boolean(),
});

export const PRStream = z.object({
  schemaVersion: z.number().int().positive(),
  provider: z.string(),
  repo: z.string(),
  fetchedAt: z.string().datetime(),
  since: z.string().optional(),
  // True when the fetch stopped at --max-prs: the sample is not the full
  // history and acceptance rates must be read as partial.
  truncated: z.boolean(),
  prs: z.array(PullRequest),
});

export type PRCommit = z.infer<typeof PRCommit>;
export type PullRequest = z.infer<typeof PullRequest>;
export type PRStream = z.infer<typeof PRStream>;
