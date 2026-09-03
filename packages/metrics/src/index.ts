import {
  AIMode,
  BlameStream,
  Commit,
  CommitStream,
  METRICS_SCHEMA_VERSION,
  PRStream,
  formatISODate,
} from '@evidtrail/core';
import { calculateAgeStats, calculateCategoryCounts } from './cohort.js';
import { calculateBaselinePersistence, calculatePersistence } from './persistence.js';
import { calculateLineSurvival } from './line-survival.js';
import { calculateOutcomeCorrelation } from './outcome-correlation.js';
import { calculatePRAcceptance } from './pr-acceptance.js';
import { calculateTrend, TrendOptions } from './trend.js';
import {
  Attribution,
  ByCategory,
  ByMode,
  CategoryComparison,
  FileCategory,
  Metrics,
  ModeStats,
  RepoQuality,
} from './schema/metrics.js';

export * from './schema/metrics.js';
export * from './cohort.js';
export * from './persistence.js';
export * from './pr-acceptance.js';
export * from './line-survival.js';
export * from './outcome-correlation.js';
export * from './trend.js';

export const DEFAULT_COVERAGE_WINDOW_DAYS = 90;
const MAX_EVIDENCE_GAPS = 20;

export interface MetricsOptions {
  // Prior for commits with no evidence (#25): which cohort, if any, they
  // join. Undefined = no assumption.
  defaultMode?: 'none' | 'autocomplete' | 'assisted' | 'agent';
  coverageThreshold?: number;
  // Window for the actionable coverage figure (#52)
  coverageWindowDays?: number;
  // Optional PR outcomes from `evidtrail fetch-prs` (#51)
  prStream?: PRStream | null;
  // Optional line-level blame data from `evidtrail blame` (#23)
  blameStream?: BlameStream | null;
  // Window for linking a hotfix to its likely antecedent (#26)
  hotfixWindowDays?: number;
  // Quality-over-time series (#77 step 3)
  trend?: TrendOptions;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function retouchRate(persistence: ReturnType<typeof calculatePersistence>, days: number) {
  return persistence.rapidRetouch.find((result) => result.windowDays === days)?.rate ?? null;
}

export function calculateMetrics(
  commitStream: CommitStream,
  options: MetricsOptions = {}
): Metrics {
  const {
    defaultMode,
    coverageThreshold = 0.7,
    coverageWindowDays = DEFAULT_COVERAGE_WINDOW_DAYS,
    prStream = null,
    blameStream = null,
    hotfixWindowDays,
    trend: trendOptions,
  } = options;

  const counts = { ai: 0, human: 0, automated: 0, unknown: 0 };
  const modes = { none: 0, autocomplete: 0, assisted: 0, agent: 0, unknown: 0 };
  const evidence = { declared: 0, inferred: 0, none: 0 };
  for (const commit of commitStream.commits) {
    counts[commit.tags.attribution]++;
    evidence[commit.tags.evidence]++;
    // Automation is off the autonomy axis (#39). Counting a merge commit's
    // `mode: 'none'` under "hand-written" would both overstate the human
    // cohort and contradict `byMode`, which excludes automation — two tables
    // in the same report disagreeing about the same commits.
    if (!commit.tags.automated) modes[commit.tags.mode]++;
  }
  const total = commitStream.commits.length;
  // Coverage is the evidence axis (#25): how much of the history has known
  // provenance, declared or inferred. Automated commits count as covered
  // because their provenance IS known (#39) — they carry evidence
  // 'inferred', so they need no special case here any more.
  const coverage = total > 0 ? (evidence.declared + evidence.inferred) / total : 0;

  // Coverage over a recent window (#52): the number a team can actually move.
  // All-time coverage is a permanent verdict on history predating adoption.
  // A metrics artifact is a pure function of its input artifact. Using wall
  // clock time here made an unchanged commit-stream.json produce different
  // coverage, cohort ages and bytes on different days.
  const asOf = new Date(commitStream.generatedAt);
  const windowStart = new Date(asOf.getTime() - coverageWindowDays * 24 * 60 * 60 * 1000);
  const recentCommits = commitStream.commits.filter(
    (commit) => new Date(commit.committerDate) >= windowStart
  );
  const recentCounts = { ai: 0, human: 0, automated: 0, unknown: 0 };
  let recentWithEvidence = 0;
  for (const commit of recentCommits) {
    recentCounts[commit.tags.attribution]++;
    if (commit.tags.evidence !== 'none') recentWithEvidence++;
  }
  const recentCoverage = recentCommits.length > 0 ? recentWithEvidence / recentCommits.length : 0;
  const commitsMissingEvidence = commitStream.commits.filter(
    (commit) => commit.tags.evidence === 'none'
  );

  const attribution: Attribution = {
    commitsTotal: total,
    ai: counts.ai,
    human: counts.human,
    automated: counts.automated,
    unknown: counts.unknown,
    coverage: round(coverage, 4),
    defaultMode: defaultMode ?? null,
    coverageThreshold,
    belowThreshold: coverage < coverageThreshold,
    recent:
      recentCommits.length > 0
        ? {
            windowDays: coverageWindowDays,
            commitsTotal: recentCommits.length,
            ai: recentCounts.ai,
            human: recentCounts.human,
            automated: recentCounts.automated,
            unknown: recentCounts.unknown,
            coverage: round(recentCoverage, 4),
            belowThreshold: recentCoverage < coverageThreshold,
          }
        : null,
    modes,
    evidence,
    missingEvidence: {
      commits: commitsMissingEvidence.slice(0, MAX_EVIDENCE_GAPS).map((commit) => ({
        hash: commit.hash,
        subject: commit.message,
      })),
      truncated: commitsMissingEvidence.length > MAX_EVIDENCE_GAPS,
    },
  };

  // Cohort membership is decided on the mode axis (#25), with the prior
  // filling in only where there is no evidence at all. Automation joins
  // nothing and priors never touch it: it is not authored code.
  //
  // `effectiveMode` is the one place the prior is applied. It deliberately
  // does not write back into the tags — a prior is an assumption, and the
  // moment it looked like evidence, coverage would start flattering itself.
  const effectiveMode = (commit: Commit): AIMode => {
    if (commit.tags.automated) return 'unknown';
    if (commit.tags.evidence === 'none' && defaultMode) return defaultMode;
    return commit.tags.mode;
  };

  // The AI cohort is every autonomy level above 'none'; the baseline is the
  // 'none' cohort. In an AI-first world this is the projection, not the
  // question — the question is the per-level breakdown below.
  const isAI = (commit: Commit) => {
    // A named tool can prove AI involvement without proving an autonomy
    // level. Keep that commit in the AI projection while leaving byMode in
    // `unknown`; otherwise the two views contradict each other.
    if (commit.tags.evidence !== 'none') return commit.tags.attribution === 'ai';
    const mode = effectiveMode(commit);
    return mode === 'autocomplete' || mode === 'assisted' || mode === 'agent';
  };
  const isBaseline = (commit: Commit) => effectiveMode(commit) === 'none';

  // Repo-level quality (#77, step 1): the primary object. Computed over ALL
  // authored commits — no cohort, no evidence requirement, and deliberately
  // no `effectiveMode`: the prior must not be able to move these numbers,
  // or "assume everything is AI" would quietly become "trust the assumption".
  const isAuthored = (commit: Commit) => !commit.tags.automated;
  const authoredCount = commitStream.commits.filter(isAuthored).length;
  const repo: RepoQuality = {
    commitsAuthored: authoredCount,
    commitsAutomated: total - authoredCount,
    persistence: calculatePersistence(commitStream, isAuthored),
  };

  // Quality over time (#77 step 3): the same repo-level measurement, sliced
  // by period, so the repo can be compared with its own past instead of with
  // a cohort that no longer exists.
  const trend = calculateTrend(commitStream, trendOptions);

  const persistence = calculatePersistence(commitStream, isAI);

  // Fairness context (#29, #36): cohort age and task mix
  const now = asOf;
  const aiCommits = commitStream.commits.filter(isAI);
  const baselineCommits = commitStream.commits.filter(isBaseline);
  const cohorts = {
    ai: {
      age: calculateAgeStats(aiCommits, now),
      taskMix: calculateCategoryCounts(aiCommits),
    },
    baseline: {
      age: calculateAgeStats(baselineCommits, now),
      taskMix: calculateCategoryCounts(baselineCommits),
    },
  };

  // Per-autonomy-level metrics (#25, step 2). Automated commits are
  // excluded: automation is not authored code, whatever its mode field says.
  const MODES = ['agent', 'assisted', 'autocomplete', 'none', 'unknown'] as const;
  const byMode = Object.fromEntries(
    MODES.map((mode) => {
      const isMode = (commit: Commit) => !commit.tags.automated && effectiveMode(commit) === mode;
      const modeCommits = commitStream.commits.filter(isMode);
      if (modeCommits.length === 0) {
        return [mode, null];
      }
      const stats: ModeStats = {
        commits: modeCommits.length,
        // Observed vs assumed, kept apart so the cohort size can never read
        // as evidence it isn't (#25)
        assumed: modeCommits.filter((c) => c.tags.evidence === 'none').length,
        persistence: calculatePersistence(commitStream, isMode),
      };
      return [mode, stats];
    })
  ) as ByMode;

  // No baseline cohort → no baseline, no delta. evidtrail does not invent a
  // comparison out of unattributed commits.
  const baselineSize = baselineCommits.length;
  const baselineAssumed = defaultMode === 'none' && evidence.none > 0;

  const baseline =
    baselineSize > 0
      ? {
          assumed: baselineAssumed,
          persistence: calculateBaselinePersistence(commitStream, isBaseline),
        }
      : null;

  const delta = baseline
    ? {
        avgPersistenceDays: round(persistence.avgDays - baseline.persistence.avgDays, 2),
        medianPersistenceDays: round(persistence.medianDays - baseline.persistence.medianDays, 2),
        rapidRetouch30Rate:
          retouchRate(persistence, 30) !== null && retouchRate(baseline.persistence, 30) !== null
            ? round(retouchRate(persistence, 30)! - retouchRate(baseline.persistence, 30)!, 4)
            : null,
      }
    : null;

  // Age-normalized comparison (#29): cap both sides to the younger cohort's
  // average age, so an older cohort can't win on clock time alone. Requires
  // both cohorts to have a known age (i.e. to be non-empty) — same
  // precondition as `baseline`.
  const aiAge = cohorts.ai.age;
  const baselineAge = cohorts.baseline.age;
  const fairComparison =
    baseline && aiAge && baselineAge
      ? (() => {
          const capDays = Math.min(aiAge.avgAgeDays, baselineAge.avgAgeDays);
          const cappedAI = calculatePersistence(commitStream, isAI, {
            maxObservationDays: capDays,
          });
          const cappedBaseline = calculateBaselinePersistence(commitStream, isBaseline, {
            maxObservationDays: capDays,
          });
          return {
            capDays: round(capDays, 2),
            ai: cappedAI,
            baseline: cappedBaseline,
            delta: {
              avgPersistenceDays: round(cappedAI.avgDays - cappedBaseline.avgDays, 2),
              medianPersistenceDays: round(cappedAI.medianDays - cappedBaseline.medianDays, 2),
              rapidRetouch30Rate:
                retouchRate(cappedAI, 30) !== null && retouchRate(cappedBaseline, 30) !== null
                  ? round(retouchRate(cappedAI, 30)! - retouchRate(cappedBaseline, 30)!, 4)
                  : null,
            },
          };
        })()
      : null;

  // Within-category comparison (#36 step 2): persistence per file category,
  // AI vs baseline, instead of only reporting the mix. Always computed —
  // useful even without a baseline cohort, to compare e.g. AI-written tests
  // against AI-written source within the same repo.
  const CATEGORIES: FileCategory[] = [
    'source',
    'tests',
    'migrations',
    'config',
    'docs',
    'generated',
  ];
  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => {
      const toLean = (p: ReturnType<typeof calculatePersistence>) =>
        p.filesConsidered > 0
          ? {
              filesConsidered: p.filesConsidered,
              avgDays: p.avgDays,
              medianDays: p.medianDays,
              rapidRetouch30: p.rapidRetouch.find((result) => result.windowDays === 30) ?? null,
            }
          : null;

      const aiCat = toLean(
        calculatePersistence(commitStream, isAI, { onlyCategory: category, excludeCategories: [] })
      );
      const baselineCat = baseline
        ? toLean(
            calculateBaselinePersistence(commitStream, isBaseline, {
              onlyCategory: category,
              excludeCategories: [],
            })
          )
        : null;

      const comparison: CategoryComparison = {
        ai: aiCat,
        baseline: baselineCat,
        deltaAvgDays: aiCat && baselineCat ? round(aiCat.avgDays - baselineCat.avgDays, 2) : null,
        deltaMedianDays:
          aiCat && baselineCat ? round(aiCat.medianDays - baselineCat.medianDays, 2) : null,
      };
      return [category, comparison];
    })
  ) as ByCategory;

  // PR acceptance (#51): present only when fetch-prs ran
  const prAcceptance = prStream ? calculatePRAcceptance(prStream) : null;
  // Line-level survival (#23): present only when blame ran
  const lineSurvival = blameStream ? calculateLineSurvival(blameStream, commitStream) : null;
  // Outcome correlation (#26): reverts and hotfixes linked to what they
  // respond to. Always computed — a repo-level property, not a comparison.
  const outcomeCorrelation = calculateOutcomeCorrelation(
    commitStream,
    hotfixWindowDays !== undefined ? { hotfixWindowDays } : {}
  );

  const scopeCaveat =
    commitStream.scope === 'pr'
      ? `Commit scope is \`pr\` at ${commitStream.headSha.slice(0, 12) || 'an empty repository'}: only commits in base..HEAD are included. This is a change-set view, not repository history, merge status, or deployed production state.`
      : commitStream.scope === 'all-refs'
        ? `Commit scope is \`all-refs\` at ${commitStream.headSha.slice(0, 12) || 'an empty repository'}: commits reachable from every local and remote ref are included, including work that may never have been integrated or deployed.`
        : `Commit scope is \`default-branch\` at ${commitStream.headSha.slice(0, 12) || 'an empty repository'}: work reachable only from other refs is excluded. This describes integrated git history, not deployed production state.`;
  const caveats = [
    commitStream.scope === 'pr'
      ? `Evidence coverage is ${(coverage * 100).toFixed(1)}%: a missing signal remains \`unknown\`; it is not evidence of human authorship and a \`defaultMode\` prior does not turn it into observed provenance.`
      : `Evidence coverage is ${(coverage * 100).toFixed(1)}%: attribution-dependent metrics only describe commits whose provenance is known. Repository change signals (the \`repo\` block) cover all authored commits regardless of evidence.`,
    scopeCaveat,
  ];
  if (commitStream.scope === 'pr') {
    caveats.push(
      'Rapid-retouch rates and trends are omitted from the PR report because a fresh change set has not had a comparable observation window.',
      'AI tagging uses declarations and conservative heuristics; tool use that leaves no commit evidence cannot be recovered from git alone.'
    );
  } else {
    caveats.push(
      'Rapid retouch is file-level: any subsequent commit touching the same file within the horizon counts. It is a churn signal, not proof of a defect, rollback, or wasted work.',
      'Fixed-horizon rates exclude files too recent to have a known outcome from the denominator and report them separately.',
      'Migrations and generated files are excluded from repo rapid-retouch metrics because their convention-driven lifecycles carry a different signal.',
      'AI tagging uses heuristic patterns; false positives/negatives possible.',
      'Outcome correlation only covers what git can see: reverts resolved by hash and hotfix-pattern commits linked to the most recent prior touch of the same file(s). Incidents, SAST findings, and reverts/hotfixes outside the collected window are not represented.',
      'Outcome ratios compare a cohort\'s share of reverts/hotfixes against its share of authored commits: 1.00x means "exactly as often as its size predicts". They are descriptive, not causal, and on small counts a single commit can move the ratio a long way.'
    );
  }
  if (prAcceptance?.truncated && commitStream.scope !== 'pr') {
    caveats.push(
      'PR acceptance covers a capped sample of pull requests (--max-prs), not the full history.'
    );
  }
  if (lineSurvival?.truncated && commitStream.scope !== 'pr') {
    caveats.push(
      'Line survival covers a capped sample of files (--max-files), not the whole tree.'
    );
  }
  if (!lineSurvival && commitStream.scope !== 'pr') {
    caveats.push(
      "Line-level survival is unavailable: run 'evidtrail blame' for exact per-line attribution instead of the file-level proxy."
    );
  }
  if (!prAcceptance && commitStream.scope !== 'pr') {
    caveats.push(
      "PR merge outcomes are unavailable: run 'evidtrail fetch-prs' to compare merged and closed-unmerged work. Git history alone cannot recover discarded PRs."
    );
  }
  if (baseline?.assumed && commitStream.scope !== 'pr') {
    caveats.push(
      `Baseline includes ${evidence.none} commit(s) with no evidence, assumed autonomy level 'none' via defaultMode — undeclared AI usage may leak into it.`
    );
  }
  if (!baseline && commitStream.scope !== 'pr') {
    caveats.push(
      'No baseline: no commits sit at autonomy level \'none\'. Set defaultMode to "none" in .evidtrail.json if the commits with no evidence in this repo were hand-written.'
    );
  }

  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    generatedAt: formatISODate(asOf),
    window: {
      since: commitStream.since,
      until: commitStream.until,
    },
    repoPath: commitStream.repoPath,
    defaultBranch: commitStream.defaultBranch,
    scope: commitStream.scope,
    headSha: commitStream.headSha,
    attribution,
    repo,
    trend,
    persistence,
    cohorts,
    byMode,
    fairComparison,
    byCategory,
    outcomeCorrelation,
    prAcceptance,
    lineSurvival,
    baseline,
    delta,
    caveats,
  };
}
