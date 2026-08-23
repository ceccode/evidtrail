import { simpleGit, SimpleGit } from 'simple-git';
import { Commit, CommitStream } from '../schema/commit.js';
import { COMMIT_STREAM_SCHEMA_VERSION } from '../schema/version.js';
import { createAITagger, tagFromAxes } from '../tags/ai-tags.js';
import { createAutomatedDetector } from '../tags/automated.js';
import {
  applyManifest,
  indexManifest,
  loadAttributionManifest,
  unmatchedManifestHashes,
} from '../tags/attribution-manifest.js';
import { createRedactor } from '../tags/redact.js';
import { logWithStats } from './log.js';
import { parseRelativeDate, formatISODate } from '../utils/dates.js';
import { Logger } from '../utils/log.js';

export interface CollectOptions {
  repoPath: string;
  since?: string;
  until?: string;
  diffBase?: string;
  aiPatterns?: string[];
  aiTools?: string[];
  aiTrailerDomains?: string[];
  aiBotBlocklist?: string[];
  defaultBranch?: string;
  scope?: 'default-branch' | 'all-refs';
  redactAuthors?: boolean;
  logger?: Logger;
}

// The synthetic merge commit `actions/checkout` creates for `pull_request`
// events (refs/pull/N/merge): it exists only in the CI checkout, is authored
// by nobody, and would otherwise inflate every PR-scoped report (#40).
const SYNTHETIC_MERGE_SUBJECT = /^Merge [0-9a-f]{7,40} into [0-9a-f]{7,40}$/;

function isSyntheticPRMerge(commit: { parents: string[]; message: string }): boolean {
  return commit.parents.length > 1 && SYNTHETIC_MERGE_SUBJECT.test(commit.message.split('\n')[0].trim());
}

// The line `git revert` writes into the body of the revert commit it
// generates: the only reliable link back to what was reverted (#26).
const REVERT_TARGET = /This reverts commit ([0-9a-f]{7,40})/i;

// Refs supplied on the command line or by CI environment variables become
// arguments to Git. They are data, never options: accepting a leading dash
// would let an untrusted value alter Git's invocation. This is deliberately
// narrower than full ref validation because Git still resolves normal branch
// names and object IDs; AIDA only needs to reject option-shaped input.
function assertSafeRefArgument(value: string | undefined, name: string): void {
  if (value?.startsWith('-') || value?.includes('\0')) {
    throw new Error(`Invalid ${name}: Git refs must not start with '-' or contain NUL bytes.`);
  }
}

export async function isEmptyRepository(git: SimpleGit): Promise<boolean> {
  try {
    return (await git.raw(['rev-list', '--count', '--all'])).trim() === '0';
  } catch {
    return false;
  }
}

export async function isShallowRepository(git: SimpleGit): Promise<boolean> {
  try {
    return (await git.raw(['rev-parse', '--is-shallow-repository'])).trim() === 'true';
  } catch {
    // Older git without the flag: assume complete rather than cry wolf
    return false;
  }
}

export async function detectDefaultBranch(git: SimpleGit): Promise<string> {
  try {
    // Try to get the default branch from origin/HEAD
    const result = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    const match = result.match(/refs\/remotes\/origin\/(.+)/);
    if (match) {
      return match[1].trim();
    }
  } catch {
    // Fallback logic
  }

  // Fallback to common branch names
  const branches = await git.branch(['-r']);
  if (branches.all.includes('origin/main')) {
    return 'main';
  }
  if (branches.all.includes('origin/master')) {
    return 'master';
  }

  // Repositories without a remote are common locally. A feature checkout
  // must not redefine the default branch merely because origin/HEAD is
  // absent; prefer conventional local integration branches first.
  const localBranches = await git.branchLocal();
  if (localBranches.all.includes('main')) return 'main';
  if (localBranches.all.includes('master')) return 'master';

  // Last resort: use current branch
  return localBranches.current || 'main';
}

// When origin/HEAD exists, it names the integration branch the repository
// publishes. Prefer that remote-tracking ref over a same-named local branch:
// a local `main` can be stale while a feature checkout is current, and a
// report silently reading the stale ref would be arithmetically correct but
// describe the wrong snapshot.
async function originDefaultRef(git: SimpleGit): Promise<string | null> {
  try {
    return (await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])).trim();
  } catch {
    return null;
  }
}

