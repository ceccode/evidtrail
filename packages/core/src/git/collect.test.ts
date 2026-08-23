import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectCommits } from './collect.js';

const AUTHOR = { name: 'Alice Author', email: 'alice@example.com', date: '2026-01-01T10:00:00Z' };
const COMMITTER = { name: 'Bob Committer', email: 'bob@example.com', date: '2026-01-05T10:00:00Z' };

let repoPath: string;

function run(cmd: string, env: Record<string, string> = {}) {
  execSync(cmd, { cwd: repoPath, env: { ...process.env, ...env } });
}

function commit(message: string) {
  const escaped = message.replace(/"/g, '\\"');
  run(`git commit -q -m "${escaped}"`, {
    GIT_AUTHOR_NAME: AUTHOR.name,
    GIT_AUTHOR_EMAIL: AUTHOR.email,
    GIT_AUTHOR_DATE: AUTHOR.date,
    GIT_COMMITTER_NAME: COMMITTER.name,
    GIT_COMMITTER_EMAIL: COMMITTER.email,
    GIT_COMMITTER_DATE: COMMITTER.date,
  });
}

beforeAll(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'aida-collect-test-'));
  run('git init -q -b main');
  run('git config user.name test && git config user.email test@example.com');

  writeFileSync(join(repoPath, 'a.txt'), 'line1\nline2\n');
  writeFileSync(join(repoPath, 'b.txt'), 'temp\n');
  run('git add .');
  commit('feat: initial commit');

  writeFileSync(join(repoPath, 'a.txt'), 'line1\nline2\nline3\n');
  rmSync(join(repoPath, 'b.txt'));
  run('git add -A');
  commit('fix: multi-line message\n\nSome body text.\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
});

afterAll(() => {
  rmSync(repoPath, { recursive: true, force: true });
});

describe('collectCommits', () => {
  it('rejects option-shaped refs before they can alter a Git invocation', async () => {
    // A CLI flag or CI environment variable is untrusted input. Treating an
    // option-shaped ref as data prevents it from becoming a Git option — a
    // defense-in-depth boundary even though normal collection never clones or
    // fetches remotes.
    await expect(
      collectCommits({ repoPath, defaultBranch: '--config=protocol.ext.allow=always' })
    ).rejects.toThrow("Invalid default branch: Git refs must not start with '-'");
    await expect(collectCommits({ repoPath, diffBase: '--upload-pack=sh' })).rejects.toThrow(
      "Invalid diff base: Git refs must not start with '-'"
    );
  });

  it('collects real author and committer identities and dates', async () => {
    const stream = await collectCommits({ repoPath });
    expect(stream.commits).toHaveLength(2);

    const head = stream.commits[0];
    expect(head.authorName).toBe(AUTHOR.name);
    expect(head.authorEmail).toBe(AUTHOR.email);
    expect(head.committerName).toBe(COMMITTER.name);
    expect(head.committerEmail).toBe(COMMITTER.email);
    expect(head.authorDate).toBe('2026-01-01T10:00:00.000Z');
    expect(head.committerDate).toBe('2026-01-05T10:00:00.000Z');
    expect(head.committerDate).not.toBe(head.authorDate);
  });

  it('computes diff stats with file statuses from batched log', async () => {
    const stream = await collectCommits({ repoPath });
    const [head, initial] = stream.commits;

    expect(initial.stats.totalAdditions).toBe(3); // 2 lines a.txt + 1 line b.txt
    expect(initial.stats.files.map((f) => f.status)).toEqual(['added', 'added']);

    expect(head.stats.totalAdditions).toBe(1); // line3 in a.txt
    expect(head.stats.totalDeletions).toBe(1); // b.txt removed
    const byPath = Object.fromEntries(head.stats.files.map((f) => [f.path, f.status]));
    expect(byPath['a.txt']).toBe('modified');
    expect(byPath['b.txt']).toBe('deleted');
  });

  it('populates parents and ancestry, without the removed branch field', async () => {
    const stream = await collectCommits({ repoPath });
    const [head, initial] = stream.commits;

    expect(initial.parents).toEqual([]);
    expect(head.parents).toEqual([initial.hash]);
    expect(head.inDefaultBranchAncestry).toBe(true);
    expect(head).not.toHaveProperty('branch');
  });

  it('tags AI from trailers in the full message body, storing the subject only', async () => {
    const stream = await collectCommits({ repoPath });
    const head = stream.commits[0];

    expect(head.message).toBe('fix: multi-line message');
    expect(head.tags.attribution).toBe('ai');
    expect(head.tags.level).toBe('explicit');
  });
});

