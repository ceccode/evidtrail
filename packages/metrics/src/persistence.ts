import { Commit, CommitStream } from '@evidtrail/core';
import { categorizeFile } from './file-category.js';
import { observationEndOf } from './observation.js';
import { FileCategory, Persistence } from './schema/metrics.js';

// Categories whose lifecycle is governed by convention, not code quality:
// migrations are append-only (never modified once applied), generated files
// (lockfiles, changelogs) churn on every release regardless of author.
// Either way a retouch carries no signal, so they are excluded by default.
export const DEFAULT_PERSISTENCE_EXCLUDED_CATEGORIES: FileCategory[] = [
  'migrations',
  'generated',
];

export const DEFAULT_RAPID_RETOUCH_HORIZONS = [7, 30, 90] as const;

export interface PersistenceOptions {
  excludeCategories?: FileCategory[];
  // End of the observation window. Defaults to the stream's collection time,
  // or to its `--until` bound when that is earlier — see `observationEndOf`.
  observationEnd?: Date;
  // Fixed horizons whose outcomes are reported, each with its own
  // eligible and too-recent counts.
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

// A file's lifecycle runs from its first touch by a target commit until the
// FIRST subsequent modification (or deletion) by any commit. For each fixed
// horizon N, the file is retouched (event within N days), eligible (event
// within N, or observed event-free for N days), or too recent.
export function calculatePersistence(
  commitStream: CommitStream,
  isTarget: (commit: Commit) => boolean = (commit) => !commit.tags.automated,
  options: PersistenceOptions = {}
): Persistence {
  const {
    excludeCategories = DEFAULT_PERSISTENCE_EXCLUDED_CATEGORIES,
    observationEnd = observationEndOf(commitStream),
    retouchHorizons = [...DEFAULT_RAPID_RETOUCH_HORIZONS],
  } = options;
  const excluded = new Set<FileCategory>(excludeCategories);

  const targetCommits = commitStream.commits.filter(isTarget);

  const empty: Persistence = {
    commitsConsidered: targetCommits.length,
    filesConsidered: 0,
    filesExcluded: 0,
    rapidRetouch: retouchHorizons.map((windowDays) => ({
      windowDays,
      retouched: 0,
      eligible: 0,
      tooRecent: 0,
      rate: null,
    })),
  };

  if (targetCommits.length === 0) {
    return { ...empty, commitsConsidered: 0 };
  }

  // Collection guarantees newest-first topological order. Reverse it to
  // define "subsequent" without letting a rewritten timestamp reorder the
  // graph. Committer time remains the elapsed-time proxy for integration.
  const sortedCommits = [...commitStream.commits].reverse();

  // One chronological pass: a file's lifecycle opens at its first
  // target-cohort touch and closes at the first later touch by anyone.
  //
  // A lifecycle is keyed by path, and paths move. When a commit renames a
  // file, the lifecycle follows it to the new name — otherwise the move
  // opened a second, empty lifecycle under the new name while the old one
  // sat untouched forever, and the file's real edits counted against
  // neither. A pure rename (no lines changed) is not a touch: nothing about
  // the code happened, only its address. A rename that also edits is.
  const lifecycles = new Map<string, FileLifecycle>();
  let filesExcluded = 0;
  sortedCommits.forEach((commit, index) => {
    const target = isTarget(commit);
    for (const file of commit.stats.files) {
      let isTouch = true;
      if (file.previousPath !== undefined) {
        const carried = lifecycles.get(file.previousPath);
        if (carried) {
          lifecycles.delete(file.previousPath);
          if (!lifecycles.has(file.path)) lifecycles.set(file.path, carried);
        }
        isTouch = file.additions + file.deletions > 0;
      }
      if (!isTouch) continue;

      const lifecycle = lifecycles.get(file.path);
      if (!lifecycle) {
        if (!target) continue; // not yet in the cohort's story
        const category = categorizeFile(file.path);
        if (excluded.has(category)) {
          filesExcluded++;
          lifecycles.set(file.path, { firstTargetIndex: -1, firstTargetDate: new Date(0), eventDate: null });
          continue;
        }
        lifecycles.set(file.path, {
          firstTargetIndex: index,
          firstTargetDate: new Date(commit.committerDate),
          eventDate: null,
        });
        continue;
      }
      if (lifecycle.firstTargetIndex < 0) continue; // excluded category
      if (index <= lifecycle.firstTargetIndex) continue; // not later than first touch
      if (lifecycle.eventDate === null) {
        lifecycle.eventDate = new Date(commit.committerDate);
      }
    }
  });

  let filesConsidered = 0;
  const horizonCounts = new Map(
    [...new Set(retouchHorizons)].sort((a, b) => a - b).map((windowDays) => [
      windowDays,
      { windowDays, retouched: 0, eligible: 0, tooRecent: 0 },
    ])
  );
  for (const lifecycle of lifecycles.values()) {
    if (lifecycle.firstTargetIndex < 0) continue; // excluded category
    filesConsidered++;

    const observedDays = elapsedDays(lifecycle.firstTargetDate, observationEnd);

    for (const horizon of horizonCounts.values()) {
      const eventDays =
        lifecycle.eventDate && lifecycle.eventDate <= observationEnd
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

  if (filesConsidered === 0) {
    return { ...empty, filesExcluded };
  }

  return {
    commitsConsidered: targetCommits.length,
    filesConsidered,
    filesExcluded,
    rapidRetouch: [...horizonCounts.values()].map((horizon) => ({
      ...horizon,
      rate:
        horizon.eligible > 0
          ? Math.round((horizon.retouched / horizon.eligible) * 10000) / 10000
          : null,
    })),
  };
}
