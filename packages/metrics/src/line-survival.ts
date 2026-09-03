import { BlameStream, Commit, CommitStream } from '@evidtrail/core';
import { LineSurvival } from './schema/metrics.js';

// Line-level survival (#23). Joins blame output (sha → surviving lines) with
// the commit stream's attribution, answering the question file-level
// persistence could only approximate: of the code alive right now, who wrote
// it, and at what autonomy level?
//
// What this measures exactly: the living codebase. What it cannot measure:
// deleted lines — blame sees only what survived. So the *share* figures are
// exact, while `approxSurvivalRate` is explicitly an approximation, because
// its denominator (lines added by AI commits) counts every addition, and a
// line rewritten twice by AI was added twice.
//
// The denominator is scoped to `blamedPaths` — the files blame actually
// visited. It has to be: blame never covers the whole tree (generated files
// are excluded, --max-files caps the walk), so counting additions across
// every file divides a fraction of the repo by all of it. Found by running
// evidtrail against babel, where `--max-files 500` out of 27,648 files reported
// "1.7% of AI lines survive" — 453 files' worth of survivors over the whole
// history's worth of additions. The number was arithmetically correct and
// told the reader something false.
//
// Residual bias, stated rather than hidden: additions to a file that was
// later deleted or renamed fall outside `blamedPaths`, so they leave the
// denominator. That makes the rate "of AI lines added to files that still
// exist under the same path, how many survive" — a narrower question than
// it may appear, but one whose two halves finally match.

export function calculateLineSurvival(
  blameStream: BlameStream,
  commitStream: CommitStream
): LineSurvival {
  const byHash = new Map<string, Commit>(commitStream.commits.map((c) => [c.hash, c]));

  const byAttribution = { ai: 0, human: 0, automated: 0, unknown: 0 };
  const byMode = { none: 0, autocomplete: 0, assisted: 0, agent: 0, unknown: 0 };
  // Lines whose commit is outside the collected window (e.g. --since) can't
  // be attributed at all: counted separately rather than silently as unknown.
  let linesOutsideWindow = 0;

  for (const [sha, lines] of Object.entries(blameStream.linesBySha)) {
    const commit = byHash.get(sha);
    if (!commit) {
      linesOutsideWindow += lines;
      continue;
    }
    byAttribution[commit.tags.attribution] += lines;
    byMode[commit.tags.mode] += lines;
  }

  const attributedLines =
    byAttribution.ai + byAttribution.human + byAttribution.automated + byAttribution.unknown;

  // Denominator for the approximate survival rate: what AI commits added to
  // the files blame actually visited, within the collected window.
  const blamed = new Set(blameStream.blamedPaths);
  const introducedByAI = commitStream.commits
    .filter((c) => c.tags.attribution === 'ai')
    .reduce(
      (sum, c) =>
        sum +
        c.stats.files
          .filter((f) => blamed.has(f.path))
          .reduce((fileSum, f) => fileSum + f.additions, 0),
      0
    );

  return {
    filesBlamed: blameStream.filesBlamed,
    filesSkipped: blameStream.filesSkipped,
    filesFailed: blameStream.filesFailed,
    filesExcluded: blameStream.filesExcluded,
    truncated: blameStream.truncated,
    totalLines: blameStream.totalLines,
    linesOutsideWindow,
    byAttribution,
    byMode,
    aiShare: attributedLines > 0 ? round(byAttribution.ai / attributedLines, 4) : 0,
    introducedByAI,
    approxSurvivalRate:
      introducedByAI > 0 ? round(Math.min(1, byAttribution.ai / introducedByAI), 4) : 0,
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