describe('collectCommits with attribution manifest', () => {
  let manifestRepoPath: string;

  function runIn(cmd: string) {
    execSync(cmd, { cwd: manifestRepoPath });
  }

  function commitIn(message: string): string {
    const escaped = message.replace(/"/g, '\\"');
    runIn(`git commit -q --allow-empty -m "${escaped}"`);
    return execSync('git rev-parse HEAD', { cwd: manifestRepoPath }).toString().trim();
  }

  beforeAll(() => {
    manifestRepoPath = mkdtempSync(join(tmpdir(), 'aida-manifest-collect-'));
    execSync('git init -q -b main', { cwd: manifestRepoPath });
    runIn('git config user.name test && git config user.email test@example.com');
  });

  afterAll(() => {
    rmSync(manifestRepoPath, { recursive: true, force: true });
  });

  it('applies manifest declarations on top of heuristics end-to-end', async () => {
    const untaggedAI = commitIn('feat: untagged but AI-assisted');
    const humanCommit = commitIn('fix: hand-written fix');
    const releaseCommit = commitIn(
      'chore: release\n\nCo-authored-by: some-release-bot <bot@example.com>'
    );
    const plainCommit = commitIn('docs: not in manifest');

    writeFileSync(
      join(manifestRepoPath, 'aida-attribution.json'),
      JSON.stringify({
        version: '1.0',
        ai_assisted_commits: [{ hash: untaggedAI }],
        human_authored_commits: [{ hash: humanCommit }],
        excluded_commits: [{ hash: releaseCommit, reason: 'Automated' }],
      })
    );

    const stream = await collectCommits({ repoPath: manifestRepoPath });
    const byHash = Object.fromEntries(stream.commits.map((c) => [c.hash, c.tags]));

    expect(byHash[untaggedAI].attribution).toBe('ai');
    expect(byHash[untaggedAI].level).toBe('explicit');
    expect(byHash[untaggedAI].sources).toContain('manifest');

    expect(byHash[humanCommit].attribution).toBe('human');
    expect(byHash[humanCommit].sources).toContain('manifest');

    // The bot trailer would tag this explicit ai; excluded declares automation
    expect(byHash[releaseCommit].attribution).toBe('automated');
    expect(byHash[releaseCommit].attribution).not.toBe('ai');
    expect(byHash[releaseCommit].sources).toContain('manifest:excluded');

    expect(byHash[plainCommit].attribution).toBe('unknown');
    expect(byHash[plainCommit].sources).not.toContain('manifest');
  });

  it('auto-detects bot-authored commits as automated, but AI trailers win', async () => {
    const botHash = (() => {
      execSync(
        'git commit -q --allow-empty -m "chore: release packages"',
        {
          cwd: manifestRepoPath,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'github-actions[bot]',
            GIT_AUTHOR_EMAIL: 'github-actions[bot]@users.noreply.github.com',
            GIT_COMMITTER_NAME: 'github-actions[bot]',
            GIT_COMMITTER_EMAIL: 'github-actions[bot]@users.noreply.github.com',
          },
        }
      );
      return execSync('git rev-parse HEAD', { cwd: manifestRepoPath }).toString().trim();
    })();
    const aiByBotHash = (() => {
      execSync(
        'git commit -q --allow-empty -m "feat: agent PR\n\nCo-Authored-By: Claude <noreply@anthropic.com>"',
        {
          cwd: manifestRepoPath,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'github-actions[bot]',
            GIT_AUTHOR_EMAIL: 'github-actions[bot]@users.noreply.github.com',
            GIT_COMMITTER_NAME: 'github-actions[bot]',
            GIT_COMMITTER_EMAIL: 'github-actions[bot]@users.noreply.github.com',
          },
        }
      );
      return execSync('git rev-parse HEAD', { cwd: manifestRepoPath }).toString().trim();
    })();

    rmSync(join(manifestRepoPath, 'aida-attribution.json'), { force: true });
    const stream = await collectCommits({ repoPath: manifestRepoPath });
    const byHash = Object.fromEntries(stream.commits.map((c) => [c.hash, c.tags]));

    expect(byHash[botHash].attribution).toBe('automated');
    expect(byHash[botHash].sources).toContain('automated:bot');
    // In-commit AI evidence beats the bot-identity heuristic
    expect(byHash[aiByBotHash].attribution).toBe('ai');
  });

  it('does not fail collect when the manifest is invalid', async () => {
    writeFileSync(join(manifestRepoPath, 'aida-attribution.json'), '{ broken');
    const stream = await collectCommits({ repoPath: manifestRepoPath });
    expect(stream.commits.length).toBeGreaterThan(0);
    expect(stream.commits.every((c) => !c.tags.sources.includes('manifest'))).toBe(true);
  });
});

