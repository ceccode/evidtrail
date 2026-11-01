import { Commit, CommitStream } from '@evidtrail/core';
import { observationEndOf } from './observation.js';
import { calculatePersistence } from './persistence.js';
import { Trend, TrendComparability, TrendGranularity, TrendPeriod } from './schema/metrics.js';

// Change signals over time (#77, step 3).
//
// Once AI participates in nearly every commit, "AI vs human" has no second
// side left to compare against. What can still be compared is the repo with
// its own past: are files touched again more or less often than before. That
// is a change in churn, not proof of a change in quality.
//
// Derived from the commit stream in a single run rather than from stored
// snapshots: a team gets a trend the first time they run evidtrail, instead of
// after months of collecting runs. Comparing archived `metrics.json` files
// remains possible on top of this and adds only what history cannot
// reconstruct.
//
// THE TRAP THIS IS BUILT AROUND: a period that ended yesterday has had one
// day to be reworked, while a period from last year has had a year. Compare
// them raw and every report ever generated says retouch is rising — an
// artifact of the clock, stated as a finding. Two mechanisms prevent it:
//
//   1. Every period is judged on the SAME fixed horizon (`observationDays`):
//      a file counts as retouched only if it was touched again within that
//      many days, so no period gets credit for time the others did not have.
//   2. A period is `mature` only once it ended at least `observationDays`
//      ago — before that, its files have not all had the full window. The
//      most recent periods are always immature; they are reported, marked,
//      and deliberately excluded from every comparison.

export const DEFAULT_TREND_OBSERVATION_DAYS = 30;
export const DEFAULT_TREND_MAX_PERIODS = 12;
// Size comparability (#102). Below `minEligible` files on either side the
// headline delta is withheld; beyond `maxSizeRatio` between the two sides
// (eligible files or authored commits) it is shown and labelled weak.
export const DEFAULT_TREND_MIN_ELIGIBLE = 10;
export const DEFAULT_TREND_MAX_SIZE_RATIO = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrendOptions {
  granularity?: TrendGranularity;
  // Equal observation window applied to every period (#29's mechanism)
  observationDays?: number;
  // Periods kept, most recent first. A 15-year repo has 180 months; a
  // hundred-row table is not a trend anyone reads.
  maxPeriods?: number;
  observationEnd?: Date;
  minEligible?: number;
  maxSizeRatio?: number;
}

// Two mature periods can still be a poor pair: a near-idle month against a
// month of intense work measures the change of pace as much as the change
// in code, and a handful of files cannot carry a percentage. Maturity is
// about time; this is about size. The pair is never swapped for a
// friendlier one — choosing the comparison to make it look valid would be
// worse than showing a labelled weak one.
function assessComparability(
  previous: TrendPeriod,
  latest: TrendPeriod,
  observationDays: number,
  minEligible: number,
  maxSizeRatio: number
): TrendComparability {
  const eligibleOf = (period: TrendPeriod) =>
    period.persistence?.rapidRetouch.find((r) => r.windowDays === observationDays)?.eligible ?? 0;
  const eligible = { from: eligibleOf(previous), to: eligibleOf(latest) };
  const commits = { from: previous.commitsAuthored, to: latest.commitsAuthored };
  const ratio = (a: number, b: number) => (Math.min(a, b) === 0 ? Infinity : Math.max(a, b) / Math.min(a, b));

  const reasons: string[] = [];
  for (const [label, value] of [[previous.label, eligible.from], [latest.label, eligible.to]] as const) {
    if (value < minEligible) reasons.push(`${label} has ${value} eligible file${value === 1 ? '' : 's'} (fewer than ${minEligible})`);
  }
  const status: TrendComparability['status'] = reasons.length > 0 ? 'insufficient' : 'ok';
  if (status === 'ok') {
    if (ratio(eligible.from, eligible.to) > maxSizeRatio) {
      reasons.push(`${eligible.from} vs ${eligible.to} eligible files (${round(ratio(eligible.from, eligible.to), 1)}×)`);
    }
    if (ratio(commits.from, commits.to) > maxSizeRatio) {
      reasons.push(`${commits.from} vs ${commits.to} commits (${round(ratio(commits.from, commits.to), 1)}×)`);
    }
  }
  return {
    eligible,
    commits,
    minEligible,
    maxSizeRatio,
    status: status === 'insufficient' ? 'insufficient' : reasons.length > 0 ? 'weak' : 'ok',
    reasons,
  };
}

function periodStart(date: Date, granularity: TrendGranularity): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return granularity === 'quarter'
    ? new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1))
    : new Date(Date.UTC(year, month, 1));
}

