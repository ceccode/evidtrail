import {
  BlameStream,
  Commit,
  CommitStream,
  METRICS_SCHEMA_VERSION,
  PRStream,
  formatISODate,
} from '@evidtrail/core';
import { calculatePersistence } from './persistence.js';
import { calculateLineSurvival } from './line-survival.js';
import { calculateOutcomeCorrelation } from './outcome-correlation.js';
import { calculatePRAcceptance } from './pr-acceptance.js';
import { calculateTrend, TrendOptions } from './trend.js';
import { observationEndOf } from './observation.js';
import { Attribution, Metrics, RepoQuality } from './schema/metrics.js';

export * from './schema/metrics.js';
export * from './file-category.js';
export * from './persistence.js';
export * from './pr-acceptance.js';
export * from './line-survival.js';
export * from './outcome-correlation.js';
export * from './trend.js';
export * from './observation.js';

export const DEFAULT_COVERAGE_WINDOW_DAYS = 90;
const MAX_EVIDENCE_GAPS = 20;

export interface MetricsOptions {
  // The repository's configured prior, recorded in `attribution.defaultMode`
  // for context. It is never applied to a commit: the hook stamps it on new
  // commits, and analysis leaves commits with no evidence `unknown`.
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
  let aiModeUnknown = 0;
  let sessionLinked = 0;
  const sessionIds = new Set<string>();
  for (const commit of commitStream.commits) {
    counts[commit.tags.attribution]++;
    evidence[commit.tags.evidence]++;
    if (commit.tags.attribution === 'ai' && commit.tags.mode === 'unknown') aiModeUnknown++;
    // Counted over AI commits only, so the report can put it next to the AI
    // total without a numerator and denominator from different sets.
    if (commit.tags.attribution === 'ai' && commit.session) {
      sessionLinked++;
      sessionIds.add(`${commit.session.agent}/${commit.session.id}`);
    }
    // Automation is off the autonomy axis (#39). Counting a merge commit's
    // `mode: 'none'` under "hand-written" would overstate hand-written work
    // and disagree with the automated count reported next to it.
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
  // coverage and bytes on different days. And observation
  // cannot outlive the `--until` bound: everything below that measures
  // elapsed time — the recent-coverage window, censoring, trend maturity —
  // runs to this instant and no further.
  const asOf = observationEndOf(commitStream);
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
    aiModeUnknown,
    sessions: { linked: sessionLinked, distinct: sessionIds.size },
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

  // Repository change signals (#77, step 1). Computed over ALL authored
  // commits: no cohort, no evidence requirement, nothing a prior could move.
  const isAuthored = (commit: Commit) => !commit.tags.automated;
  const authoredCount = commitStream.commits.filter(isAuthored).length;
  const repo: RepoQuality = {
    commitsAuthored: authoredCount,
    commitsAutomated: total - authoredCount,
    persistence: calculatePersistence(commitStream, isAuthored, { observationEnd: asOf }),
  };

  // The same repo-level measurement sliced by period, so the repo can be
  // compared with its own past (#77 step 3).
  const trend = calculateTrend(commitStream, { observationEnd: asOf, ...trendOptions });

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
      ? `Evidence coverage is ${(coverage * 100).toFixed(1)}%: a missing signal remains \`unknown\`; it is not evidence of human authorship and a \`defaultMode\` setting does not turn it into observed provenance.`
      : `Evidence coverage is ${(coverage * 100).toFixed(1)}%: breakdowns by attribution (outcomes, PR merges, line survival) only describe commits whose provenance is known. Repository change signals (the \`repo\` block) cover all authored commits regardless of evidence.`,
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
  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    generatedAt: formatISODate(asOf),
    window: {
      since: commitStream.since,
      until: commitStream.until,
      observationEnd: formatISODate(asOf),
    },
    repoPath: commitStream.repoPath,
    defaultBranch: commitStream.defaultBranch,
    scope: commitStream.scope,
    headSha: commitStream.headSha,
    attribution,
    repo,
    trend,
    outcomeCorrelation,
    prAcceptance,
    lineSurvival,
    caveats,
  };
}
