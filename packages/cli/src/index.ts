#!/usr/bin/env node

import { Command } from 'commander';
import { createRequire } from 'module';
import { createCollectCommand } from './commands/collect.js';
import { createBlameCommand } from './commands/blame.js';
import { createInstallHooksCommand } from './commands/install-hooks.js';
import { createFetchPRsCommand } from './commands/fetch-prs.js';
import { createAnalyzeCommand } from './commands/analyze.js';
import { createReportCommand } from './commands/report.js';
import { createCommentCommand } from './commands/comment.js';
import { createInitCommand } from './commands/init.js';
import { createDoctorCommand } from './commands/doctor.js';

// Report the real package version: a hardcoded '0.0.0' left users unable to
// tell which build they were running.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const program = new Command();

program
  .name('aida')
  .description('AIDA (AI Development Accounting) - Metrics for AI-assisted development')
  .version(version)
  // `aida` with no subcommand runs the whole pipeline. collect → analyze →
  // report is plumbing; a first-time user should not have to learn it to
  // get a report. The granular commands stay for CI and for anyone who
  // wants one stage at a time.
  .option('--repo <path>', 'Repository path', process.cwd())
  .option('--since <date>', 'Start date (ISO or relative like 90d)')
  .option('--out-dir <path>', 'Output directory', './aida-output')
  .option('--verbose', 'Verbose logging', false)
  .action(async (options: { repo: string; since?: string; outDir: string; verbose: boolean }) => {
    const common = ['--out-dir', options.outDir, ...(options.verbose ? ['--verbose'] : [])];
    const collectArgs = ['--repo', options.repo, ...common, ...(options.since ? ['--since', options.since] : [])];
    await createCollectCommand().parseAsync(collectArgs, { from: 'user' });
    await createAnalyzeCommand().parseAsync(common, { from: 'user' });
    await createReportCommand().parseAsync(common, { from: 'user' });
  });

// Add commands
program.addCommand(createCollectCommand());
program.addCommand(createBlameCommand());
program.addCommand(createInstallHooksCommand());
program.addCommand(createFetchPRsCommand());
program.addCommand(createAnalyzeCommand());
program.addCommand(createReportCommand());
program.addCommand(createCommentCommand());
program.addCommand(createInitCommand());
program.addCommand(createDoctorCommand());

program.parse();
