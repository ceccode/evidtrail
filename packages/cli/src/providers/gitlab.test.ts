import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitLabProvider } from './gitlab.js';
import { detectProvider } from './detect.js';

const ENV_KEYS = [
  'GITLAB_CI',
  'GITLAB_TOKEN',
  'CI_PROJECT_ID',
  'CI_PROJECT_PATH',
  'CI_MERGE_REQUEST_IID',
  'CI_API_V4_URL',
  'GITHUB_ACTIONS',
];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
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

describe('detectProvider', () => {
  it('selects GitLab when running in GitLab CI', () => {
    process.env.GITLAB_CI = 'true';
    expect(detectProvider()?.name).toBe('gitlab');
  });

  it('still selects GitHub when running in GitHub Actions', () => {
    process.env.GITHUB_ACTIONS = 'true';
    expect(detectProvider()?.name).toBe('github');
  });

  it('returns null outside a known CI', () => {
    expect(detectProvider()).toBeNull();
  });
});

describe('GitLabProvider.getPRIdentifier', () => {
  it('returns the MR iid on a merge_request pipeline', () => {
    process.env.CI_PROJECT_ID = '42';
    process.env.CI_PROJECT_PATH = 'group/project';
    process.env.CI_MERGE_REQUEST_IID = '7';

    expect(new GitLabProvider().getPRIdentifier()).toEqual({
      provider: 'gitlab',
      prNumber: '7',
      repo: 'group/project',
    });
  });

  it('returns null on a branch pipeline, where there is no MR', () => {
    process.env.CI_PROJECT_ID = '42';
    expect(new GitLabProvider().getPRIdentifier()).toBeNull();
  });
});

describe('GitLabProvider.postComment', () => {
  beforeEach(() => {
    process.env.CI_PROJECT_ID = '42';
    process.env.CI_MERGE_REQUEST_IID = '7';
    process.env.CI_API_V4_URL = 'https://gitlab.example.com/api/v4';
  });

  it('creates a note when none carries the marker', async () => {
    process.env.GITLAB_TOKEN = 'glpat-secret';
    const calls = mockFetch([
      () => json([{ id: 1, body: 'unrelated comment' }]),
      () => json({ id: 2 }, 201),
    ]);

    await new GitLabProvider().postComment('# evidtrail Report');

    expect(calls).toHaveLength(2);
    expect(calls[1].init?.method).toBe('POST');
    expect(calls[1].url).toContain('/projects/42/merge_requests/7/notes');
    expect(String(calls[1].init?.body)).toContain('<!-- evidtrail-report -->');
  });

  it('updates the existing evidtrail note instead of adding another', async () => {
    process.env.GITLAB_TOKEN = 'glpat-secret';
    const calls = mockFetch([
      () => json([{ id: 99, body: '<!-- evidtrail-report -->\nold report' }]),
      () => json({ id: 99 }),
    ]);

    await new GitLabProvider().postComment('# evidtrail Report');

    expect(calls[1].init?.method).toBe('PUT');
    expect(calls[1].url).toContain('/notes/99');
  });

  it('replaces a note posted under the pre-rename marker, and re-marks it with the new one', async () => {
    // A merge request open across the upgrade must not end up with two
    // reports: the old marker is still found, the body is rewritten with
    // the current marker so the next run finds it under the new name.
    process.env.GITLAB_TOKEN = 'glpat-secret';
    const calls = mockFetch([
      () => json([{ id: 7, body: '<!-- aida-metrics-report -->\nold report' }]),
      () => json({ id: 7 }),
    ]);

    await new GitLabProvider().postComment('# evidtrail Report');

    expect(calls[1].init?.method).toBe('PUT');
    expect(calls[1].url).toContain('/notes/7');
    expect(String(calls[1].init?.body)).toContain('<!-- evidtrail-report -->');
  });

  it('authenticates with PRIVATE-TOKEN', async () => {
    process.env.GITLAB_TOKEN = 'glpat-secret';
    const calls = mockFetch([() => json([]), () => json({ id: 1 }, 201)]);

    await new GitLabProvider().postComment('report');

    const headers = calls[0].init?.headers ?? {};
    expect(headers['PRIVATE-TOKEN']).toBe('glpat-secret');
  });

  it('explains that CI_JOB_TOKEN cannot post notes when the token is missing', async () => {
    await expect(new GitLabProvider().postComment('report')).rejects.toThrow(
      /GITLAB_TOKEN is required.*CI_JOB_TOKEN cannot post notes/s
    );
  });

  it('never leaks the token through an API error body', async () => {
    process.env.GITLAB_TOKEN = 'glpat-supersecret';
    mockFetch([
      () => json([]),
      () => new Response('denied for glpat-supersecret via PRIVATE-TOKEN: glpat-supersecret', { status: 403 }),
    ]);

    await expect(new GitLabProvider().postComment('report')).rejects.toThrow(
      /\[REDACTED\]/
    );
    await expect(new GitLabProvider().postComment('report')).rejects.not.toThrow(
      /supersecret/
    );
  });
});
