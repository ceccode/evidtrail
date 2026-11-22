import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitHubProvider } from './github.js';

const ENV_KEYS = ['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_EVENT_PATH', 'GITHUB_API_URL'];

let savedEnv: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'evidtrail-github-test-'));
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function mockFetch(handlers: Array<(url: string, init?: FetchInit) => Response>) {
  const calls: Array<{ url: string; init?: FetchInit }> = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init?: FetchInit) => {
    calls.push({ url, init });
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index++;
    return Promise.resolve(handler(url, init));
  });
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function onPullRequest(event: unknown = { pull_request: { number: 42 } }) {
  const eventPath = join(dir, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event));
  process.env.GITHUB_EVENT_PATH = eventPath;
  process.env.GITHUB_REPOSITORY = 'acme/widget';
  process.env.GITHUB_TOKEN = 'ghp_secret123';
}

describe('GitHubProvider.getPRIdentifier', () => {
  it('reads the pull request number from the Actions event file', () => {
    onPullRequest();
    expect(new GitHubProvider().getPRIdentifier()).toEqual({
      provider: 'github',
      prNumber: '42',
      repo: 'acme/widget',
    });
  });

  it('returns null outside a pull_request event, so the caller can say why', () => {
    expect(new GitHubProvider().getPRIdentifier()).toBeNull();
    onPullRequest({ ref: 'refs/heads/main' });
    expect(new GitHubProvider().getPRIdentifier()).toBeNull();
  });
});

describe('GitHubProvider.postComment', () => {
  it('creates a comment when none carries the marker', async () => {
    onPullRequest();
    const calls = mockFetch([() => json([{ id: 1, body: 'an unrelated review comment' }]), () => json({ id: 2 }, 201)]);

    await new GitHubProvider().postComment('# evidtrail Report');

    expect(calls[1].init?.method).toBe('POST');
    expect(calls[1].url).toBe('https://api.github.com/repos/acme/widget/issues/42/comments');
    expect(JSON.parse(String(calls[1].init?.body)).body).toBe('<!-- evidtrail-report -->\n# evidtrail Report');
  });

  // One comment per pull request, rewritten on every push: a new comment per
  // run would bury the review under copies of the same report.
  it('updates its own comment instead of adding another', async () => {
    onPullRequest();
    const calls = mockFetch([
      () => json([{ id: 7, body: '<!-- evidtrail-report -->\nold report' }]),
      () => json({ id: 7 }),
    ]);

    await new GitHubProvider().postComment('new report');

    expect(calls).toHaveLength(2);
    expect(calls[1].init?.method).toBe('PATCH');
    expect(calls[1].url).toBe('https://api.github.com/repos/acme/widget/issues/comments/7');
  });

  // The report comment is posted once and edited afterwards, so on a busy
  // pull request it sits past the first 100 comments. Reading only page one
  // would post a second report, and later runs would update one copy while
  // the other goes stale.
  it('finds its comment past the first page of 100', async () => {
    onPullRequest();
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: 'review comment' }));
    const calls = mockFetch([
      () => json(fullPage),
      () => json([{ id: 150, body: '<!-- evidtrail-report -->\nold report' }]),
      () => json({ id: 150 }),
    ]);

    await new GitHubProvider().postComment('new report');

    expect(calls[0].url).toContain('per_page=100&page=1');
    expect(calls[1].url).toContain('per_page=100&page=2');
    expect(calls).toHaveLength(3);
    expect(calls[2].init?.method).toBe('PATCH');
    expect(calls[2].url).toBe('https://api.github.com/repos/acme/widget/issues/comments/150');
  });

  // A short page is the last one: no request for a page that cannot exist.
  it('stops at the first page shorter than 100', async () => {
    onPullRequest();
    const calls = mockFetch([() => json([{ id: 1, body: 'review comment' }]), () => json({ id: 2 }, 201)]);

    await new GitHubProvider().postComment('report');

    expect(calls).toHaveLength(2);
    expect(calls[1].init?.method).toBe('POST');
  });

  // CI logs are often public. An API error body can echo the request, and
  // the token must not reach the log through the error message.
  it('reports an API error with tokens redacted', async () => {
    onPullRequest();
    mockFetch([() => json([]), () => new Response('bad credentials for token ghp_secret123', { status: 401 })]);

    const posting = new GitHubProvider().postComment('report');

    await expect(posting).rejects.toThrow('Failed to create GitHub comment: 401');
    await expect(posting).rejects.not.toThrow('ghp_secret123');
  });

  it('requires GITHUB_TOKEN', async () => {
    onPullRequest();
    delete process.env.GITHUB_TOKEN;
    mockFetch([() => json([])]);

    await expect(new GitHubProvider().postComment('report')).rejects.toThrow('GITHUB_TOKEN is required');
  });
});