async function resolveDefaultBranchRef(
  git: SimpleGit,
  defaultBranch: string,
  preferOrigin: boolean
): Promise<string> {
  const remote = preferOrigin ? await originDefaultRef(git) : null;
  const candidates = remote
    ? [remote, defaultBranch]
    : [defaultBranch, `origin/${defaultBranch.replace(/^origin\//, '')}`];

  for (const candidate of candidates) {
    try {
      await git.raw(['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // Try the next valid representation of the requested branch.
    }
  }

  throw new Error(`Could not resolve default branch '${defaultBranch}' locally or from origin.`);
}

export async function collectCommits(options: CollectOptions): Promise<CommitStream> {
  const {
    repoPath,
    since,
    until,
    diffBase,
    aiPatterns = [],
    aiTools = [],
    aiTrailerDomains = [],
    aiBotBlocklist = [],
    defaultBranch: providedDefaultBranch,
    scope: requestedScope = 'default-branch',
    redactAuthors = false,
    logger,
  } = options;

  // These can originate outside the repository: explicit CLI flags and CI
  // base-ref detection. Validate before any Git command receives them.
  assertSafeRefArgument(providedDefaultBranch, 'default branch');
  assertSafeRefArgument(diffBase, 'diff base');

  const git = simpleGit(repoPath);

  // An empty repository has no HEAD, so every later git call fails with a
  // raw "ambiguous argument" error. Return a valid empty stream instead:
  // nothing to measure is a legitimate answer, not a crash.
  if (await isEmptyRepository(git)) {
    logger?.warn('Repository has no commits yet — nothing to collect.');
    return {
      schemaVersion: COMMIT_STREAM_SCHEMA_VERSION,
      repoPath,
      defaultBranch: providedDefaultBranch ?? 'main',
      scope: diffBase ? 'pr' : requestedScope,
      headSha: '',
      generatedAt: formatISODate(new Date()),
      since,
      until,
      aiPatterns: [...aiPatterns],
      commits: [],
    };
  }

  // A shallow clone silently truncates history, so every metric would
  // describe a fragment while looking like a full report. `actions/checkout`
  // defaults to `fetch-depth: 1`, which makes this the single most likely
  // way for a CI run to produce confidently wrong numbers.
  if (await isShallowRepository(git)) {
    logger?.warn(
      'This is a SHALLOW clone: history is truncated, so all metrics describe only the fetched commits. ' +
        'Set `fetch-depth: 0` in actions/checkout (or `GIT_DEPTH: 0` in GitLab CI) for meaningful results.'
    );
  }

  // Detect default branch
  const defaultBranch = providedDefaultBranch || (await detectDefaultBranch(git));
  logger?.info(`Using default branch: ${defaultBranch}`);

  // An explicit --default-branch is an operator choice. Otherwise, prefer
  // origin/HEAD when present so local stale branches cannot redefine the
  // default report's commit universe.
  const defaultBranchRef = await resolveDefaultBranchRef(
    git,
    defaultBranch,
    providedDefaultBranch === undefined
  );

  const scope = diffBase ? 'pr' : requestedScope;

  // Parse dates once (avoids duplicate parsing and timestamp drift)
  const sinceDate = since ? parseRelativeDate(since) : undefined;
  const untilDate = until ? parseRelativeDate(until) : undefined;

  let rangeArgs: string[];

  if (diffBase) {
    // PR-scoped mode: collect only commits between diffBase and HEAD
    logger?.info(`PR-scoped analysis: ${diffBase}..HEAD`);
    rangeArgs = [`${diffBase}..HEAD`];
  } else {
    // Standard reports describe integrated history. Walking every ref is
    // still available for exploration, but must be requested explicitly:
    // stale feature branches otherwise change a production-looking metric.
    logger?.info(
      `Collecting ${scope === 'all-refs' ? 'all refs' : defaultBranch} from ${sinceDate?.toISOString() || 'beginning'} to ${untilDate?.toISOString() || 'latest reachable commit'}`
    );
    rangeArgs = scope === 'all-refs' ? ['--all'] : [defaultBranchRef];
    if (sinceDate) {
      rangeArgs.push(`--after=${sinceDate.toISOString()}`);
    }
    if (untilDate) {
      rangeArgs.push(`--before=${untilDate.toISOString()}`);
    }
  }

  // Single batched pass: metadata, parents, and diff stats for all commits
  const rawCommits = await logWithStats(git, rangeArgs);
  logger?.info(
    `Found ${rawCommits.length} commits${diffBase ? ' in PR' : scope === 'all-refs' ? ' across all refs' : ` on ${defaultBranch}`}`
  );

  // Get the set of commit hashes reachable from the default branch
  let defaultBranchHashes: Set<string>;
  if (diffBase) {
    // In PR mode compare against diffBase (e.g. `origin/main`), not the bare
    // default-branch name — a PR checkout only has the remote-tracking ref, so
    // `main` is unresolvable while `origin/main` exists.
    try {
      const mergeBase = (await git.raw(['merge-base', diffBase, 'HEAD'])).trim();
      const bounded = (await git.raw(['rev-list', `${mergeBase}..${diffBase}`])).trim().split('\n').filter(Boolean);
      // Include merge-base itself
      bounded.push(mergeBase);
      defaultBranchHashes = new Set(bounded);
    } catch {
      // Fallback: full rev-list if merge-base fails (e.g., unrelated histories)
      const all = (await git.raw(['rev-list', diffBase])).trim().split('\n').filter(Boolean);
      defaultBranchHashes = new Set(all);
    }
  } else {
    // Standard mode: use date filters
    const revListArgs = [defaultBranchRef];
    if (sinceDate) {
      revListArgs.push(`--after=${sinceDate.toISOString()}`);
    }
    if (untilDate) {
      revListArgs.push(`--before=${untilDate.toISOString()}`);
    }
    defaultBranchHashes = new Set(
      (await git.raw(['rev-list', ...revListArgs])).trim().split('\n').filter(Boolean)
    );
  }
  logger?.info(`Default branch commits: ${defaultBranchHashes.size}`);

  // Create AI tagger
  const aiTagger = createAITagger({
    patterns: aiPatterns,
    tools: aiTools,
    trailerDomains: aiTrailerDomains,
    botBlocklist: aiBotBlocklist,
  });

  // Automated detection (#39): merge commits and bot authors
  const detectAutomated = createAutomatedDetector(aiBotBlocklist);

  // Optional retroactive attribution manifest at the repo root (#10)
  const manifest = await loadAttributionManifest(repoPath, logger);
  const manifestIndex = manifest ? indexManifest(manifest) : null;

  // Author redaction (#35). Applied last: identity-based detection above
  // must see the real values.
  const redactor = redactAuthors ? createRedactor() : null;
  if (redactor) {
    logger?.info('Author identities redacted with a per-run salted hash');
  }

  // Deduplicate commits (same hash can appear from multiple branches)
  const seen = new Set<string>();
  const commits: Commit[] = [];
  let syntheticMergesDropped = 0;
  for (const rawCommit of rawCommits) {
    if (seen.has(rawCommit.hash)) continue;
    seen.add(rawCommit.hash);

    // Drop the CI-generated PR merge head (#40): PR-scoped mode only, where
    // `diffBase..HEAD` would otherwise include a commit authored by nobody.
    if (diffBase && isSyntheticPRMerge(rawCommit)) {
      syntheticMergesDropped++;
      continue;
    }

    logger?.debug(`Processing commit ${rawCommit.hash}`);

    // Tag on the full message (body included, for trailers like Co-Authored-By)
    let aiTag = aiTagger(rawCommit.message);
    // Automated detection only when the message carried no signal at all:
    // in-commit evidence wins over structural heuristics. Automation sits
    // beside the autonomy axes rather than on them (#25) — a merge commit
    // has known provenance and no author, so `mode: none` states that no AI
    // wrote it while `automated` keeps it out of every cohort.
    if (aiTag.evidence === 'none') {
      const automatedSource = detectAutomated(rawCommit);
      if (automatedSource) {
        aiTag = tagFromAxes({ mode: 'none', evidence: 'inferred', automated: true }, 'none', [
          ...aiTag.sources,
          automatedSource,
        ]);
      }
    }
    // Manifest declarations beat structural heuristics
    if (manifestIndex) {
      aiTag = applyManifest(aiTag, rawCommit.hash, manifestIndex, logger);
    }

    // Revert target (#26): only the standard git-generated body line links
    // a revert back to what it reverted; parsed from the full message,
    // since the stored `message` field below is subject-only.
    const revertMatch = rawCommit.message.match(REVERT_TARGET);

    const commit: Commit = {
      hash: rawCommit.hash,
      authorName: redactor ? redactor.name(rawCommit.authorName) : rawCommit.authorName,
      authorEmail: redactor ? redactor.email(rawCommit.authorEmail) : rawCommit.authorEmail,
      authorDate: new Date(rawCommit.authorDate).toISOString(),
      committerName: redactor ? redactor.name(rawCommit.committerName) : rawCommit.committerName,
      committerEmail: redactor ? redactor.email(rawCommit.committerEmail) : rawCommit.committerEmail,
      committerDate: new Date(rawCommit.committerDate).toISOString(),
      message: rawCommit.message.split('\n')[0],
      parents: rawCommit.parents,
      inDefaultBranchAncestry: defaultBranchHashes.has(rawCommit.hash),
      revertsCommit: revertMatch ? revertMatch[1] : null,
      tags: aiTag,
      stats: rawCommit.stats,
    };

    commits.push(commit);
  }

  if (syntheticMergesDropped > 0) {
    logger?.info(
      `Skipped ${syntheticMergesDropped} CI-generated PR merge commit(s) (refs/pull/N/merge)`
    );
  }

  if (manifestIndex) {
    const unmatched = unmatchedManifestHashes(manifestIndex);
    if (unmatched.length > 0) {
      logger?.info(
        `Manifest: ${unmatched.length} hash(es) matched no collected commit (rebase, typo, or outside the --since window)`
      );
    }
  }

  return {
    schemaVersion: COMMIT_STREAM_SCHEMA_VERSION,
    repoPath,
    defaultBranch,
    scope,
    headSha: (
      await git.raw(['rev-parse', diffBase ? 'HEAD' : scope === 'default-branch' ? defaultBranchRef : 'HEAD'])
    ).trim(),
    generatedAt: formatISODate(new Date()),
    since,
    until,
    aiPatterns: [...aiPatterns],
    commits,
  };
}
