import { Command } from 'commander';
import {
  type BlameStream,
  type CommitStream,
  type EvidtrailConfig,
  type Logger,
  type PRStream,
  writeJSON,
  createLogger,
  fileExists,
  describeError,
} from '@evidtrail/core';
import { calculateMetrics, type Metrics, type MetricsOptions } from '@evidtrail/metrics';
import { join, resolve } from 'path';
import { CLIConfig } from '../schema/config.js';
import { HOOK_NAME, isHookInstalled } from '../hooks/detect.js';
import { findConfigFile, loadConfig } from '../config/load.js';
import { readBlameStream, readCommitStream, readPRStream } from '../artifacts.js';

export interface AnalyzeFlags {
  coverageThreshold?: string;
  coverageWindow?: string;
  trendGranularity?: string;
  trendWindow?: string;
  trendPeriods?: string;
  hotfixWindow?: string;
}

function positiveInteger(flag: string, value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${flag} "${value}": expected a positive integer`);
  }
  return parsed;
}

// Flags override .evidtrail.json (read from the collected repo's root).
// `defaultMode` is only recorded: no number depends on it.
export function metricsOptionsFrom(
  flags: AnalyzeFlags,
  fileConfig: Partial<EvidtrailConfig>
): MetricsOptions {
  const coverageThreshold = flags.coverageThreshold
    ? Number(flags.coverageThreshold)
    : (fileConfig.coverageThreshold ?? 0.7);
  if (Number.isNaN(coverageThreshold) || coverageThreshold < 0 || coverageThreshold > 1) {
    throw new Error(
      `Invalid --coverage-threshold "${flags.coverageThreshold}": expected a fraction between 0 and 1`
    );
  }
  const coverageWindowDays = positiveInteger('coverage-window', flags.coverageWindow);
  const hotfixWindowDays = positiveInteger('hotfix-window', flags.hotfixWindow);
  const granularity = flags.trendGranularity ?? 'month';
  if (granularity !== 'month' && granularity !== 'quarter') {
    throw new Error(`Invalid --trend-granularity "${granularity}": expected month or quarter`);
  }
  return {
    defaultMode: fileConfig.defaultMode,
    coverageThreshold,
    coverageWindowDays,
    hotfixWindowDays,
    trend: {
      granularity,
      observationDays: positiveInteger('trend-window', flags.trendWindow),
      maxPeriods: positiveInteger('trend-periods', flags.trendPeriods),
    },
  };
}

// Blame describes one checkout. Analyzed against a stream from another
// repository or another HEAD, it would attribute lines to the wrong commits.
function assertSameSnapshot(blame: BlameStream, commits: CommitStream): void {
  if (resolve(blame.repoPath) !== resolve(commits.repoPath)) {
    throw new Error(
      'blame-stream.json belongs to a different repository. Remove it or rerun `evidtrail blame` for the collected repo.'
    );
  }
  if (blame.headSha !== commits.headSha) {
    throw new Error(
      `blame-stream.json describes ${blame.headSha.slice(0, 12)}, but commit-stream.json describes ${commits.headSha.slice(0, 12)}. Rerun collect and blame from the same checkout before analyzing.`
    );
  }
}

// Optional inputs: absent unless `evidtrail fetch-prs` (#51) or
// `evidtrail blame` (#23) ran. A missing file is the normal offline case.
async function readOptionalInputs(
  outDir: string,
  commitStream: CommitStream,
  logger: Logger
): Promise<{ prStream: PRStream | null; blameStream: BlameStream | null }> {
  let prStream: PRStream | null = null;
  const prStreamPath = join(outDir, 'pr-stream.json');
  if (await fileExists(prStreamPath)) {
    prStream = await readPRStream(prStreamPath);
    logger.info(`PR outcomes loaded: ${prStream.prs.length} closed PR(s)`);
  }

  let blameStream: BlameStream | null = null;
  const blamePath = join(outDir, 'blame-stream.json');
  if (await fileExists(blamePath)) {
    blameStream = await readBlameStream(blamePath);
    assertSameSnapshot(blameStream, commitStream);
    logger.info(`Blame data loaded: ${blameStream.totalLines} lines`);
  }
  return { prStream, blameStream };
}

export interface CloneSetup {
  // The repository carries .evidtrail.json
  configured: boolean;
  // This clone has the commit hook
  hooked: boolean;
}

// A hook is per-clone state while `.evidtrail.json` is committed, so a repo
// can be set up for evidtrail while the clone in front of you is not, and
// nothing breaks: the unknown bucket just grows (#75). Worth naming precisely
// rather than repeating generic advice.
export function coverageWarning(
  metrics: Metrics,
  scope: CommitStream['scope'],
  clone: CloneSetup
): string | null {
  const a = metrics.attribution;
  if (!(a.recent ? a.recent.belowThreshold : a.belowThreshold)) return null;
  const threshold = (a.coverageThreshold * 100).toFixed(0);
  const confidenceContext =
    scope === 'pr'
      ? 'the PR provenance summary is incomplete'
      : 'attribution-dependent metrics are low-confidence (repo-level change signals are unaffected)';
  return clone.configured && !clone.hooked
    ? `Coverage is below ${threshold}%: ${confidenceContext}. This repo is set up for evidtrail (.evidtrail.json) but THIS CLONE has no ${HOOK_NAME} hook, so its commits declare nothing. Run 'evidtrail install-hooks' — or add "prepare": "evidtrail install-hooks --if-git" to package.json so every clone gets it.`
    : `Coverage is below ${threshold}%: ${confidenceContext}. Install the commit hook (evidtrail install-hooks) for future commits; repair existing provenance with truthful AI-Mode trailers or an attribution manifest. defaultMode does not apply to past commits.`;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function coverageSummary(metrics: Metrics): string[] {
  const a = metrics.attribution;
  const lines = [
    `Attribution coverage: ${percent(a.coverage)} (ai: ${a.ai}, human: ${a.human}, automated: ${a.automated}, unknown: ${a.unknown})`,
  ];
  if (a.recent) {
    lines.push(
      `Recent coverage (${a.recent.windowDays}d): ${percent(a.recent.coverage)} over ${a.recent.commitsTotal} commits`
    );
  }
  return lines;
}

// The time-based signals. A PR-scope run has not had an observation window,
// so it gets none of these.
export function changeSignalSummary(metrics: Metrics): string[] {
  const lc = metrics.trend.latestComparison;
  const lines = [
    lc
      ? `Trend ${lc.from} -> ${lc.to}: ${metrics.trend.observationDays}d rapid retouch ` +
        (lc.rapidRetouchRate
          ? `${percent(lc.rapidRetouchRate.from)} -> ${percent(lc.rapidRetouchRate.to)}`
          : 'unavailable (no eligible files)')
      : `Trend: fewer than two mature periods (${metrics.trend.observationDays}d window) — no comparison yet`,
  ];
  const retouch30 = metrics.repo.persistence.rapidRetouch.find((result) => result.windowDays === 30);
  lines.push(
    `Repo rapid retouch (30d): ${retouch30?.rate === null || !retouch30 ? 'unavailable' : `${percent(retouch30.rate)} (${retouch30.retouched}/${retouch30.eligible})`}`
  );
  const ls = metrics.lineSurvival;
  if (ls) {
    lines.push(
      `Line survival: ${percent(ls.aiShare)} of attributed lines were last written by AI (${ls.byAttribution.ai}/${ls.totalLines})`
    );
  }
  const pr = metrics.prAcceptance;
  if (pr) {
    const ai = pr.byAttribution.ai;
    lines.push(
      `PR acceptance overall: ${percent(pr.overall.acceptanceRate)}` +
        (ai ? ` · AI PRs: ${percent(ai.acceptanceRate)} (${ai.total})` : '')
    );
  }
  const oc = metrics.outcomeCorrelation;
  if (oc.reverts.total > 0 || oc.hotfixes.total > 0) {
    lines.push(
      `Outcome correlation: ${oc.reverts.resolved}/${oc.reverts.total} reverts resolved, ${oc.hotfixes.linked}/${oc.hotfixes.total} hotfixes linked`
    );
  }
  return lines;
}

export async function runAnalyze(outDir: string, flags: AnalyzeFlags, logger: Logger): Promise<void> {
  logger.info('Starting metrics analysis...');
  const commitStream = await readCommitStream(outDir);
  logger.info(`Analyzing ${commitStream.commits.length} commits`);

  const options = metricsOptionsFrom(flags, await loadConfig(commitStream.repoPath));
  const inputs = await readOptionalInputs(outDir, commitStream, logger);
  const metrics = calculateMetrics(commitStream, { ...options, ...inputs });

  const outputPath = join(outDir, 'metrics.json');
  await writeJSON(outputPath, metrics);

  coverageSummary(metrics).forEach((line) => logger.info(line));
  const warning = coverageWarning(metrics, commitStream.scope, {
    configured: (await findConfigFile(commitStream.repoPath)) !== null,
    hooked: await isHookInstalled(commitStream.repoPath),
  });
  if (warning) logger.warn(warning);
  if (commitStream.scope !== 'pr') {
    changeSignalSummary(metrics).forEach((line) => logger.info(line));
  }
  logger.info(`Output written to: ${outputPath}`);
}

export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze commit stream and generate metrics.json')
    .option('--out-dir <path>', 'Output directory', './evidtrail-output')
    .option(
      '--coverage-threshold <fraction>',
      'Coverage below this flags metrics as low-confidence (default: 0.7, or .evidtrail.json)'
    )
    .option(
      '--coverage-window <days>',
      'Window in days for the actionable coverage figure (default: 90)'
    )
    .option(
      '--trend-granularity <value>',
      'Trend period: month | quarter (default: month)'
    )
    .option(
      '--trend-window <days>',
      'Observation window applied equally to every trend period (default: 30)'
    )
    .option('--trend-periods <n>', 'How many recent periods to report (default: 12)')
    .option(
      '--hotfix-window <days>',
      'Window in days for linking a hotfix to its likely antecedent (default: 7)'
    )
    .option('--verbose', 'Verbose logging', false)
    .action(async (options) => {
      const config = CLIConfig.parse(options);
      const logger = createLogger(config.verbose);
      try {
        await runAnalyze(config.outDir, options, logger);
      } catch (error) {
        logger.error(`Analysis failed: ${describeError(error)}`);
        process.exit(1);
      }
    });
}
