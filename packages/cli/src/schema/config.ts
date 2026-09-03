import { z } from 'zod';

export const CLIConfig = z.object({
  repo: z.string().default(process.cwd()),
  since: z.string().optional(),
  until: z.string().optional(),
  aiPatterns: z.array(z.string()).default([]),
  aiTools: z.array(z.string()).default([]),
  aiTrailerDomains: z.array(z.string()).default([]),
  aiBotBlocklist: z.array(z.string()).default([]),
  defaultBranch: z.string().optional(),
  scope: z.enum(['default-branch', 'all-refs']).default('default-branch'),
  redactAuthors: z.boolean().optional(),
  outDir: z.string().default('./evidtrail-output'),
  verbose: z.boolean().default(false),
});

export type CLIConfig = z.infer<typeof CLIConfig>;