describe('collectCommits author redaction (#35)', () => {
  it('redacts identities while keeping identity-based detection working', async () => {
    const stream = await collectCommits({ repoPath, redactAuthors: true });

    for (const commit of stream.commits) {
      expect(commit.authorName).toMatch(/^redacted-[0-9a-f]{12}$/);
      expect(commit.authorEmail).toMatch(/@redacted\.invalid$/);
      expect(commit.committerName).toMatch(/^redacted-[0-9a-f]{12}$/);
      expect(commit.authorName).not.toContain('Alice');
      expect(commit.authorEmail).not.toContain('alice');
    }

    // The same identity hashes consistently within a run
    const names = new Set(stream.commits.map((c) => c.authorName));
    expect(names.size).toBe(1);

    // Detection still worked: it runs before redaction
    expect(stream.commits[0].tags.attribution).toBe('ai');
  });

  it('leaves identities untouched by default', async () => {
    const stream = await collectCommits({ repoPath });
    expect(stream.commits[0].authorName).toBe(AUTHOR.name);
    expect(stream.commits[0].authorEmail).toBe(AUTHOR.email);
  });
});

describe('collectCommits synthetic PR merge (#40)', () => {
  let prRepoPath: string;
  let realCommit: string;

  beforeAll(() => {
    prRepoPath = mkdtempSync(join(tmpdir(), 'aida-pr-merge-'));
    const runHere = (cmd: string) => execSync(cmd, { cwd: prRepoPath });
    runHere('git init -q -b main');
    runHere('git config user.name test && git config user.email test@example.com');
    runHere('git commit -q --allow-empty -m "chore: base"');

    // PR branch with one real commit
    runHere('git checkout -q -b feature');
    runHere('git commit -q --allow-empty -m "feat: real work"');
    realCommit = execSync('git rev-parse HEAD', { cwd: prRepoPath }).toString().trim();

    // main moves on, so the branches actually diverge
    runHere('git checkout -q main');
    runHere('git commit -q --allow-empty -m "chore: main moves on"');
    const mainTip = execSync('git rev-parse HEAD', { cwd: prRepoPath }).toString().trim();

    // Emulate actions/checkout: a merge commit whose subject is the
    // synthetic "Merge <sha> into <sha>" form
    runHere('git checkout -q feature');
    runHere(`git merge -q --no-ff main -m "Merge ${realCommit} into ${mainTip}"`);
  });

  afterAll(() => {
    rmSync(prRepoPath, { recursive: true, force: true });
  });

  it('drops the synthetic merge head in PR-scoped mode', async () => {
    const stream = await collectCommits({ repoPath: prRepoPath, diffBase: 'main' });
    const subjects = stream.commits.map((c) => c.message);

    expect(subjects).toContain('feat: real work');
    expect(subjects.some((s) => /^Merge [0-9a-f]{7,40} into [0-9a-f]{7,40}$/.test(s))).toBe(false);
  });

  it('keeps merge commits when all refs are explicitly requested', async () => {
    const stream = await collectCommits({ repoPath: prRepoPath, scope: 'all-refs' });
    expect(
      stream.commits.some((c) => /^Merge [0-9a-f]{7,40} into [0-9a-f]{7,40}$/.test(c.message))
    ).toBe(true);
  });
});

describe('collectCommits revert detection (#26)', () => {
  it('parses the target sha from a real git revert commit', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'aida-revert-'));
    try {
      execSync('git init -q -b main', { cwd: repoPath });
      execSync('git config user.name test && git config user.email test@example.com', { cwd: repoPath });
      writeFileSync(join(repoPath, 'app.ts'), 'v1\n');
      execSync('git add -A && git commit -q -m "feat: introduce bug"', { cwd: repoPath });
      const targetSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();

      execSync(`git revert --no-edit ${targetSha}`, { cwd: repoPath, stdio: 'ignore' });

      const stream = await collectCommits({ repoPath });
      const revertCommit = stream.commits[0];

      expect(revertCommit.message).toMatch(/^Revert /);
      expect(revertCommit.revertsCommit).toBe(targetSha);
      expect(stream.commits[1].revertsCommit).toBeNull();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
    }
  });

  it('leaves revertsCommit null for ordinary commits', async () => {
    const stream = await collectCommits({ repoPath });
    expect(stream.commits.every((c) => c.revertsCommit === null)).toBe(true);
  });
});

