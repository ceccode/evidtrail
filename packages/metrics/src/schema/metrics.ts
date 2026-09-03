import { z } from 'zod';

// Attribution coverage (#34): the headline metric. Every other number in this
// file is only as trustworthy as this block says it is.
// Coverage over a recent window (#52). All-time coverage is a verdict on the
// past that a team cannot change; the actionable question is "are we tagging
// now?". Reported alongside all-time, never instead of it.
export const RecentCoverage = z.object({
  windowDays: z.number().int().positive(),
  commitsTotal: z.number().int().nonnegative(),
  ai: z.number().int().nonnegative(),
  human: z.number().int().nonnegative(),
  automated: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  coverage: z.number().min(0).max(1),
  belowThreshold: z.boolean(),
});

export const EvidenceGap = z.object({
  hash: z.string(),
  subject: z.string(),
});

export const Attribution = z.object({
  commitsTotal: z.number().int().nonnegative(),
  ai: z.number().int().nonnegative(),
  human: z.number().int().nonnegative(),
  // Provenance-known automation (#39): merge commits, bots, manifest-excluded.
  // Counts toward coverage, joins no cohort, untouched by priors.
  automated: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  // Coverage is the EVIDENCE axis (#25): the share of commits whose
  // provenance is known at all, declared or inferred. Identical in spirit to
  // the old (ai + human + automated) / total, but stated on the axis that
  // actually carries the meaning — `unknown` is no longer a fourth kind of
  // attribution, it is the absence of evidence.
  coverage: z.number().min(0).max(1), // (declared + inferred) / total
  // Prior applied to commits with no evidence; null when none is configured.
  // A prior joins a cohort but never raises coverage (#25).
  defaultMode: z.enum(['none', 'autocomplete', 'assisted', 'agent']).nullable(),
  coverageThreshold: z.number().min(0).max(1),
  belowThreshold: z.boolean(), // all-time; see `recent` for the actionable one
  // Null when the window contains no commits (#52)
  recent: RecentCoverage.nullable(),
  // Autonomy axis (#25): commit counts per mode and per mode-evidence level
  modes: z.object({
    none: z.number().int().nonnegative(),
    autocomplete: z.number().int().nonnegative(),
    assisted: z.number().int().nonnegative(),
    agent: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  evidence: z.object({
    declared: z.number().int().nonnegative(),
    inferred: z.number().int().nonnegative(),
    none: z.number().int().nonnegative(),
  }),
  // A bounded diagnostic list makes `unknown` actionable. Counts alone say
  // that provenance is missing; these identifiers say where to repair it.
  missingEvidence: z.object({
    commits: z.array(EvidenceGap),
    truncated: z.boolean(),
  }),
});

// Persistence = survival: days from first target-cohort touch of a file to
// the first subsequent modification. Files never modified again are censored
// at the observation end (they survived the window — the best outcome).
// Migrations and generated files are excluded by default: their lifecycle is
// convention-driven and carries no quality signal.
// Rework rate (#22): share of AI-touched files modified again within a short
// window. Right-censoring matters here: a file first touched two days ago
// and not yet reworked has no *determined* outcome for a 7-day window, so it
// counts in neither numerator nor denominator.
export const Rework = z.object({
  windowDays: z.number().int().positive(),
  reworked: z.number().int().nonnegative(),
  determined: z.number().int().nonnegative(), // files whose outcome is known
  undetermined: z.number().int().nonnegative(), // observed for less than the window
  rate: z.number().min(0).max(1),
});

// Fixed-horizon rapid retouch (# pre-1.0 metric contract). Unlike a raw
// average of event times and censored follow-up, this answers one bounded
// question: among files whose outcome by day N is known, how many were
// touched again? Files that have not yet reached N are stated separately.
export const RapidRetouch = z.object({
  windowDays: z.number().int().positive(),
  retouched: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(),
  tooRecent: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1).nullable(),
});

export const Persistence = z.object({
  commitsConsidered: z.number().int().nonnegative(),
  filesConsidered: z.number().int().nonnegative(),
  filesExcluded: z.number().int().nonnegative(),
  censored: z.number().int().nonnegative(), // files that survived the whole window
  avgDays: z.number().nonnegative(),
  medianDays: z.number().nonnegative(),
  // Null when no file has a determined outcome in the window (#22)
  rework: Rework.nullable(),
  rapidRetouch: z.array(RapidRetouch),
  buckets: z.object({
    d0_1: z.number().int().nonnegative(),
    d2_7: z.number().int().nonnegative(),
    d8_30: z.number().int().nonnegative(),
    d31_90: z.number().int().nonnegative(),
    d90_plus: z.number().int().nonnegative(),
  }),
});

// Cohort age (#29): context for judging whether a persistence comparison
// between cohorts is fair — older cohorts accumulate survival by default.
export const AgeStats = z.object({
  commits: z.number().int().nonnegative(),
  avgAgeDays: z.number().nonnegative(),
  medianAgeDays: z.number().nonnegative(),
});

// Task mix (#36): what kind of files each cohort touched. A persistence
// comparison is only meaningful when the mixes are similar.
export const FileCategory = z.enum([
  'source',
  'tests',
  'migrations',
  'config',
  'docs',
  'generated',
]);

export const CategoryCounts = z.object({
  source: z.number().int().nonnegative(),
  tests: z.number().int().nonnegative(),
  migrations: z.number().int().nonnegative(),
  config: z.number().int().nonnegative(),
  docs: z.number().int().nonnegative(),
  generated: z.number().int().nonnegative(),
});

export const CohortContext = z.object({
  age: AgeStats.nullable(),
  taskMix: CategoryCounts.nullable(),
});

export const Baseline = z.object({
  // True when the cohort includes no-evidence commits via defaultMode:
  // the baseline is an assumption, not observed attribution.
  assumed: z.boolean(),
  persistence: Persistence,
});

export const Delta = z.object({
  avgPersistenceDays: z.number(),
  medianPersistenceDays: z.number(),
  rapidRetouch30Rate: z.number().nullable(),
});

// Age-normalized comparison (#29): the AI vs Baseline table above can be
// misleading when one cohort's commits are systematically older or younger
// — an old cohort accumulates persistence simply from clock time, not code
// quality. This recomputes both sides with each file's observation window
// capped to `capDays` (the younger cohort's average commit age), so neither
// side gets credit for time it hasn't actually had. Null when there's no
// baseline cohort to compare against, same condition as `baseline`.
export const FairComparison = z.object({
  capDays: z.number().nonnegative(),
  ai: Persistence,
  baseline: Persistence,
  delta: Delta,
});

// Within-category comparison (#36 step 2): persistence computed separately
// per file category instead of pooled, so a mismatched task mix between
// cohorts (e.g. AI writes mostly tests, humans write mostly source) can't
// masquerade as a quality difference. Each side is null when that cohort has
// no files in the category; delta only when both sides are present.
export const CategoryPersistence = z.object({
  filesConsidered: z.number().int().nonnegative(),
  avgDays: z.number().nonnegative(),
  medianDays: z.number().nonnegative(),
  rapidRetouch30: RapidRetouch.nullable(),
});

export const CategoryComparison = z.object({
  ai: CategoryPersistence.nullable(),
  baseline: CategoryPersistence.nullable(),
  deltaAvgDays: z.number().nullable(),
  deltaMedianDays: z.number().nullable(),
});

export const ByCategory = z.object({
  source: CategoryComparison,
  tests: CategoryComparison,
  migrations: CategoryComparison,
  config: CategoryComparison,
  docs: CategoryComparison,
  generated: CategoryComparison,
});

// Outcome correlation (#26), scoped to what git itself can answer: reverts
// and hotfix-pattern commits, linked back to the attribution/mode of the
// commit(s) they respond to. Incidents and SAST findings are out of scope —
// they'd need network access this tool deliberately doesn't have.
const AttributionCounts = z.object({
  ai: z.number().int().nonnegative(),
  human: z.number().int().nonnegative(),
  automated: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});
const ModeCounts = z.object({
  none: z.number().int().nonnegative(),
  autocomplete: z.number().int().nonnegative(),
  assisted: z.number().int().nonnegative(),
  agent: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});

// A raw count of "AI-caused" outcomes is uninterpretable on its own: in a
// repo where 90% of commits are AI, 90% of reverts being AI means nothing.
// `share` is the cohort's slice of the outcome, `baseRate` its slice of
// authored commits overall, and `ratio` the two divided — ratio ≈ 1 means
// the cohort is reverted/hotfixed exactly as often as its size predicts.
// Null when there is nothing to divide by.
export const OutcomeRate = z.object({
  count: z.number().int().nonnegative(),
  share: z.number().min(0).max(1).nullable(),
  baseRate: z.number().min(0).max(1).nullable(),
  ratio: z.number().nonnegative().nullable(),
});

const OutcomeRates = z.object({
  ai: OutcomeRate,
  human: OutcomeRate,
  unknown: OutcomeRate,
});

export const RevertStats = z.object({
  total: z.number().int().nonnegative(), // revert commits found
  resolved: z.number().int().nonnegative(), // reverts whose target is in the collected window
  // Attribution/mode of the REVERTED commit, not the revert itself
  byAttribution: AttributionCounts,
  byMode: ModeCounts,
  // Same counts expressed against each cohort's base rate (see OutcomeRate)
  rates: OutcomeRates,
});

export const HotfixStats = z.object({
  windowDays: z.number().int().positive(),
  total: z.number().int().nonnegative(), // commits matching a fix/hotfix pattern
  linked: z.number().int().nonnegative(), // hotfixes with an antecedent touch inside the window
  // Attribution/mode of the antecedent commit, not the hotfix itself
  byAttribution: AttributionCounts,
  byMode: ModeCounts,
  rates: OutcomeRates,
});

export const OutcomeCorrelation = z.object({
  reverts: RevertStats,
  hotfixes: HotfixStats,
});

// Per-autonomy-level metrics (#25, step 2): the durable comparison in an
// AI-first world is between autonomy levels, not AI vs human. Automated
// commits are excluded — automation is not authored code. Null when the
// mode has no commits.
export const ModeStats = z.object({
  commits: z.number().int().nonnegative(),
  // How many of `commits` are here only because of the `defaultMode` prior
  // (#25). Without this the per-level table and the observed-counts table
  // report different numbers for the same cohort with nothing to explain
  // the gap — found running evidtrail against varano-239, where the header said
  // `agent 5` and this table said `agent 16`.
  assumed: z.number().int().nonnegative(),
  persistence: Persistence,
});

export const ByMode = z.object({
  agent: ModeStats.nullable(),
  assisted: ModeStats.nullable(),
  autocomplete: ModeStats.nullable(),
  none: ModeStats.nullable(),
  unknown: ModeStats.nullable(),
});

// PR acceptance (#51): merged vs closed-unmerged, per cohort. Null when no
// pr-stream.json is present — an absent metric, never a silent 0%.
export const AcceptanceStats = z.object({
  total: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  acceptanceRate: z.number().min(0).max(1),
});

export const PRAcceptance = z.object({
  provider: z.string(),
  repo: z.string(),
  fetchedAt: z.string().datetime(),
  // True when the fetch was capped: rates describe a sample, not all history
  truncated: z.boolean(),
  overall: AcceptanceStats,
  byAttribution: z.object({
    ai: AcceptanceStats.nullable(),
    human: AcceptanceStats.nullable(),
    unknown: AcceptanceStats.nullable(),
  }),
  byMode: z.object({
    agent: AcceptanceStats.nullable(),
    assisted: AcceptanceStats.nullable(),
    autocomplete: AcceptanceStats.nullable(),
    none: AcceptanceStats.nullable(),
    unknown: AcceptanceStats.nullable(),
  }),
});

// Line-level survival (#23): the direct answer file-level persistence could
// only approximate. Share figures are exact for the living codebase; the
// survival rate is an approximation (blame cannot see deleted lines).
export const LineSurvival = z.object({
  filesBlamed: z.number().int().nonnegative(),
  filesSkipped: z.number().int().nonnegative(),
  // Paths where git blame errored: reported, never folded into filesSkipped
  filesFailed: z.number().int().nonnegative(),
  filesExcluded: z.number().int().nonnegative(),
  truncated: z.boolean(),
  totalLines: z.number().int().nonnegative(),
  // Lines written by commits outside the collected window: unattributable,
  // reported rather than folded into 'unknown'
  linesOutsideWindow: z.number().int().nonnegative(),
  byAttribution: z.object({
    ai: z.number().int().nonnegative(),
    human: z.number().int().nonnegative(),
    automated: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  byMode: z.object({
    none: z.number().int().nonnegative(),
    autocomplete: z.number().int().nonnegative(),
    assisted: z.number().int().nonnegative(),
    agent: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  aiShare: z.number().min(0).max(1),
  introducedByAI: z.number().int().nonnegative(),
  approxSurvivalRate: z.number().min(0).max(1),
});

// Repo-level quality (#77, step 1): the quality of the codebase as a
// property of the REPO, not of a cohort. Everything here is computable at
// 0% evidence coverage and is untouched by the `defaultMode` prior — the
// primary object in a world where cohorts are empty by default, with the
// cohort views below as optional overlays.
export const RepoQuality = z.object({
  // Authored commits: everything except automation (merge commits, release
  // bots). Automation is not authored code, whoever ran it.
  commitsAuthored: z.number().int().nonnegative(),
  commitsAutomated: z.number().int().nonnegative(),
  // Persistence and rework over ALL authored commits, cohort-free
  persistence: Persistence,
});

// Quality over time (#77, step 3): the comparator that replaces cohorts
// once "AI vs human" has no second side left. Derived from the commit stream
// in one run, so a trend exists on first use rather than after months of
// archived runs.
export const TrendGranularity = z.enum(['month', 'quarter']);

export const TrendPeriod = z.object({
  label: z.string(), // '2026-06' or '2026-Q2'
  start: z.string().datetime(),
  end: z.string().datetime(), // exclusive
  // Both denominators, stated: coverage spans every commit (automation has
  // known provenance), quality spans authored ones only.
  commitsTotal: z.number().int().nonnegative(),
  commitsAuthored: z.number().int().nonnegative(),
  // Null when the period contains no commits at all
  coverage: z.number().min(0).max(1).nullable(),
  // Null when the period has no authored commits. Every period is measured
  // through the same observation window, so periods are comparable with each
  // other rather than with the clock.
  persistence: Persistence.nullable(),
  // False until the period has been over for `observationDays`: its files
  // have not all had the full window yet, so it is reported but never
  // compared. Without this every report would find quality "declining".
  mature: z.boolean(),
});

export const TrendDelta = z.object({
  from: z.number(),
  to: z.number(),
  delta: z.number(),
});

export const Trend = z.object({
  granularity: TrendGranularity,
  observationDays: z.number().int().positive(),
  periods: z.array(TrendPeriod),
  // The two most recent MATURE periods. Null when fewer than two exist —
  // a young repo gets no trend rather than a trend built on one point.
  latestComparison: z
    .object({
      from: z.string(),
      to: z.string(),
      avgPersistenceDays: TrendDelta,
      reworkRate: TrendDelta.nullable(),
      rapidRetouchRate: TrendDelta.nullable(),
    })
    .nullable(),
});

export const Metrics = z.object({
  // Bumped when a field is removed or changes meaning (#53)
  schemaVersion: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  window: z.object({
    since: z.string().optional(),
    until: z.string().optional(),
  }),
  repoPath: z.string(),
  defaultBranch: z.string(),
  scope: z.enum(['default-branch', 'all-refs', 'pr']),
  headSha: z.string(),
  attribution: Attribution,
  // Repo-level quality (#77): cohort-free, prior-free, the primary object
  repo: RepoQuality,
  // The same quality, over time (#77 step 3)
  trend: Trend,
  persistence: Persistence,
  // Fairness context (#29, #36): age and task mix per cohort, so consumers
  // can judge whether the AI-vs-baseline comparison is apples-to-apples.
  cohorts: z.object({
    ai: CohortContext,
    baseline: CohortContext,
  }),
  byMode: ByMode,
  // Age-normalized AI vs Baseline (#29). Same nullability as `baseline`.
  fairComparison: FairComparison.nullable(),
  // Per-file-category AI vs Baseline (#36 step 2). Always present; each
  // category's sides are independently null when that cohort touched no
  // files of that kind.
  byCategory: ByCategory,
  // Reverts and hotfixes linked to the commit(s) they respond to (#26).
  // Always present — a property of the repo, not a cohort comparison.
  outcomeCorrelation: OutcomeCorrelation,
  // Null unless `evidtrail fetch-prs` produced a pr-stream.json (#51)
  prAcceptance: PRAcceptance.nullable(),
  // Null unless `evidtrail blame` produced a blame-stream.json (#23)
  lineSurvival: LineSurvival.nullable(),
  // Null when no commit sits at autonomy level 'none' and no defaultMode prior
  // assigns the unknowns: evidtrail does not invent a comparison cohort.
  baseline: Baseline.nullable(),
  delta: Delta.nullable(),
  caveats: z.array(z.string()),
});

export type Attribution = z.infer<typeof Attribution>;
export type RecentCoverage = z.infer<typeof RecentCoverage>;
export type EvidenceGap = z.infer<typeof EvidenceGap>;
export type Rework = z.infer<typeof Rework>;
export type RapidRetouch = z.infer<typeof RapidRetouch>;
export type AgeStats = z.infer<typeof AgeStats>;
export type FileCategory = z.infer<typeof FileCategory>;
export type CategoryCounts = z.infer<typeof CategoryCounts>;
export type CohortContext = z.infer<typeof CohortContext>;
export type ModeStats = z.infer<typeof ModeStats>;
export type ByMode = z.infer<typeof ByMode>;
export type AcceptanceStats = z.infer<typeof AcceptanceStats>;
export type PRAcceptance = z.infer<typeof PRAcceptance>;
export type FairComparison = z.infer<typeof FairComparison>;
export type CategoryPersistence = z.infer<typeof CategoryPersistence>;
export type CategoryComparison = z.infer<typeof CategoryComparison>;
export type ByCategory = z.infer<typeof ByCategory>;
export type OutcomeRate = z.infer<typeof OutcomeRate>;
export type RevertStats = z.infer<typeof RevertStats>;
export type HotfixStats = z.infer<typeof HotfixStats>;
export type OutcomeCorrelation = z.infer<typeof OutcomeCorrelation>;
export type LineSurvival = z.infer<typeof LineSurvival>;
export type Persistence = z.infer<typeof Persistence>;
export type RepoQuality = z.infer<typeof RepoQuality>;
export type Baseline = z.infer<typeof Baseline>;
export type Delta = z.infer<typeof Delta>;
export type TrendGranularity = z.infer<typeof TrendGranularity>;
export type TrendPeriod = z.infer<typeof TrendPeriod>;
export type Trend = z.infer<typeof Trend>;
export type Metrics = z.infer<typeof Metrics>;
