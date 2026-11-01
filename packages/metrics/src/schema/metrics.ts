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
  // The repository's configured `defaultMode`, recorded for context; null
  // when none is set. The hook stamps it on new commits; analysis never
  // applies it to old ones, so it moves no number in this file.
  defaultMode: z.enum(['none', 'autocomplete', 'assisted', 'agent']).nullable(),
  coverageThreshold: z.number().min(0).max(1),
  belowThreshold: z.boolean(), // all-time; see `recent` for the actionable one
  // Null when the window contains no commits (#52)
  recent: RecentCoverage.nullable(),
  // AI commits whose evidence names a tool but no autonomy level. They count
  // toward coverage (involvement is known) and sit in `modes.unknown` (the
  // level is not) — the two figures disagree on purpose, and this number is
  // what reconciles them: 100% coverage is not 100% known autonomy.
  aiModeUnknown: z.number().int().nonnegative().optional(),
  // AI commits that carry an `AI-Session:` trailer, and how many distinct
  // sessions they point to. A link is an address, not evidence about the
  // session: nothing here is read from a transcript.
  sessions: z
    .object({
      linked: z.number().int().nonnegative(),
      distinct: z.number().int().nonnegative(),
    })
    .optional(),
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

// Fixed-horizon rapid retouch (the 1.0 metric contract): among files whose
// outcome by day N is known, how many were touched again? Files that have
// not yet reached N are stated separately, never folded into the rate.
export const RapidRetouch = z.object({
  windowDays: z.number().int().positive(),
  retouched: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(),
  tooRecent: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1).nullable(),
});

// Change signals for a set of authored commits: how often the files they
// first touched were touched again. Migrations and generated files are
// excluded by default: their lifecycle is convention-driven. The pre-1.0
// follow-up summaries (average, median, buckets, censored count) and the
// 7-day `rework` block were removed in schema v4: the averages mixed event
// durations with censored follow-up, and `rework` was the 7-day rapid
// retouch under a second name.
export const Persistence = z.object({
  commitsConsidered: z.number().int().nonnegative(),
  filesConsidered: z.number().int().nonnegative(),
  filesExcluded: z.number().int().nonnegative(),
  rapidRetouch: z.array(RapidRetouch),
});

// File categories decide which files the change signals exclude by default
// (migrations, generated). Exported for consumers that categorise paths the
// same way.
export const FileCategory = z.enum([
  'source',
  'tests',
  'migrations',
  'config',
  'docs',
  'generated',
]);

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

// Repository change signals (#77, step 1): a property of the REPO, not of a
// cohort. Computable at 0% evidence coverage, and nothing in it depends on
// attribution.
export const RepoQuality = z.object({
  // Authored commits: everything except automation (merge commits, release
  // bots). Automation is not authored code, whoever ran it.
  commitsAuthored: z.number().int().nonnegative(),
  commitsAutomated: z.number().int().nonnegative(),
  // Rapid retouch over ALL authored commits, cohort-free
  persistence: Persistence,
});

// Change signals over time (#77, step 3): the repo compared with its own
// past, the only comparison left once "AI vs human" has no second side. Derived from the commit stream
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
  // compared. Without this every report would find retouch "rising".
  mature: z.boolean(),
});

export const TrendDelta = z.object({
  from: z.number(),
  to: z.number(),
  delta: z.number(),
});

// Whether the two compared periods are comparable by SIZE (#102). Maturity
// answers "have both had the same time?"; this answers "is there enough in
// each, and are they alike enough, for a delta to mean anything?". Found on
// this repository: 5 commits/18 files against 18 commits/53 files, with two
// empty months between, rendered as a +60.9 pt quality change. The delta
// is still computed — labelling, never substituting a friendlier pair.
export const TrendComparability = z.object({
  eligible: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }),
  commits: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }),
  minEligible: z.number().int().positive(),
  maxSizeRatio: z.number().positive(),
  // ok: sizes alike and sufficient · weak: sizes differ beyond maxSizeRatio
  // · insufficient: a side has fewer than minEligible eligible files
  status: z.enum(['ok', 'weak', 'insufficient']),
  reasons: z.array(z.string()),
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
      rapidRetouchRate: TrendDelta.nullable(),
      // Additive (#102): absent in artifacts written before it existed
      comparability: TrendComparability.optional(),
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
    // The instant every elapsed-time measurement runs to: the stream's
    // generation time, or its `until` bound when that is earlier. Written so
    // a reader of the artifact can tell which one applied.
    observationEnd: z.string().datetime().optional(),
  }),
  repoPath: z.string(),
  defaultBranch: z.string(),
  scope: z.enum(['default-branch', 'all-refs', 'pr']),
  headSha: z.string(),
  attribution: Attribution,
  // Repository change signals (#77): cohort-free and attribution-free
  repo: RepoQuality,
  // The same signals, over time (#77 step 3)
  trend: Trend,
  // Reverts and hotfixes linked to the commit(s) they respond to (#26).
  // Always present — a property of the repo, not a cohort comparison.
  outcomeCorrelation: OutcomeCorrelation,
  // Null unless `evidtrail fetch-prs` produced a pr-stream.json (#51)
  prAcceptance: PRAcceptance.nullable(),
  // Null unless `evidtrail blame` produced a blame-stream.json (#23)
  lineSurvival: LineSurvival.nullable(),
  caveats: z.array(z.string()),
});

export type Attribution = z.infer<typeof Attribution>;
export type RecentCoverage = z.infer<typeof RecentCoverage>;
export type EvidenceGap = z.infer<typeof EvidenceGap>;
export type RapidRetouch = z.infer<typeof RapidRetouch>;
export type FileCategory = z.infer<typeof FileCategory>;
export type AcceptanceStats = z.infer<typeof AcceptanceStats>;
export type PRAcceptance = z.infer<typeof PRAcceptance>;
export type OutcomeRate = z.infer<typeof OutcomeRate>;
export type RevertStats = z.infer<typeof RevertStats>;
export type HotfixStats = z.infer<typeof HotfixStats>;
export type OutcomeCorrelation = z.infer<typeof OutcomeCorrelation>;
export type LineSurvival = z.infer<typeof LineSurvival>;
export type Persistence = z.infer<typeof Persistence>;
export type RepoQuality = z.infer<typeof RepoQuality>;
export type TrendGranularity = z.infer<typeof TrendGranularity>;
export type TrendPeriod = z.infer<typeof TrendPeriod>;
export type TrendComparability = z.infer<typeof TrendComparability>;
export type Trend = z.infer<typeof Trend>;
export type Metrics = z.infer<typeof Metrics>;
