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
import { createRunCommand } from './commands/run.js';
import { createVerifyCommand } from './commands/verify.js';
import { createTrailCommand } from './commands/trail.js';

// Report the real package version: a hardcoded '0.0.0' left users unable to
// tell which build they were running.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const program = new Command();

program
  .name('evidtrail')
  .description('AI provenance for git: declared at commit time, checked in CI, traceable to the agent session')
  .version(version);

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
program.addCommand(createVerifyCommand());
program.addCommand(createTrailCommand());
// Default subcommand: `evidtrail --since 90d` runs the pipeline. See run.ts for why
// this is a subcommand and not root options.
program.addCommand(createRunCommand(), { isDefault: true });

program.parse();
