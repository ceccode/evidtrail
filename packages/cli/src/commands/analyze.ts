import { Command } from 'commander';
import {
  readJSON,
  writeJSON,
  createLogger,
  CommitStream,
  COMMIT_STREAM_SCHEMA_VERSION,
  BlameStream,
  BLAME_STREAM_SCHEMA_VERSION,
  PRStream,
  PR_STREAM_SCHEMA_VERSION,
  assertSchemaVersion,
  fileExists,
  describeError,
} from '@evidtrail/core';
import { calculateMetrics } from '@evidtrail/metrics';
import { join, resolve } from 'path';
import { CLIConfig } from '../schema/config.js';
import { HOOK_NAME, isAidaHookInstalled } from '../hooks/detect.js';
import { findConfigFile, loadAidaConfig } from '../config/load.js';

const MODES = ['none', 'autocomplete', 'assisted', 'agent'];

export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze commit stream and generate metrics.json')
    .option('--out-dir <path>', 'Output directory', './evidtrail-output')
    .option(
      '--default-mode <value>',
      'Prior for commits with no evidence: none | autocomplete | assisted | agent (default: no prior, or .evidtrail.json)'
    )
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
        logger.info('Starting metrics analysis...');

        const inputPath = join(config.outDir, 'commit-stream.json');
        // Version gate before schema parsing, so an incompatible file gives an
        // actionable message instead of a zod dump (#53)
        const raw = await readJSON<unknown>(inputPath);
        assertSchemaVersion(
          raw,
          COMMIT_STREAM_SCHEMA_VERSION,
          'commit-stream.json',
          "Rerun 'evidtrail collect' with this version of evidtrail."
        );
        const commitStream = CommitStream.parse(raw);

        logger.info(`Analyzing ${commitStream.commits.length} commits`);

        // CLI flags override .evidtrail.json (read from the collected repo's root)
        const fileConfig = await loadAidaConfig(commitStream.repoPath, logger);
        const defaultMode = options.defaultMode ?? fileConfig.defaultMode;
        if (defaultMode && !MODES.includes(defaultMode)) {
          throw new Error(
            `Invalid --default-mode "${defaultMode}": expected ${MODES.join(', ')}`
          );
        }
        const coverageThreshold = options.coverageThreshold
          ? Number(options.coverageThreshold)
          : (fileConfig.coverageThreshold ?? 0.7);
        if (Number.isNaN(coverageThreshold) || coverageThreshold < 0 || coverageThreshold > 1) {
          throw new Error(
            `Invalid --coverage-threshold "${options.coverageThreshold}": expected a fraction between 0 and 1`
          );
        }

        // Optional PR outcomes (#51): absent unless `evidtrail fetch-prs` ran.
        // Missing file is the normal offline case, not an error.
        const prStreamPath = join(config.outDir, 'pr-stream.json');
        let prStream = null;
        if (await fileExists(prStreamPath)) {
          const rawPRs = await readJSON<unknown>(prStreamPath);
          assertSchemaVersion(
            rawPRs,
            PR_STREAM_SCHEMA_VERSION,
            'pr-stream.json',
            "Rerun 'evidtrail fetch-prs' with this version of evidtrail."
          );
          prStream = PRStream.parse(rawPRs);
          logger.info(`PR outcomes loaded: ${prStream.prs.length} closed PR(s)`);
        }

        const coverageWindowDays = options.coverageWindow
          ? Number(options.coverageWindow)
          : undefined;
        if (
          coverageWindowDays !== undefined &&
          (!Number.isInteger(coverageWindowDays) || coverageWindowDays <= 0)
        ) {
          throw new Error(
            `Invalid --coverage-window "${options.coverageWindow}": expected a positive integer`
          );
        }

        // Optional line-level blame data (#23): absent unless `evidtrail blame` ran
        const blamePath = join(config.outDir, 'blame-stream.json');
        let blameStream = null;
        if (await fileExists(blamePath)) {
          const rawBlame = await readJSON<unknown>(blamePath);
          assertSchemaVersion(
            rawBlame,
            BLAME_STREAM_SCHEMA_VERSION,
            'blame-stream.json',
            "Rerun 'evidtrail blame' with this version of evidtrail."
          );
          blameStream = BlameStream.parse(rawBlame);
          if (resolve(blameStream.repoPath) !== resolve(commitStream.repoPath)) {
            throw new Error(
              'blame-stream.json belongs to a different repository. Remove it or rerun `evidtrail blame` for the collected repo.'
            );
          }
          if (blameStream.headSha !== commitStream.headSha) {
            throw new Error(
              `blame-stream.json describes ${blameStream.headSha.slice(0, 12)}, but commit-stream.json describes ${commitStream.headSha.slice(0, 12)}. Rerun collect and blame from the same checkout before analyzing.`
            );
          }
          logger.info(`Blame data loaded: ${blameStream.totalLines} lines`);
        }

        const hotfixWindowDays = options.hotfixWindow ? Number(options.hotfixWindow) : undefined;
        if (
          hotfixWindowDays !== undefined &&
          (!Number.isInteger(hotfixWindowDays) || hotfixWindowDays <= 0)
        ) {
          throw new Error(
            `Invalid --hotfix-window "${options.hotfixWindow}": expected a positive integer`
          );
        }

        const trendGranularity = options.trendGranularity ?? 'month';
        if (!['month', 'quarter'].includes(trendGranularity)) {
          throw new Error(
            `Invalid --trend-granularity "${trendGranularity}": expected month or quarter`
          );
        }
        const trendWindow = options.trendWindow ? Number(options.trendWindow) : undefined;
        if (trendWindow !== undefined && (!Number.isInteger(trendWindow) || trendWindow <= 0)) {
          throw new Error(
            `Invalid --trend-window "${options.trendWindow}": expected a positive integer`
          );
        }
        const trendPeriods = options.trendPeriods ? Number(options.trendPeriods) : undefined;
        if (trendPeriods !== undefined && (!Number.isInteger(trendPeriods) || trendPeriods <= 0)) {
          throw new Error(
            `Invalid --trend-periods "${options.trendPeriods}": expected a positive integer`
          );
        }

        const metrics = calculateMetrics(commitStream, {
          defaultMode,
          trend: {
            granularity: trendGranularity as 'month' | 'quarter',
            observationDays: trendWindow,
            maxPeriods: trendPeriods,
          },
          coverageThreshold,
          coverageWindowDays,
          prStream,
          blameStream,
          hotfixWindowDays,
        });

        const outputPath = join(config.outDir, 'metrics.json');
        await writeJSON(outputPath, metrics);

        const a = metrics.attribution;
        logger.info(
          `Attribution coverage: ${(a.coverage * 100).toFixed(1)}% (ai: ${a.ai}, human: ${a.human}, automated: ${a.automated}, unknown: ${a.unknown})`
        );
        if (a.recent) {
          logger.info(
            `Recent coverage (${a.recent.windowDays}d): ${(a.recent.coverage * 100).toFixed(1)}% over ${a.recent.commitsTotal} commits`
          );
        }
        if (a.recent ? a.recent.belowThreshold : a.belowThreshold) {
          const threshold = (a.coverageThreshold * 100).toFixed(0);
          // A hook is per-clone state while `.evidtrail.json` is committed, so a
          // repo can be set up for evidtrail while the clone in front of you is
          // not — and nothing breaks, the unknown bucket just grows (#75).
          // Worth naming precisely rather than repeating generic advice.
          const configured = (await findConfigFile(commitStream.repoPath)) !== null;
          const hooked = await isAidaHookInstalled(commitStream.repoPath);
          const confidenceContext =
            commitStream.scope === 'pr'
              ? 'the PR provenance summary is incomplete'
              : 'attribution-dependent metrics are low-confidence (repo-level change signals are unaffected)';
          logger.warn(
            configured && !hooked
              ? `Coverage is below ${threshold}%: ${confidenceContext}. This repo is set up for evidtrail (.evidtrail.json) but THIS CLONE has no ${HOOK_NAME} hook, so its commits declare nothing. Run 'evidtrail install-hooks' — or add "prepare": "evidtrail install-hooks --if-git" to package.json so every clone gets it.`
              : `Coverage is below ${threshold}%: ${confidenceContext}. Install the commit hook (evidtrail install-hooks) for future commits; repair existing provenance with truthful AI-Mode trailers or an attribution manifest. A defaultMode prior does not increase coverage.`
          );
        }
        if (commitStream.scope !== 'pr') {
          const lc = metrics.trend.latestComparison;
          logger.info(
            lc
              ? `Trend ${lc.from} -> ${lc.to}: ${metrics.trend.observationDays}d rapid retouch ` +
                  (lc.rapidRetouchRate
                    ? `${(lc.rapidRetouchRate.from * 100).toFixed(1)}% -> ${(lc.rapidRetouchRate.to * 100).toFixed(1)}%`
                    : 'unavailable (no eligible files)')
              : `Trend: fewer than two mature periods (${metrics.trend.observationDays}d window) — no comparison yet`
          );
          const retouch30 = metrics.repo.persistence.rapidRetouch.find(
            (result) => result.windowDays === 30
          );
          logger.info(
            `Repo rapid retouch (30d): ${retouch30?.rate === null || !retouch30 ? 'unavailable' : `${(retouch30.rate * 100).toFixed(1)}% (${retouch30.retouched}/${retouch30.eligible})`}`
          );
          if (metrics.lineSurvival) {
            const ls = metrics.lineSurvival;
            logger.info(
              `Line survival: ${(ls.aiShare * 100).toFixed(1)}% of attributed lines were last written by AI (${ls.byAttribution.ai}/${ls.totalLines})`
            );
          }
          if (metrics.prAcceptance) {
            const ai = metrics.prAcceptance.byAttribution.ai;
            logger.info(
              `PR acceptance overall: ${(metrics.prAcceptance.overall.acceptanceRate * 100).toFixed(1)}%` +
                (ai ? ` · AI PRs: ${(ai.acceptanceRate * 100).toFixed(1)}% (${ai.total})` : '')
            );
          }
          const oc = metrics.outcomeCorrelation;
          if (oc.reverts.total > 0 || oc.hotfixes.total > 0) {
            logger.info(
              `Outcome correlation: ${oc.reverts.resolved}/${oc.reverts.total} reverts resolved, ${oc.hotfixes.linked}/${oc.hotfixes.total} hotfixes linked`
            );
          }
          if (!metrics.baseline) {
            logger.warn('No baseline cohort: no commits attributed as human (see caveats).');
          }
        }
        logger.info(`Output written to: ${outputPath}`);
      } catch (error) {
        logger.error(`Analysis failed: ${describeError(error)}`);
        process.exit(1);
      }
    });
}
