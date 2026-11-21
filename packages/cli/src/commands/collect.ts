import { Command } from 'commander';
import {
  type CollectOptions,
  type CommitStream,
  type EvidtrailConfig,
  type Logger,
  collectCommits,
  writeJSON,
  createLogger,
  describeError,
} from '@evidtrail/core';
import { join } from 'path';
import { CLIConfig } from '../schema/config.js';
import { detectPRBaseRef } from '../providers/pr-base.js';
import { loadConfig } from '../config/load.js';

function collectRepeatable(value: string, previous: string[]): string[] {
  return previous ? [...previous, value] : [value];
}

type DetectionLists = Required<
  Pick<CollectOptions, 'aiPatterns' | 'aiTools' | 'aiTrailerDomains' | 'aiBotBlocklist'>
>;

// Flags add to the lists in .evidtrail.json; they never replace them.
export function detectionListsFrom(config: CLIConfig, fileConfig: Partial<EvidtrailConfig>): DetectionLists {
  return {
    aiPatterns: [...(fileConfig.patterns || []), ...config.aiPatterns],
    aiTools: [...(fileConfig.tools || []), ...config.aiTools],
    aiTrailerDomains: [...(fileConfig.trailerDomains || []), ...config.aiTrailerDomains],
    aiBotBlocklist: [...(fileConfig.botBlocklist || []), ...config.aiBotBlocklist],
  };
}

function logCustomLists(lists: DetectionLists, logger: Logger): void {
  if (lists.aiTools.length > 0) logger.info(`Custom AI tools: ${lists.aiTools.join(', ')}`);
  if (lists.aiTrailerDomains.length > 0) logger.info(`Custom trailer domains: ${lists.aiTrailerDomains.join(', ')}`);
  if (lists.aiBotBlocklist.length > 0) logger.info(`Custom bot blocklist: ${lists.aiBotBlocklist.join(', ')}`);
}

// --diff-base names the base; --pr asks CI for it, and says so when CI has none.
function resolveDiffBase(flags: CollectFlags, logger: Logger): string | undefined {
  if (flags.diffBase || !flags.pr) return flags.diffBase;
  const detected = detectPRBaseRef();
  if (detected) {
    logger.info(`PR mode: detected base ref ${detected}`);
    return detected;
  }
  logger.warn('--pr flag used but no PR context detected. Falling back to --since mode.');
  return undefined;
}

export function attributionSummary(stream: CommitStream): string {
  const counts = { ai: 0, human: 0, automated: 0, unknown: 0 };
  for (const commit of stream.commits) counts[commit.tags.attribution]++;
  return `Attribution: ai ${counts.ai} · human ${counts.human} · automated ${counts.automated} · unknown ${counts.unknown}`;
}

export interface CollectFlags {
  pr?: boolean;
  diffBase?: string;
}

export async function runCollect(config: CLIConfig, flags: CollectFlags, logger: Logger): Promise<void> {
  const fileConfig = await loadConfig(config.repo);
  const lists = detectionListsFrom(config, fileConfig);
  logCustomLists(lists, logger);

  const diffBase = resolveDiffBase(flags, logger);
  if (diffBase && config.scope !== 'default-branch') {
    throw new Error('--scope all-refs cannot be combined with --pr or --diff-base');
  }

  logger.info('Starting commit collection...');
  const commitStream = await collectCommits({
    repoPath: config.repo,
    // A PR range is defined by its base, not by dates
    since: diffBase ? undefined : config.since,
    until: diffBase ? undefined : config.until,
    diffBase,
    ...lists,
    defaultBranch: config.defaultBranch,
    scope: config.scope,
    // CLI flag wins over .evidtrail.json
    redactAuthors: config.redactAuthors ?? fileConfig.redactAuthors ?? false,
    logger,
  });

  const outputPath = join(config.outDir, 'commit-stream.json');
  await writeJSON(outputPath, commitStream);
  logger.info(`Collected ${commitStream.commits.length} commits`);
  logger.info(attributionSummary(commitStream));
  logger.info(`Output written to: ${outputPath}`);
}

export function createCollectCommand(): Command {
  return new Command('collect')
    .description('Collect commits and generate commit-stream.json')
    .option('--repo <path>', 'Repository path', process.cwd())
    .option('--since <date>', 'Start date (ISO or relative like 90d)')
    .option('--until <date>', 'End date (ISO or relative)')
    .option('--pr', 'PR-scoped analysis (auto-detect base ref from CI env vars)')
    .option('--diff-base <ref>', 'Explicit base ref for PR-scoped analysis (e.g., origin/main)')
    .option('--ai-pattern <pattern>', 'AI detection regex (repeatable)', collectRepeatable, [])
    .option('--ai-tool <name>', 'Additional AI tool name (repeatable)', collectRepeatable, [])
    .option('--ai-trailer-domain <domain>', 'Additional Co-authored-by domain (repeatable)', collectRepeatable, [])
    .option('--ai-bot-blocklist <name>', 'Non-AI bot to exclude from trailer matching (repeatable)', collectRepeatable, [])
    .option('--default-branch <name>', 'Default branch name')
    .option(
      '--scope <value>',
      'Commit universe: default-branch | all-refs (default: default-branch)',
      'default-branch'
    )
    .option(
      '--redact-authors',
      'Replace author/committer identities with a per-run salted hash (recommended in CI)'
    )
    .option('--out-dir <path>', 'Output directory', './evidtrail-output')
    .option('--verbose', 'Verbose logging', false)
    .action(async (options) => {
      // Commander uses singular camelCase (--ai-tool → aiTool), schema uses plural
      const mapped = {
        ...options,
        aiPatterns: options.aiPattern || [],
        aiTools: options.aiTool || [],
        aiTrailerDomains: options.aiTrailerDomain || [],
        aiBotBlocklist: options.aiBotBlocklist || [],
      };
      const config = CLIConfig.parse(mapped);
      const logger = createLogger(config.verbose);

      try {
        await runCollect(config, { pr: options.pr, diffBase: options.diffBase }, logger);
      } catch (error) {
        logger.error(
          `Collection failed: ${describeError(error)}`
        );
        process.exit(1);
      }
    });
}
