import { DEFAULT_BOT_BLOCKLIST } from './ai-tags.js';

// Automated detection (#39): merge commits and bot-authored commits are
// automation, not authored code. Their provenance is KNOWN — counting them
// as 'unknown' misreads a bookkeeping artifact as a data-quality gap, and
// counting them as authored work inflates every change signal.
// Applied only when message heuristics found no AI signal: in-commit
// evidence always wins.

export interface AutomatedCheckInput {
  parents: string[];
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
}

export function createAutomatedDetector(
  botBlocklist: string[] = []
): (commit: AutomatedCheckInput) => string | null {
  const allBots = [...DEFAULT_BOT_BLOCKLIST, ...botBlocklist];
  const botRegex = allBots.length ? new RegExp(`\\b(${allBots.join('|')})\\b`, 'i') : null;

  // Returns the matched source label, or null when not automated
  return (commit: AutomatedCheckInput): string | null => {
    if (commit.parents.length > 1) {
      return 'automated:merge-commit';
    }
    if (
      botRegex &&
      (botRegex.test(commit.authorName) ||
        botRegex.test(commit.authorEmail) ||
        botRegex.test(commit.committerName) ||
        botRegex.test(commit.committerEmail))
    ) {
      return 'automated:bot';
    }
    return null;
  };
}
