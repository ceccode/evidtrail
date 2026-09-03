import { Commit, CommitStream } from '@evidtrail/core';
import { categorizeFile } from './cohort.js';
import { FileCategory, Persistence } from './schema/metrics.js';

// Categories whose lifecycle is governed by convention, not code quality:
// migrations are append-only (never modified once applied), generated files
// (lockfiles, changelogs) churn on every release regardless of author.
// Either way their survival carries no signal, so they are excluded from
// persistence by default. They still appear in the task-mix table.
export const DEFAULT_PERSISTENCE_EXCLUDED_CATEGORIES: FileCategory[] = [
  'migrations',
  'generated',
];

export const DEFAULT_REWORK_WINDOW_DAYS = 7;
export const DEFAULT_RAPID_RETOUCH_HORIZONS = [7, 30, 90] as const;

export interface PersistenceOptions {
  excludeCategories?: FileCategory[];
  // Window for the rework rate (#22)
  reworkWindowDays?: number;
  // End of the observation window, used to measure censored files (never
  // modified again). Defaults to the stream's collection time.
  observationEnd?: Date;
  // Age-normalization (#29): cap each file's observation window to at most
  // this many days from its first target-cohort touch. Without this, an
  // older cohort accumulates persistence simply by having existed longer —
  // capping both cohorts to the same span (typically the younger cohort's
  // age) makes the comparison fair rather than a clock-time artifact.
  maxObservationDays?: number;
  // Task-mix stratification (#36): restrict file consideration to a single
  // category, bypassing excludeCategories (the caller is explicitly asking
  // for that category's own data, generated/migrations included).
  onlyCategory?: FileCategory;
  // Fixed horizons whose outcomes are reported without mixing censored
  // follow-up with event durations.
  retouchHorizons?: number[];
}

