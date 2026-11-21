import { simpleGit, SimpleGit } from 'simple-git';
import { Commit, CommitStream } from '../schema/commit.js';
import { COMMIT_STREAM_SCHEMA_VERSION } from '../schema/version.js';
import { createProvenanceTagger } from '../tags/provenance.js';
import { sessionRef } from '../tags/session.js';
import {
  indexManifest,
  loadAttributionManifest,
  unmatchedManifestHashes,
} from '../tags/attribution-manifest.js';
import { createRedactor, type Redactor } from '../tags/redact.js';
import { logWithStats, type RawCommit } from './log.js';
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
// names and object IDs; evidtrail only needs to reject option-shaped input.
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

// `--after`/`--before` for a date-bounded walk. The same bounds restrict the
// commits collected and the default-branch membership computed for them.
function dateBoundArgs(sinceDate: Date | undefined, untilDate: Date | undefined): string[] {
  const args: string[] = [];
  if (sinceDate) args.push(`--after=${sinceDate.toISOString()}`);
  if (untilDate) args.push(`--before=${untilDate.toISOString()}`);
  return args;
}

// An empty repository has no HEAD, so every later git call fails with a raw
// "ambiguous argument" error. A valid empty stream is the honest answer:
// nothing to measure is not a crash.
function emptyStream(options: CollectOptions): CommitStream {
  return {
    schemaVersion: COMMIT_STREAM_SCHEMA_VERSION,
    repoPath: options.repoPath,
    defaultBranch: options.defaultBranch ?? 'main',
    scope: options.diffBase ? 'pr' : (options.scope ?? 'default-branch'),
    headSha: '',
    generatedAt: formatISODate(new Date()),
    since: options.since,
    until: options.until,
    aiPatterns: [...(options.aiPatterns ?? [])],
    commits: [],
  };
}

// A shallow clone silently truncates history, so every metric would describe
// a fragment while looking like a full report. `actions/checkout` defaults to
// `fetch-depth: 1`, which makes this the single most likely way for a CI run
// to produce confidently wrong numbers.
async function warnIfShallow(git: SimpleGit, logger?: Logger): Promise<void> {
  if (await isShallowRepository(git)) {
    logger?.warn(
      'This is a SHALLOW clone: history is truncated, so all metrics describe only the fetched commits. ' +
        'Set `fetch-depth: 0` in actions/checkout (or `GIT_DEPTH: 0` in GitLab CI) for meaningful results.'
    );
  }
}

// In PR mode membership is measured against diffBase (e.g. `origin/main`),
// not the bare default-branch name: a PR checkout only has the
// remote-tracking ref, so `main` is unresolvable while `origin/main` exists.
async function prBaseHashes(git: SimpleGit, diffBase: string): Promise<Set<string>> {
  try {
    const mergeBase = (await git.raw(['merge-base', diffBase, 'HEAD'])).trim();
    const bounded = (await git.raw(['rev-list', `${mergeBase}..${diffBase}`])).trim().split('\n').filter(Boolean);
    // Include merge-base itself
    bounded.push(mergeBase);
    return new Set(bounded);
  } catch {
    // Fallback: full rev-list if merge-base fails (e.g., unrelated histories)
    return new Set((await git.raw(['rev-list', diffBase])).trim().split('\n').filter(Boolean));
  }
}

interface CommitContext {
  tagProvenance: ReturnType<typeof createProvenanceTagger>;
  redactor: Redactor | null;
  defaultBranchHashes: Set<string>;
}

function toCommit(raw: RawCommit, context: CommitContext): Commit {
  const { redactor } = context;
  const session = sessionRef(raw.message);
  // Revert target (#26): only the standard git-generated body line links a
  // revert back to what it reverted; parsed from the full message, since the
  // stored `message` field is subject-only.
  const revertMatch = raw.message.match(REVERT_TARGET);
  return {
    hash: raw.hash,
    authorName: redactor ? redactor.name(raw.authorName) : raw.authorName,
    authorEmail: redactor ? redactor.email(raw.authorEmail) : raw.authorEmail,
    authorDate: new Date(raw.authorDate).toISOString(),
    committerName: redactor ? redactor.name(raw.committerName) : raw.committerName,
    committerEmail: redactor ? redactor.email(raw.committerEmail) : raw.committerEmail,
    committerDate: new Date(raw.committerDate).toISOString(),
    message: raw.message.split('\n')[0],
    parents: raw.parents,
    inDefaultBranchAncestry: context.defaultBranchHashes.has(raw.hash),
    revertsCommit: revertMatch ? revertMatch[1] : null,
    // Tagged on the full message, body included, for trailers like Co-Authored-By
    tags: context.tagProvenance(raw),
    ...(session ? { session } : {}),
    stats: raw.stats,
  };
}

