import { z } from 'zod';

export const EvidtrailConfig = z.object({
  tools: z.array(z.string()).default([]),
  trailerDomains: z.array(z.string()).default([]),
  botBlocklist: z.array(z.string()).default([]),
  patterns: z.array(z.string()).default([]),
  // Evidence coverage below this fraction flags all metrics as low-confidence.
  coverageThreshold: z.number().min(0).max(1).default(0.7),
  // The repo's autonomy mode when nothing else determines it (#25, #61).
  // One key, used at two moments:
  //   - at commit time, the hook stamps it as an `AI-Mode:` trailer, so the
  //     commit carries `evidence: declared` from then on;
  //   - at analysis time, it is recorded in `metrics.attribution.defaultMode`
  //     and applied to nothing: a repository setting is not a statement about
  //     any past commit, so history predating the hook stays `unknown`.
  // Absent means: leave unknown rather than guess.
  defaultMode: z.enum(['none', 'autocomplete', 'assisted', 'agent']).optional(),
  // Replace author/committer identities with a per-run salted hash (#35).
  // Recommended in CI, where commit-stream.json leaves the machine.
  redactAuthors: z.boolean().default(false),
}).strict();

export type EvidtrailConfig = z.infer<typeof EvidtrailConfig>;

// `defaultAttribution` was the prior on the axis #25 retired. Ignoring it
// would silently drop a setting the repository chose — the exact failure
// this project keeps finding. Refuse the file instead, with the translation
// in the message.
const RETIRED_TO_MODE: Record<string, string> = {
  ai: 'assisted', // or autocomplete/agent — only the repo knows which
  human: 'none',
  unknown: '(remove the key: no prior)',
};

export function assertNoRetiredConfigKeys(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || !('defaultAttribution' in raw)) return;

  const old = String((raw as { defaultAttribution: unknown }).defaultAttribution);
  const suggestion = RETIRED_TO_MODE[old] ?? 'assisted';
  throw new Error(
    `.evidtrail.json uses "defaultAttribution", which was replaced by "defaultMode" in schema v2 (#25): ` +
      `the prior now names an autonomy level, not an AI/human label. ` +
      `Replace "defaultAttribution": "${old}" with "defaultMode": "${suggestion}". ` +
      `evidtrail refuses the file rather than ignore a setting you chose.`
  );
}