interface FileLifecycle {
  firstTargetIndex: number;
  firstTargetDate: Date;
  // Set when a later commit modifies or deletes the file: survival ends
  eventDate: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function elapsedDays(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

// Persistence = survival: days from the first target-cohort touch of a file
// until the FIRST subsequent modification (or deletion) by any commit.
// Files never touched again are censored at the observation end — they
// survived the whole window, which is the best possible outcome, not zero.
export function calculatePersistence(
  commitStream: CommitStream,
  isTarget: (commit: Commit) => boolean = (commit) => commit.tags.attribution === 'ai',
  options: PersistenceOptions = {}
): Persistence {
  const {
    excludeCategories = DEFAULT_PERSISTENCE_EXCLUDED_CATEGORIES,
    observationEnd = new Date(commitStream.generatedAt),
    reworkWindowDays = DEFAULT_REWORK_WINDOW_DAYS,
    maxObservationDays,
    onlyCategory,
    retouchHorizons = [...DEFAULT_RAPID_RETOUCH_HORIZONS],
  } = options;
  const excluded = new Set<FileCategory>(excludeCategories);

  const targetCommits = commitStream.commits.filter(isTarget);

  const empty: Persistence = {
    commitsConsidered: targetCommits.length,
    filesConsidered: 0,
    filesExcluded: 0,
    censored: 0,
    avgDays: 0,
    medianDays: 0,
    rework: null,
    rapidRetouch: retouchHorizons.map((windowDays) => ({
      windowDays,
      retouched: 0,
      eligible: 0,
      tooRecent: 0,
      rate: null,
    })),
    buckets: { d0_1: 0, d2_7: 0, d8_30: 0, d31_90: 0, d90_plus: 0 },
  };

  if (targetCommits.length === 0) {
    return { ...empty, commitsConsidered: 0 };
  }

  // Collection guarantees newest-first topological order. Reverse it to
  // define "subsequent" without letting a rewritten timestamp reorder the
  // graph. Committer time remains the elapsed-time proxy for integration.
  const sortedCommits = [...commitStream.commits].reverse();

  // First target-cohort touch per file
  const lifecycles = new Map<string, FileLifecycle>();
  let filesExcluded = 0;
  sortedCommits.forEach((commit, index) => {
    if (!isTarget(commit)) return;
    for (const file of commit.stats.files) {
      if (lifecycles.has(file.path)) continue;
      const category = categorizeFile(file.path);
      const isExcluded = onlyCategory ? category !== onlyCategory : excluded.has(category);
      if (isExcluded) {
        filesExcluded++;
        lifecycles.set(file.path, { firstTargetIndex: -1, firstTargetDate: new Date(0), eventDate: null });
        continue;
      }
      lifecycles.set(file.path, {
        firstTargetIndex: index,
        firstTargetDate: new Date(commit.committerDate),
        eventDate: null,
      });
    }
  });

  // First subsequent modification (or deletion) ends the survival clock
  sortedCommits.forEach((commit, index) => {
    for (const file of commit.stats.files) {
      const lifecycle = lifecycles.get(file.path);
      if (!lifecycle || lifecycle.firstTargetIndex < 0) continue; // excluded category
      if (index <= lifecycle.firstTargetIndex) continue; // not later than first touch
      if (lifecycle.eventDate === null) {
        lifecycle.eventDate = new Date(commit.committerDate);
      }
    }
  });

  const survivalDays: number[] = [];
  let censored = 0;
  // Rework accounting (#22). A file counts only when its outcome within the
  // window is *determined*: either it was reworked in time, or it was
  // observed for the full window without being touched. A file first seen
  // two days ago cannot answer a seven-day question either way.
  let reworked = 0;
  let determined = 0;
  let undetermined = 0;
  const horizonCounts = new Map(
    [...new Set(retouchHorizons)].sort((a, b) => a - b).map((windowDays) => [
      windowDays,
      { windowDays, retouched: 0, eligible: 0, tooRecent: 0 },
    ])
  );
  for (const lifecycle of lifecycles.values()) {
    if (lifecycle.firstTargetIndex < 0) continue; // excluded category

    // Age-normalization (#29): the window we're allowed to look through for
    // this file closes at either the real observation end, or capDays after
    // its first touch — whichever is sooner. An event beyond that point is
    // treated as not-yet-observed, exactly like a file with no event at all.
    const effectiveEnd =
      maxObservationDays !== undefined
        ? new Date(
            Math.min(
              observationEnd.getTime(),
              lifecycle.firstTargetDate.getTime() + maxObservationDays * 24 * 60 * 60 * 1000
            )
          )
        : observationEnd;
    const observedDays = elapsedDays(lifecycle.firstTargetDate, effectiveEnd);

    if (lifecycle.eventDate && lifecycle.eventDate <= effectiveEnd) {
      const survived = elapsedDays(lifecycle.firstTargetDate, lifecycle.eventDate);
      survivalDays.push(survived);
      determined++;
      if (survived <= reworkWindowDays) reworked++;
    } else {
      // No event within the effective window: censored there, whether
      // because the file was never touched again or the cap cut us off
      // before we could see what happens next.
      censored++;
      survivalDays.push(observedDays);
      if (observedDays >= reworkWindowDays) {
        determined++; // observed long enough to say "not reworked"
      } else {
        undetermined++; // too recent to judge
      }
    }

    for (const horizon of horizonCounts.values()) {
      const eventDays =
        lifecycle.eventDate && lifecycle.eventDate <= effectiveEnd
          ? elapsedDays(lifecycle.firstTargetDate, lifecycle.eventDate)
          : null;
      if (eventDays !== null && eventDays <= horizon.windowDays) {
        horizon.retouched++;
        horizon.eligible++;
      } else if (observedDays >= horizon.windowDays) {
        horizon.eligible++;
      } else {
        horizon.tooRecent++;
      }
    }
  }

  if (survivalDays.length === 0) {
    return { ...empty, filesExcluded };
  }

  const avgDays = survivalDays.reduce((sum, days) => sum + days, 0) / survivalDays.length;
  const sortedDays = [...survivalDays].sort((a, b) => a - b);
  const medianDays =
    sortedDays.length % 2 === 0
      ? (sortedDays[sortedDays.length / 2 - 1] + sortedDays[sortedDays.length / 2]) / 2
      : sortedDays[Math.floor(sortedDays.length / 2)];

  return {
    commitsConsidered: targetCommits.length,
    filesConsidered: survivalDays.length,
    filesExcluded,
    censored,
    avgDays: Math.round(avgDays * 100) / 100,
    medianDays: Math.round(medianDays * 100) / 100,
    rework:
      determined > 0
        ? {
            windowDays: reworkWindowDays,
            reworked,
            determined,
            undetermined,
            rate: Math.round((reworked / determined) * 10000) / 10000,
          }
        : null,
    rapidRetouch: [...horizonCounts.values()].map((horizon) => ({
      ...horizon,
      rate:
        horizon.eligible > 0
          ? Math.round((horizon.retouched / horizon.eligible) * 10000) / 10000
          : null,
    })),
    buckets: {
      d0_1: survivalDays.filter((days) => days <= 1).length,
      d2_7: survivalDays.filter((days) => days >= 2 && days <= 7).length,
      d8_30: survivalDays.filter((days) => days >= 8 && days <= 30).length,
      d31_90: survivalDays.filter((days) => days >= 31 && days <= 90).length,
      d90_plus: survivalDays.filter((days) => days > 90).length,
    },
  };
}

export function calculateBaselinePersistence(
  commitStream: CommitStream,
  isTarget: (commit: Commit) => boolean = (commit) => commit.tags.attribution === 'human',
  options: PersistenceOptions = {}
): Persistence {
  return calculatePersistence(commitStream, isTarget, options);
}