// Deduplicates (the same hash can appear from several refs) and, in PR mode,
// drops the CI-generated PR merge head (#40): `diffBase..HEAD` would
// otherwise include a commit authored by nobody.
function buildCommits(
  rawCommits: RawCommit[],
  context: CommitContext,
  prMode: boolean,
  logger?: Logger
): Commit[] {
  const seen = new Set<string>();
  const commits: Commit[] = [];
  let syntheticMergesDropped = 0;
  for (const raw of rawCommits) {
    if (seen.has(raw.hash)) continue;
    seen.add(raw.hash);
    if (prMode && isSyntheticPRMerge(raw)) {
      syntheticMergesDropped++;
      continue;
    }
    logger?.debug(`Processing commit ${raw.hash}`);
    commits.push(toCommit(raw, context));
  }
  if (syntheticMergesDropped > 0) {
    logger?.info(
      `Skipped ${syntheticMergesDropped} CI-generated PR merge commit(s) (refs/pull/N/merge)`
    );
  }
  return commits;
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
  if (await isEmptyRepository(git)) {
    logger?.warn('Repository has no commits yet — nothing to collect.');
    return emptyStream(options);
  }
  await warnIfShallow(git, logger);

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
  const bounds = dateBoundArgs(sinceDate, untilDate);

  let rangeArgs: string[];
  if (diffBase) {
    logger?.info(`PR-scoped analysis: ${diffBase}..HEAD`);
    rangeArgs = [`${diffBase}..HEAD`];
  } else {
    // Standard reports describe integrated history. Walking every ref is
    // still available for exploration, but must be requested explicitly:
    // stale feature branches otherwise change a production-looking metric.
    logger?.info(
      `Collecting ${scope === 'all-refs' ? 'all refs' : defaultBranch} from ${sinceDate?.toISOString() || 'beginning'} to ${untilDate?.toISOString() || 'latest reachable commit'}`
    );
    rangeArgs = [...(scope === 'all-refs' ? ['--all'] : [defaultBranchRef]), ...bounds];
  }

  // Single batched pass: metadata, parents, and diff stats for all commits
  const rawCommits = await logWithStats(git, rangeArgs);
  logger?.info(
    `Found ${rawCommits.length} commits${diffBase ? ' in PR' : scope === 'all-refs' ? ' across all refs' : ` on ${defaultBranch}`}`
  );

  const defaultBranchHashes = diffBase
    ? await prBaseHashes(git, diffBase)
    : new Set((await git.raw(['rev-list', defaultBranchRef, ...bounds])).trim().split('\n').filter(Boolean));
  logger?.info(`Default branch commits: ${defaultBranchHashes.size}`);

  // Optional retroactive attribution manifest at the repo root (#10)
  const manifest = await loadAttributionManifest(repoPath, logger);
  const manifestIndex = manifest ? indexManifest(manifest) : null;

  // Author redaction (#35). Applied last: identity-based detection must see
  // the real values.
  const redactor = redactAuthors ? createRedactor() : null;
  if (redactor) {
    logger?.info('Author identities redacted with a per-run salted hash');
  }

  const commits = buildCommits(
    rawCommits,
    {
      // Message heuristics, automation, then the manifest — shared with `trail`
      tagProvenance: createProvenanceTagger({
        patterns: aiPatterns,
        tools: aiTools,
        trailerDomains: aiTrailerDomains,
        botBlocklist: aiBotBlocklist,
        manifestIndex,
        logger,
      }),
      redactor,
      defaultBranchHashes,
    },
    diffBase !== undefined,
    logger
  );

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
    // The bounds are stored as the resolved instants, not the flag text.
    // `--until 10d` re-read tomorrow would name a different day; metrics
    // must be a pure function of the stream, so the stream carries the
    // instant git was actually queried with.
    since: sinceDate ? formatISODate(sinceDate) : undefined,
    until: untilDate ? formatISODate(untilDate) : undefined,
    aiPatterns: [...aiPatterns],
    commits,
  };
}
