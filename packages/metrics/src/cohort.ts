import { Commit, daysBetween } from '@evidtrail/core';
import { AgeStats, CategoryCounts, FileCategory } from './schema/metrics.js';

// Cohort age (#29): persistence comparisons between cohorts of different
// ages are misleading — old commits have had more time to accumulate
// survival. Reporting each cohort's age lets consumers judge fairness.
export function calculateAgeStats(commits: Commit[], now: Date): AgeStats | null {
  if (commits.length === 0) {
    return null;
  }

  const ages = commits
    .map((commit) => daysBetween(new Date(commit.committerDate), now))
    .sort((a, b) => a - b);

  const avg = ages.reduce((sum, days) => sum + days, 0) / ages.length;
  const median =
    ages.length % 2 === 0
      ? (ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2
      : ages[Math.floor(ages.length / 2)];

  return {
    commits: commits.length,
    avgAgeDays: Math.round(avg * 100) / 100,
    medianAgeDays: Math.round(median * 100) / 100,
  };
}

// File categorization (#36, step 1): AI is often pointed at boilerplate,
// tests, and migrations, which survive longer because nobody touches them.
// Reporting each cohort's category mix shows when an AI-vs-baseline
// comparison is apples-to-oranges. Order matters: first match wins.
export function categorizeFile(path: string): FileCategory {
  const lower = path.toLowerCase();
  const base = lower.split('/').pop() ?? lower;

  // Generated artifacts (lockfiles, changelogs, snapshots, build output)
  if (
    /^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|composer\.lock|cargo\.lock|gemfile\.lock|poetry\.lock|changelog(\.[a-z]+)?)$/.test(
      base
    ) ||
    /\.(snap|min\.js|min\.css)$/.test(base) ||
    /(^|\/)(dist|build|out|coverage|\.next|node_modules)\//.test(lower)
  ) {
    return 'generated';
  }

  if (
    /(^|\/)(__tests__|__mocks__|tests?|spec|e2e|cypress)\//.test(lower) ||
    /\.(test|spec)\.[a-z]+$/.test(base)
  ) {
    return 'tests';
  }

  if (/(^|\/)migrations?\//.test(lower)) {
    return 'migrations';
  }

  if (/\.(md|mdx|rst|adoc|txt)$/.test(base) || /(^|\/)docs?\//.test(lower)) {
    return 'docs';
  }

  if (
    base.startsWith('.') ||
    /\.(json|ya?ml|toml|ini|cfg|conf|env|properties)$/.test(base) ||
    /\.config\.[a-z]+$/.test(base) ||
    /(^|\/)(\.github|\.circleci|\.vscode|config)\//.test(lower) ||
    /^(dockerfile|makefile|tsconfig.*|eslint.*|prettier.*)/.test(base)
  ) {
    return 'config';
  }

  return 'source';
}

export function calculateCategoryCounts(commits: Commit[]): CategoryCounts | null {
  if (commits.length === 0) {
    return null;
  }

  const counts: CategoryCounts = {
    source: 0,
    tests: 0,
    migrations: 0,
    config: 0,
    docs: 0,
    generated: 0,
  };

  for (const commit of commits) {
    for (const file of commit.stats.files) {
      counts[categorizeFile(file.path)]++;
    }
  }

  return counts;
}
