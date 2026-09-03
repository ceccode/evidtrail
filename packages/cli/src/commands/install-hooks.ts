import { Command } from 'commander';
import { createLogger, describeError } from '@evidtrail/core';
import { isGitRepository } from '../hooks/detect.js';
import { installAidaHook, uninstallAidaHook } from '../hooks/install.js';

export function createInstallHooksCommand(): Command {
  return new Command('install-hooks')
    .description(
      'Install a prepare-commit-msg hook that stamps the autonomy mode (AI-Mode trailer)'
    )
    .option('--repo <path>', 'Repository path', process.cwd())
    .option('--force', 'Overwrite an existing unrelated hook', false)
    .option('--uninstall', 'Remove the evidtrail hook block', false)
    .option(
      '--if-git',
      'Exit quietly when there is no git repository (for use in a package.json prepare script)',
      false
    )
    .option('--verbose', 'Verbose logging', false)
    .action(async (options) => {
      const logger = createLogger(Boolean(options.verbose));

      try {
        // `prepare` runs on every install, including the ones with no git to
        // hook into: tarball installs, `npm ci` in a container, a Docker
        // build context. Failing there would break unrelated installs for a
        // hook nobody asked for in that context (#75).
        if (options.ifGit && !(await isGitRepository(options.repo))) {
          logger.debug('No git repository here — skipping hook installation (--if-git).');
          return;
        }

        if (options.uninstall) {
          const result = await uninstallAidaHook(options.repo);
          if (result.status === 'absent') logger.info('No evidtrail hook found: nothing to uninstall.');
          else if (result.status === 'removed') logger.info(`Removed ${result.hookPath}`);
          else logger.info(`Removed the evidtrail block from ${result.hookPath}, leaving the rest intact`);
          return;
        }

        const result = await installAidaHook(options.repo, { force: Boolean(options.force) });
        if (result.status === 'refused') {
          logger.error(
            `${result.hookPath} already exists and was not written by evidtrail.\n` +
              "Refusing to overwrite someone else's hook. Re-run with --force to replace it, " +
              'or add the AI-Mode trailer from your own hook.'
          );
          process.exit(1);
        }

        logger.info(
          result.status === 'unchanged'
            ? `Hook already installed at ${result.hookPath}`
            : `Installed ${result.hookPath}`
        );
        logger.info(
          'Commits will now carry an `AI-Mode:` trailer when the mode is known ' +
            '(EVIDTRAIL_MODE env var, a detected agent environment, or defaultMode in .evidtrail.json).'
        );
      } catch (error) {
        logger.error(`Hook installation failed: ${describeError(error)}`);
        process.exit(1);
      }
    });
}
