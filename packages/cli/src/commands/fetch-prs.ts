import { Command } from 'commander';
import { createLogger, describeError, parseRelativeDate, writeJSON } from '@evidtrail/core';
import { join } from 'path';
import { fetchClosedPRs } from '../providers/github-prs.js';
import { loadAidaConfig } from '../config/load.js';

// `evidtrail fetch-prs` (#51) is explicitly networked. Collection, analysis,
// blame, and report generation remain local; `evidtrail comment` is the other
// network command.

function detectRepo(explicit?: string): string | null {
  return explicit || process.env.GITHUB_REPOSITORY || null;
}

export function createFetchPRsCommand(): Command {
  return new Command('fetch-prs')
    .description('Fetch pull request outcomes from the forge API (opt-in, requires a token)')
    .option('--repo <path>', 'Repository path (for .evidtrail.json)', process.cwd())
    .option('--github-repo <owner/name>', 'GitHub repository (default: $GITHUB_REPOSITORY)')
    .option('--since <date>', 'Only PRs closed after this date (ISO or relative like 90d)')
    .option('--max-prs <n>', 'Stop after this many PRs (bounds API usage)')
    .option('--out-dir <path>', 'Output directory', './evidtrail-output')
    .option('--verbose', 'Verbose logging', false)
    .action(async (options) => {
      const logger = createLogger(Boolean(options.verbose));

      try {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          logger.error(
            'GITHUB_TOKEN is required. Export a token with `repo` (or public_repo) scope.\n' +
              'PR acceptance stays unavailable without it — every other evidtrail command works offline.'
          );
          process.exit(1);
        }

        const githubRepo = detectRepo(options.githubRepo);
        if (!githubRepo) {
          logger.error(
            'Could not determine the GitHub repository. Pass --github-repo <owner/name> or set GITHUB_REPOSITORY.'
          );
          process.exit(1);
        }

        const fileConfig = await loadAidaConfig(options.repo);
        const maxPRs = options.maxPrs ? Number(options.maxPrs) : undefined;
        if (maxPRs !== undefined && (!Number.isInteger(maxPRs) || maxPRs <= 0)) {
          throw new Error(`Invalid --max-prs "${options.maxPrs}": expected a positive integer`);
        }

        logger.info(`Fetching closed PRs from ${githubRepo}...`);

        const prStream = await fetchClosedPRs({
          repo: githubRepo,
          token,
          since: options.since ? parseRelativeDate(options.since) : undefined,
          maxPRs,
          aiPatterns: fileConfig.patterns,
          aiTools: fileConfig.tools,
          aiTrailerDomains: fileConfig.trailerDomains,
          aiBotBlocklist: fileConfig.botBlocklist,
          logger,
        });

        const outputPath = join(options.outDir, 'pr-stream.json');
        await writeJSON(outputPath, prStream);

        const merged = prStream.prs.filter((pr) => pr.state === 'merged').length;
        logger.info(
          `Collected ${prStream.prs.length} closed PR(s): ${merged} merged, ${prStream.prs.length - merged} closed unmerged`
        );
        if (prStream.truncated) {
          logger.warn(`Stopped at --max-prs: this is a sample, not the full history.`);
        }
        logger.info(`Output written to: ${outputPath}`);
      } catch (error) {
        logger.error(
          `PR fetch failed: ${describeError(error)}`
        );
        process.exit(1);
      }
    });
}
