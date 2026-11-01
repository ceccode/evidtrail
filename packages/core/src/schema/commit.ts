import { z } from 'zod';

export const FileChange = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']).optional(), // best-effort
  // Set on a rename: the name the file had before this commit. Lets a
  // consumer that tracks files over time carry a file's history across
  // the move instead of starting a new one under the new name.
  previousPath: z.string().optional(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const Commit = z.object({
  hash: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  authorDate: z.string().datetime(), // ISO
  committerName: z.string(),
  committerEmail: z.string(),
  committerDate: z.string().datetime(),
  message: z.string(),
  parents: z.array(z.string()),
  inDefaultBranchAncestry: z.boolean(), // set during collect
  // Target of a `git revert` (#26), parsed from the full commit body at
  // collect time ("This reverts commit <sha>."). Null for non-revert
  // commits, or when the target isn't in the standard git-generated form.
  revertsCommit: z.string().nullable().default(null),
  // Two orthogonal axes (#25). `mode` is what happened, `evidence` is how we
  // know it; everything else here is derived from them.
  tags: z.object({
    // PRIMARY AXIS — involvement. The question that still discriminates risk
    // once "was AI involved?" trends to yes everywhere.
    mode: z.enum(['none', 'autocomplete', 'assisted', 'agent', 'unknown']),
    // PRIMARY AXIS — evidence. 'declared' = stated at commit time (AI-Mode
    // trailer, manifest); 'inferred' = derived from tool identity or
    // structure; 'none' = no signal, which is what `unknown` used to mean.
    evidence: z.enum(['declared', 'inferred', 'none']),
    // Automation with known provenance (#39): merge commits, release bots.
    // Orthogonal to the two axes — automation is not authored code, so it
    // joins no autonomy cohort regardless of what mode it would infer.
    automated: z.boolean(),
    // DERIVED — the three-state projection (#34), kept because a headline
    // needs one word. See `projectAttribution`: it is a view of the axes
    // above, never an independent judgement.
    attribution: z.enum(['ai', 'human', 'automated', 'unknown']),
    // DERIVED — strength of the message heuristic that fired, if any
    level: z.enum(['explicit', 'implicit', 'mention', 'none']),
    sources: z.array(z.string()), // which heuristic matched
  }),
  // `AI-Session: <agent>/<id>` (opt-in, written by the hook): the agent
  // session that produced this commit. Absent on most commits.
  session: z.object({ agent: z.string(), id: z.string() }).optional(),
  stats: z.object({
    totalAdditions: z.number().int().nonnegative(),
    totalDeletions: z.number().int().nonnegative(),
    files: z.array(FileChange),
  }),
});

export type Commit = z.infer<typeof Commit>;

export const CommitStream = z.object({
  // Bumped when a field is removed or changes meaning (#53)
  schemaVersion: z.number().int().positive(),
  repoPath: z.string(),
  defaultBranch: z.string(),
  // v3: the universe of commits is part of the data contract. A default
  // report describes what is reachable from the integration branch; all
  // refs is an explicit exploratory scope, never an invisible default.
  scope: z.enum(['default-branch', 'all-refs', 'pr']),
  // Commit checked out/analyzed when the stream was produced. Optional
  // artifacts such as blame must refer to the same snapshot.
  headSha: z.string(),
  generatedAt: z.string().datetime(),
  since: z.string().optional(),
  until: z.string().optional(),
  aiPatterns: z.array(z.string()),
  // Newest-first topological order. Consumers reverse this array when they
  // need the first subsequent event; timestamps never define graph order.
  commits: z.array(Commit),
});

export type CommitStream = z.infer<typeof CommitStream>;
