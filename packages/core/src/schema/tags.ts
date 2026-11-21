import { z } from 'zod';

// The autonomy levels a commit can state. `unknown` is not among them: it is
// what evidtrail records when nothing was stated.
export const DECLARABLE_MODES = ['none', 'autocomplete', 'assisted', 'agent'] as const;
export const DeclaredMode = z.enum(DECLARABLE_MODES);
export type DeclaredMode = z.infer<typeof DeclaredMode>;

export const AIMode = z.enum([...DECLARABLE_MODES, 'unknown']);
export type AIMode = z.infer<typeof AIMode>;

// Two orthogonal axes (#25). `mode` is what happened, `evidence` is how we
// know it; everything else here is derived from them. Commits and the
// commits of a pull request (#51) carry the same shape.
export const CommitTags = z.object({
  // PRIMARY AXIS — involvement. The question that still discriminates risk
  // once "was AI involved?" trends to yes everywhere.
  mode: AIMode,
  // PRIMARY AXIS — evidence. 'declared' = stated at commit time (AI-Mode
  // trailer, manifest); 'inferred' = derived from tool identity or
  // structure; 'none' = no signal, which is what `unknown` used to mean.
  evidence: z.enum(['declared', 'inferred', 'none']),
  // Automation with known provenance (#39): merge commits, release bots.
  // Orthogonal to the two axes — automation is not authored code, so it
  // stays off the autonomy axis regardless of what mode it would infer.
  automated: z.boolean(),
  // DERIVED — the three-state projection (#34), kept because a headline
  // needs one word. See `projectAttribution`: it is a view of the axes
  // above, never an independent judgement.
  attribution: z.enum(['ai', 'human', 'automated', 'unknown']),
  // DERIVED — strength of the message heuristic that fired, if any
  level: z.enum(['explicit', 'implicit', 'mention', 'none']),
  sources: z.array(z.string()), // which heuristic matched
});
export type CommitTags = z.infer<typeof CommitTags>;
