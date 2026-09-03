import { Command } from 'commander';
import { collectBlame, createLogger, describeError, writeJSON } from '@evidtrail/core';
import { categorizeFile } from '@evidtrail/metrics';
import { join } from 'path';

// `evidtrail blame` (#23) — line-level attribution, in its own command because it
// runs one git process per file and is the most expensive thing evidtrail does.
// `collect` stays fast; this is an explicit opt-in step, same shape as
// `fetch-prs`.

// Generated files (lockfiles, changelogs, build output) would dominate the
// line count while carrying no authorship signal — the same reasoning that
// excludes them from persistence.
const EXCLUDED_CATEGORIES = new Set(['generated']);

export function createBlameCommand(): Command {
  return new Command('blame')
    .description('Compute line-level attribution with git blame (slow, opt-in)')
    .option('--repo <path>', 'Repository path', process.cwd())
    .option('--ref <ref>', 'Git ref to blame (default: HEAD)', 'HEAD')
    .option('--max-files <n>', 'Stop after this many files (bounds runtime)')
    .option('--include-generated', 'Also blame lockfiles and generated output', false)
    .option('--out-dir <path>', 'Output directory', './evidtrail-output')
    .option('--verbose', 'Verbose logging', false)
    .action(async (options) => {
      const logger = createLogger(Boolean(options.verbose));

      try {
        const maxFiles = options.maxFiles ? Number(options.maxFiles) : undefined;
        if (maxFiles !== undefined && (!Number.isInteger(maxFiles) || maxFiles <= 0)) {
          throw new Error(`Invalid --max-files "${options.maxFiles}": expected a positive integer`);
        }

        logger.info('Running git blame over tracked files (this can take a while)...');

        const blameStream = await collectBlame({
          repoPath: options.repo,
          ref: options.ref,
          exclude: options.includeGenerated
            ? undefined
            : (path) => EXCLUDED_CATEGORIES.has(categorizeFile(path)),
          maxFiles,
          logger,
        });

        const outputPath = join(options.outDir, 'blame-stream.json');
        await writeJSON(outputPath, blameStream);

        logger.info(
          `Blamed ${blameStream.filesBlamed} file(s), ${blameStream.totalLines} lines ` +
            `(${blameStream.filesSkipped} skipped, ${blameStream.filesFailed} failed, ` +
            `${blameStream.filesExcluded} excluded)`
        );
        if (blameStream.truncated) {
          logger.warn(
            '--max-files capped the walk: this is an evenly spaced sample of the tree, not the whole tree.'
          );
        }
        logger.info(`Output written to: ${outputPath}`);
      } catch (error) {
        logger.error(`Blame failed: ${describeError(error)}`);
        process.exit(1);
      }
    });
}
