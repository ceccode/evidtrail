import {
  AITagResult,
  tagFromAxes,
  Logger,
  PRCommit,
  PR_STREAM_SCHEMA_VERSION,
  PRStream,
  PullRequest,
  createAITagger,
} from '@evidtrail/core';

// GitHub PR fetcher for `evidtrail fetch-prs` (#51).
//
// Deliberately isolated in an opt-in command: `collect` stays git-only and
// offline. Nothing about the PR author is read
// or stored — only outcomes and the attribution of the PR's own commits.

const API_PAGE_SIZE = 100;

interface GitHubPR {
  number: number;
  state: string;
  draft?: boolean;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
}

interface GitHubPRCommit {
  sha: string;
  commit: { message: string };
  parents?: Array<{ sha: string }>;
}

export interface FetchPROptions {
  repo: string;
  token: string;
  apiUrl?: string;
  since?: Date;
  maxPRs?: number;
  aiPatterns?: string[];
  aiTools?: string[];
  aiTrailerDomains?: string[];
  aiBotBlocklist?: string[];
  logger?: Logger;
}

function sanitize(text: string, maxLength = 200): string {
  const sanitized = text
    .replace(/gh[pous]_[A-Za-z0-9_]+/g, '[REDACTED]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}...(truncated)` : sanitized;
}

export class GitHubPRFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'GitHubPRFetchError';
  }
}

async function apiGet<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    const body = sanitize(await response.text());
    // Rate limiting deserves a distinguishable message: the fix is waiting,
    // not fixing the token.
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (response.status === 403 && remaining === '0') {
      const reset = response.headers.get('x-ratelimit-reset');
      const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown';
      throw new GitHubPRFetchError(
        `GitHub API rate limit exhausted (resets at ${resetAt}). Retry later or narrow the window with --since.`,
        response.status
      );
    }
    throw new GitHubPRFetchError(`GitHub API ${response.status}: ${body}`, response.status);
  }

  return (await response.json()) as T;
}

export async function fetchClosedPRs(options: FetchPROptions): Promise<PRStream> {
  const {
    repo,
    token,
    apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com',
    since,
    maxPRs,
    aiPatterns = [],
    aiTools = [],
    aiTrailerDomains = [],
    aiBotBlocklist = [],
    logger,
  } = options;

  // Same tagging rules as `collect`, applied to the PR's own commit messages
  const tagger = createAITagger({
    patterns: aiPatterns,
    tools: aiTools,
    trailerDomains: aiTrailerDomains,
    botBlocklist: aiBotBlocklist,
  });

  const prs: PullRequest[] = [];
  let page = 1;
  let truncated = false;

  while (true) {
    const url = `${apiUrl}/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${API_PAGE_SIZE}&page=${page}`;
    const batch = await apiGet<GitHubPR[]>(url, token);
    if (batch.length === 0) break;

    for (const pr of batch) {
      if (!pr.closed_at) continue; // still open despite the filter
      if (pr.draft) continue; // no terminal acceptance outcome for draft work

      if (since && new Date(pr.closed_at) < since) {
        // The endpoint is sorted by updated_at, not closed_at. Keep scanning:
        // a later page can still contain a recently closed PR.
        continue;
      }

      if (maxPRs && prs.length >= maxPRs) {
        truncated = true;
        break;
      }

      const commits: GitHubPRCommit[] = [];
      let commitPage = 1;
      let commitsComplete = true;
      while (true) {
        const commitBatch = await apiGet<GitHubPRCommit[]>(
          `${apiUrl}/repos/${repo}/pulls/${pr.number}/commits?per_page=${API_PAGE_SIZE}&page=${commitPage}`,
          token
        );
        commits.push(...commitBatch);
        if (commitBatch.length < API_PAGE_SIZE) break;
        // GitHub documents a hard maximum of 250 commits for this endpoint.
        if (commits.length >= 250 || commitPage >= 3) {
          commitsComplete = false;
          commits.splice(250);
          break;
        }
        commitPage++;
      }
      if (commits.length >= 250) commitsComplete = false;
      if (!commitsComplete) truncated = true;

      const taggedCommits: PRCommit[] = commits.map((commit) => {
        let tags: AITagResult = tagger(commit.commit.message);
        if (tags.evidence === 'none' && (commit.parents?.length ?? 0) > 1) {
          // Merge commits inside a PR branch are automation, not authored work
          tags = tagFromAxes({ mode: 'none', evidence: 'inferred', automated: true }, 'none', [
            ...tags.sources,
            'automated:merge-commit',
          ]);
        }
        return { sha: commit.sha, tags };
      });

      prs.push({
        number: pr.number,
        state: pr.merged_at ? 'merged' : 'closed',
        createdAt: new Date(pr.created_at).toISOString(),
        closedAt: new Date(pr.closed_at).toISOString(),
        mergedAt: pr.merged_at ? new Date(pr.merged_at).toISOString() : null,
        commits: taggedCommits,
        commitsComplete,
      });
    }

    logger?.info(`Fetched ${prs.length} closed PR(s)...`);
    if (maxPRs && prs.length >= maxPRs) {
      if (batch.length === API_PAGE_SIZE) truncated = true;
      break;
    }
    if (batch.length < API_PAGE_SIZE) break;
    page++;
  }

  return {
    schemaVersion: PR_STREAM_SCHEMA_VERSION,
    provider: 'github',
    repo,
    fetchedAt: new Date().toISOString(),
    since: since?.toISOString(),
    truncated,
    prs,
  };
}