function nextPeriodStart(start: Date, granularity: TrendGranularity): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  return new Date(Date.UTC(year, month + (granularity === 'quarter' ? 3 : 1), 1));
}

function periodLabel(start: Date, granularity: TrendGranularity): string {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  return granularity === 'quarter'
    ? `${year}-Q${Math.floor(month / 3) + 1}`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateTrend(commitStream: CommitStream, options: TrendOptions = {}): Trend {
  const {
    granularity = 'month',
    observationDays = DEFAULT_TREND_OBSERVATION_DAYS,
    maxPeriods = DEFAULT_TREND_MAX_PERIODS,
    // A `--until` bound ends observation early; maturity below is judged
    // against it, so a month cut short by the bound stays immature instead
    // of entering the comparison with a truncated window.
    observationEnd = observationEndOf(commitStream),
    minEligible = DEFAULT_TREND_MIN_ELIGIBLE,
    maxSizeRatio = DEFAULT_TREND_MAX_SIZE_RATIO,
  } = options;

  const empty: Trend = {
    granularity,
    observationDays,
    periods: [],
    latestComparison: null,
  };

  const authored = commitStream.commits.filter((commit) => !commit.tags.automated);
  if (authored.length === 0) return empty;

  const earliest = new Date(
    Math.min(...authored.map((commit) => new Date(commit.committerDate).getTime()))
  );

  // Every calendar period from the first authored commit to the collection
  // time, including empty ones: a month nobody committed in is signal, and a
  // series with gaps closed up would misrepresent the spacing of the trend.
  const starts: Date[] = [];
  const lastStart = periodStart(observationEnd, granularity);
  for (
    let cursor = periodStart(earliest, granularity);
    cursor.getTime() <= lastStart.getTime();
    cursor = nextPeriodStart(cursor, granularity)
  ) {
    starts.push(cursor);
  }

  const periods: TrendPeriod[] = starts.slice(-maxPeriods).map((start) => {
    const end = nextPeriodStart(start, granularity);

    const inPeriod = (commit: Commit) => {
      const date = new Date(commit.committerDate);
      return date.getTime() >= start.getTime() && date.getTime() < end.getTime();
    };
    const isTarget = (commit: Commit) => !commit.tags.automated && inPeriod(commit);

    const periodCommits = commitStream.commits.filter(inPeriod);
    const authoredCommits = periodCommits.filter((commit) => !commit.tags.automated);

    // Both denominators are reported, because they differ: coverage is the
    // evidence axis over every commit (automation carries known provenance),
    // while quality is measured over authored code only. Two counts under
    // one heading with the difference left implicit is the defect this
    // project keeps finding in its own reports.
    const withEvidence = periodCommits.filter((commit) => commit.tags.evidence !== 'none').length;

    return {
      label: periodLabel(start, granularity),
      start: start.toISOString(),
      end: end.toISOString(),
      commitsTotal: periodCommits.length,
      commitsAuthored: authoredCommits.length,
      coverage:
        periodCommits.length > 0 ? round(withEvidence / periodCommits.length, 4) : null,
      persistence:
        authoredCommits.length > 0
          ? calculatePersistence(commitStream, isTarget, {
              observationEnd,
              retouchHorizons: [observationDays],
            })
          : null,
      // Not "has enough data" but "has had enough time": every file first
      // touched in a mature period has been observable for the full window.
      mature: observationEnd.getTime() - end.getTime() >= observationDays * DAY_MS,
    };
  });

  // The headline: the two most recent periods that can honestly be compared.
  // Immature periods are excluded here even though they are reported above —
  // showing them is informative, comparing them is not.
  const comparable = periods.filter((period) => period.mature && period.persistence !== null);
  const previous = comparable[comparable.length - 2];
  const latest = comparable[comparable.length - 1];

  const latestComparison =
    previous && latest
      ? {
          from: previous.label,
          to: latest.label,
          rapidRetouchRate: (() => {
            const from = previous.persistence!.rapidRetouch.find(
              (result) => result.windowDays === observationDays
            )?.rate;
            const to = latest.persistence!.rapidRetouch.find(
              (result) => result.windowDays === observationDays
            )?.rate;
            return from !== null && from !== undefined && to !== null && to !== undefined
              ? { from, to, delta: round(to - from, 4) }
              : null;
          })(),
          comparability: assessComparability(previous, latest, observationDays, minEligible, maxSizeRatio),
        }
      : null;

  return { granularity, observationDays, periods, latestComparison };
}
