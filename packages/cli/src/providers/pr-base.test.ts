import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPRBaseRef } from './pr-base.js';

const ENV_KEYS = [
  'GITHUB_ACTIONS',
  'GITHUB_BASE_REF',
  'GITLAB_CI',
  'CI_MERGE_REQUEST_DIFF_BASE_SHA',
  'CI_MERGE_REQUEST_TARGET_BRANCH_NAME',
  'BITBUCKET_PIPELINE_UUID',
  'BITBUCKET_PR_DESTINATION_BRANCH',
  'TF_BUILD',
  'SYSTEM_PULLREQUEST_TARGETBRANCH',
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
});

describe('detectPRBaseRef', () => {
  it('uses the remote base branch on a GitHub pull_request event', () => {
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_BASE_REF = 'main';
    expect(detectPRBaseRef()).toBe('origin/main');
  });

  // The diff base SHA is the exact commit GitLab compares against; the
  // branch name is the fallback, because the branch can have moved on.
  it('prefers the GitLab diff base SHA over the target branch name', () => {
    process.env.GITLAB_CI = 'true';
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME = 'develop';
    expect(detectPRBaseRef()).toBe('origin/develop');
    process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA = 'abc123';
    expect(detectPRBaseRef()).toBe('abc123');
  });

  it('strips refs/heads/ from an Azure DevOps target branch', () => {
    process.env.TF_BUILD = 'True';
    process.env.SYSTEM_PULLREQUEST_TARGETBRANCH = 'refs/heads/release';
    expect(detectPRBaseRef()).toBe('origin/release');
  });

  // A push build has no base. Returning null lets collect say "no PR
  // context" instead of measuring a range nobody asked for.
  it('returns null outside a pull request, even in CI', () => {
    expect(detectPRBaseRef()).toBeNull();
    process.env.GITHUB_ACTIONS = 'true';
    expect(detectPRBaseRef()).toBeNull();
  });
});
