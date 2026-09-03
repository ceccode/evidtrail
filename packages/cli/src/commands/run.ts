import { Command } from 'commander';
import { createCollectCommand } from './collect.js';
import { createAnalyzeCommand } from './analyze.js';
import { createReportCommand } from './report.js';

// `evidtrail run` — the whole pipeline — and the default when no subcommand is
// given, so `evidtrail --since 90d` is enough to get a report. collect → analyze
// → report is plumbing a first-time user should not have to learn.
//
// It is a real subcommand marked `isDefault`, NOT options on the root
// program. The first version put --out-dir on the root, and commander
// accepts root options anywhere on the line: `evidtrail collect --out-dir ./.evidtrail`
// had its --out-dir eaten by the root, collect fell back to ./evidtrail-output,
// and CI could not find the report it had just written. Found by the
// workflow on this very PR; the dispatch test below now runs the built binary.
export function createRunCommand(): Command {
  return new Command('run')
    .description('Run the whole pipeline: collect → analyze → report (default when no subcommand is given)')
    .option('--repo <path>', 'Repository path', process.cwd())
    .option('--since <date>', 'Start date (ISO or relative like 90d)')
    .option('--out-dir <path>', 'Output directory', './evidtrail-output')
    .option('--verbose', 'Verbose logging', false)
    .action(async (options: { repo: string; since?: string; outDir: string; verbose: boolean }) => {
      const common = ['--out-dir', options.outDir, ...(options.verbose ? ['--verbose'] : [])];
      const collectArgs = [
        '--repo',
        options.repo,
        ...common,
        ...(options.since ? ['--since', options.since] : []),
      ];
      await createCollectCommand().parseAsync(collectArgs, { from: 'user' });
      await createAnalyzeCommand().parseAsync(common, { from: 'user' });
      await createReportCommand().parseAsync(common, { from: 'user' });
    });
}
