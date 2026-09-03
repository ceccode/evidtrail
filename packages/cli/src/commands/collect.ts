import { Command } from 'commander';
import { collectCommits, writeJSON, createLogger, describeError } from '@evidtrail/core';
import { join } from 'path';
import { CLIConfig } from '../schema/config.js';
import { detectPRBaseRef } from '../providers/pr-base.js';
import { loadAidaConfig } from '../config/load.js';

function collectRepeatable(value: string, previous: string[]): string[] {
  return previous ? [...previous, value] : [value];
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
        // Load .evidtrail.json config (merge with CLI flags)
        const fileConfig = await loadAidaConfig(config.repo, logger);
        const aiPatterns = [...(fileConfig.patterns || []), ...config.aiPatterns];
        const aiTools = [...(fileConfig.tools || []), ...config.aiTools];
        const aiTrailerDomains = [...(fileConfig.trailerDomains || []), ...config.aiTrailerDomains];
        const aiBotBlocklist = [...(fileConfig.botBlocklist || []), ...config.aiBotBlocklist];

        if (aiTools.length > 0) logger.info(`Custom AI tools: ${aiTools.join(', ')}`);
        if (aiTrailerDomains.length > 0) logger.info(`Custom trailer domains: ${aiTrailerDomains.join(', ')}`);
        if (aiBotBlocklist.length > 0) logger.info(`Custom bot blocklist: ${aiBotBlocklist.join(', ')}`);

        // Determine diffBase for PR-scoped analysis
        let diffBase: string | undefined = options.diffBase;
        if (options.pr && !diffBase) {
          diffBase = detectPRBaseRef() ?? undefined;
          if (diffBase) {
            logger.info(`PR mode: detected base ref ${diffBase}`);
          } else {
            logger.warn('--pr flag used but no PR context detected. Falling back to --since mode.');
          }
        }
        if (diffBase && config.scope !== 'default-branch') {
          throw new Error('--scope all-refs cannot be combined with --pr or --diff-base');
        }

        logger.info('Starting commit collection...');

        const commitStream = await collectCommits({
          repoPath: config.repo,
          since: diffBase ? undefined : config.since,
          until: diffBase ? undefined : config.until,
          diffBase,
          aiPatterns,
          aiTools,
          aiTrailerDomains,
          aiBotBlocklist,
          defaultBranch: config.defaultBranch,
          scope: config.scope,
          // CLI flag wins over .evidtrail.json
          redactAuthors: config.redactAuthors ?? fileConfig.redactAuthors ?? false,
          logger,
        });

        const outputPath = join(config.outDir, 'commit-stream.json');
        await writeJSON(outputPath, commitStream);

        logger.info(`Collected ${commitStream.commits.length} commits`);
        const counts = { ai: 0, human: 0, automated: 0, unknown: 0 };
        for (const c of commitStream.commits) counts[c.tags.attribution]++;
        logger.info(
          `Attribution: ai ${counts.ai} · human ${counts.human} · automated ${counts.automated} · unknown ${counts.unknown}`
        );
        logger.info(`Output written to: ${outputPath}`);
      } catch (error) {
        logger.error(
          `Collection failed: ${describeError(error)}`
        );
        process.exit(1);
      }
    });
}
