import { z } from 'zod';

// Line-level blame data (#23). Produced by `evidtrail blame`, consumed by
// `evidtrail analyze` when present.
//
// Kept in its own file — and behind its own command — because blame runs one
// git process per file and is by far the most expensive thing evidtrail does.
// `collect` stays fast; line-level analysis is an explicit opt-in step.
// v2 adds `blamedPaths`: the survival rate divides surviving AI lines by AI
// lines added, and without the file list those two numbers were measured
// over different file sets (see line-survival.ts).
// v3 binds blame output to the exact HEAD it describes, so analyze cannot
// silently join living lines from one checkout with commits from another.
export const BLAME_STREAM_SCHEMA_VERSION = 3;

export const BlameStream = z.object({
  schemaVersion: z.number().int().positive(),
  repoPath: z.string(),
  headSha: z.string(),
  generatedAt: z.string().datetime(),
  filesBlamed: z.number().int().nonnegative(),
  // Binary or empty paths: skipped rather than failing the run
  filesSkipped: z.number().int().nonnegative(),
  // Paths where `git blame` itself errored (submodule, missing object,
  // output past maxBuffer). Counted apart from `filesSkipped` so a broken
  // run cannot pass for a clean one with a few binaries in it.
  filesFailed: z.number().int().nonnegative(),
  // Excluded by the caller's filter (lockfiles, generated output)
  filesExcluded: z.number().int().nonnegative(),
  // True when --max-files capped the walk: the sample is partial
  truncated: z.boolean(),
  totalLines: z.number().int().nonnegative(),
  // commit sha → lines in HEAD last written by that commit. Compact: one
  // entry per commit with surviving lines, not one per line.
  linesBySha: z.record(z.string(), z.number().int().nonnegative()),
  // The files actually blamed. Carried so a consumer can scope the
  // denominator of any survival rate to the same files the numerator came
  // from — with --max-files, or with generated files excluded, "lines alive"
  // and "lines added" otherwise describe different halves of the repo.
  blamedPaths: z.array(z.string()),
});

export type BlameStream = z.infer<typeof BlameStream>;