describe('collectCommits on degenerate repositories', () => {
  it('returns an empty stream instead of crashing on a repo with no commits', async () => {
    const emptyPath = mkdtempSync(join(tmpdir(), 'aida-empty-'));
    try {
      execSync('git init -q -b main', { cwd: emptyPath });

      const stream = await collectCommits({ repoPath: emptyPath });
      expect(stream.commits).toEqual([]);
      expect(stream.schemaVersion).toBe(3);
      expect(stream.defaultBranch).toBe('main');
    } finally {
      rmSync(emptyPath, { recursive: true, force: true });
    }
  });

  it('warns loudly on a shallow clone, whose truncated history would silently skew every metric', async () => {
    const originPath = mkdtempSync(join(tmpdir(), 'aida-origin-'));
    const shallowPath = mkdtempSync(join(tmpdir(), 'aida-shallow-'));
    rmSync(shallowPath, { recursive: true, force: true }); // git clone wants a fresh path
    const warnings: string[] = [];
    const logger = {
      info: () => {},
      warn: (m: string) => warnings.push(m),
      error: () => {},
      debug: () => {},
    };

    try {
      execSync('git init -q -b main', { cwd: originPath });
      execSync('git config user.name test && git config user.email test@example.com', { cwd: originPath });
      for (const n of [1, 2, 3]) {
        execSync(`git commit -q --allow-empty -m "feat: commit ${n}"`, { cwd: originPath });
      }
      execSync(`git clone -q --depth 1 file://${originPath} ${shallowPath}`, { stdio: 'ignore' });

      const stream = await collectCommits({ repoPath: shallowPath, logger });

      // The truncation itself is real: only the tip was fetched
      expect(stream.commits.length).toBeLessThan(3);
      expect(warnings.join(' ')).toMatch(/SHALLOW clone/);
      expect(warnings.join(' ')).toMatch(/fetch-depth: 0/);
    } finally {
      rmSync(originPath, { recursive: true, force: true });
      rmSync(shallowPath, { recursive: true, force: true });
    }
  });

  it('does not warn about shallowness on a complete clone', async () => {
    const warnings: string[] = [];
    const logger = {
      info: () => {},
      warn: (m: string) => warnings.push(m),
      error: () => {},
      debug: () => {},
    };
    await collectCommits({ repoPath, logger });
    expect(warnings.join(' ')).not.toMatch(/SHALLOW/);
  });
});

describe('collectCommits scope contract', () => {
  it('keeps unreachable branch work out of the default report', async () => {
    const scopedRepo = mkdtempSync(join(tmpdir(), 'aida-scope-'));
    const runHere = (cmd: string) => execSync(cmd, { cwd: scopedRepo });
    try {
      runHere('git init -q -b main');
      runHere('git config user.name test && git config user.email test@example.com');
      runHere('git commit -q --allow-empty -m "main: base"');
      const mainHead = runHere('git rev-parse HEAD').toString().trim();
      runHere('git checkout -q -b abandoned');
      runHere('git commit -q --allow-empty -m "branch: unreachable"');

      const defaultStream = await collectCommits({ repoPath: scopedRepo });
      const allRefsStream = await collectCommits({ repoPath: scopedRepo, scope: 'all-refs' });

      expect(defaultStream.scope).toBe('default-branch');
      expect(defaultStream.headSha).toBe(mainHead);
      expect(defaultStream.commits.map((commit) => commit.message)).toEqual(['main: base']);
      expect(allRefsStream.scope).toBe('all-refs');
      expect(allRefsStream.commits.map((commit) => commit.message)).toContain('branch: unreachable');
    } finally {
      rmSync(scopedRepo, { recursive: true, force: true });
    }
  });

  it('prefers origin/HEAD over a stale local default branch and never applies an implicit until=now', async () => {
    // A developer often works on a feature branch while local `main` has not
    // been fast-forwarded. Reading that stale ref makes a default-branch
    // report look complete while omitting the latest integrated commit. The
    // future timestamp models harmless clock skew between the forge and the
    // machine running AIDA: no explicit --until means include reachable HEAD.
    const scopedRepo = mkdtempSync(join(tmpdir(), 'aida-origin-default-'));
    const runHere = (cmd: string, env: Record<string, string> = {}) =>
      execSync(cmd, { cwd: scopedRepo, env: { ...process.env, ...env } });
    try {
      runHere('git init -q -b main');
      runHere('git config user.name test && git config user.email test@example.com');
      runHere('git commit -q --allow-empty -m "main: stale local base"');
      const staleLocal = runHere('git rev-parse HEAD').toString().trim();
      runHere('git commit -q --allow-empty -m "main: current remote tip"', {
        GIT_AUTHOR_DATE: '2099-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2099-01-01T00:00:00Z',
      });
      const remoteTip = runHere('git rev-parse HEAD').toString().trim();
      runHere(`git update-ref refs/remotes/origin/main ${remoteTip}`);
      runHere('git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main');
      runHere(`git checkout -q -b feature ${staleLocal}`);
      runHere(`git branch -f main ${staleLocal}`);

      const stream = await collectCommits({ repoPath: scopedRepo });

      expect(stream.headSha).toBe(remoteTip);
      expect(stream.commits.map((commit) => commit.message)).toEqual([
        'main: current remote tip',
        'main: stale local base',
      ]);
    } finally {
      rmSync(scopedRepo, { recursive: true, force: true });
    }
  });
});
