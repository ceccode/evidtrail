import { Command } from 'commander';
import { createLogger, describeError } from '@aida-dev/core';
import { join } from 'path';
import { promises as fs } from 'fs';
import { CLIConfig } from '../schema/config.js';
import { detectProvider } from '../providers/detect.js';

export function createCommentCommand(): Command {
  return new Command('comment')
    .description('Post AIDA report as a PR/MR comment (auto-detects CI provider)')
    .option('--out-dir <path>', 'Output directory', './aida-output')
    .option('--verbose', 'Verbose logging', false)
    .option('--dry-run', 'Print comment to stdout instead of posting', false)
    .action(async (options) => {
      const config = CLIConfig.parse(options);
      const logger = createLogger(config.verbose);

      try {
        const reportPath = join(config.outDir, 'report.md');
        let content: string;

        try {
          content = await fs.readFile(reportPath, 'utf-8');
        } catch {
          logger.error(`Report not found at ${reportPath}. Run 'aida report' first.`);
          process.exit(1);
        }

        // Dry run — just print to stdout
        if (options.dryRun) {
          logger.info('Dry run — printing report to stdout:');
          console.log(content);
          return;
        }

        // Detect CI provider
        const provider = detectProvider();
        if (!provider) {
          logger.error(
            'Could not detect CI provider. Supported: GitHub Actions and GitLab CI.\n' +
              'Use --dry-run to print the report to stdout instead.'
          );
          process.exit(1);
        }

        logger.info(`Detected CI provider: ${provider.name}`);

        const pr = provider.getPRIdentifier();
        if (!pr) {
          logger.error(
            'Could not determine PR/MR number. Is this running on a pull_request event?'
          );
          process.exit(1);
        }

        logger.info(`Posting comment to ${provider.name} PR #${pr.prNumber}...`);
        await provider.postComment(content);
        logger.info('AIDA report posted as PR comment');
      } catch (error) {
        logger.error(
          `Comment failed: ${describeError(error)}`
        );
        process.exit(1);
      }
    });
}
