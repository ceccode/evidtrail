import { describe, expect, it } from 'vitest';
import type { CommitStream } from '@evidtrail/core';
import { calculateMetrics } from '@evidtrail/metrics';
import { coverageWarning, metricsOptionsFrom } from './analyze.js';

const emptyStream: CommitStream = {
  schemaVersion: 3,
  repoPath: '/repo',
  defaultBranch: 'main',
  scope: 'default-branch',
  headSha: 'head',
  generatedAt: '2026-11-01T00:00:00.000Z',
  aiPatterns: [],
  commits: [],
};

describe('metricsOptionsFrom', () => {
  it('lets a flag override .evidtrail.json, and falls back to 0.7 when neither sets it', () => {
    expect(metricsOptionsFrom({ coverageThreshold: '0.5' }, { coverageThreshold: 0.9 }).coverageThreshold).toBe(0.5);
    expect(metricsOptionsFrom({}, { coverageThreshold: 0.9 }).coverageThreshold).toBe(0.9);
    expect(metricsOptionsFrom({}, {}).coverageThreshold).toBe(0.7);
  });

  // defaultMode travels from the config into the artifact as a record of the
  // repository's setting. There is no flag for it: since 2.0 it moves no
  // number, so a flag would only invite someone to expect that it does.
  it('records defaultMode from the config and takes no flag for it', () => {
    expect(metricsOptionsFrom({}, { defaultMode: 'agent' }).defaultMode).toBe('agent');
    expect(metricsOptionsFrom({}, {}).defaultMode).toBeUndefined();
  });

  it('names the flag and the value it refused', () => {
    expect(() => metricsOptionsFrom({ coverageThreshold: '2' }, {})).toThrow(
      'Invalid --coverage-threshold "2": expected a fraction between 0 and 1'
    );
    expect(() => metricsOptionsFrom({ trendWindow: '0' }, {})).toThrow(
      'Invalid --trend-window "0": expected a positive integer'
    );
    expect(() => metricsOptionsFrom({ hotfixWindow: '1.5' }, {})).toThrow(
      'Invalid --hotfix-window "1.5": expected a positive integer'
    );
    expect(() => metricsOptionsFrom({ trendGranularity: 'week' }, {})).toThrow(
      'Invalid --trend-granularity "week": expected month or quarter'
    );
  });
});

describe('coverageWarning', () => {
  it('says nothing when coverage is at or above the threshold', () => {
    const metrics = calculateMetrics(emptyStream, { coverageThreshold: 0 });
    expect(coverageWarning(metrics, 'default-branch', { configured: true, hooked: false })).toBeNull();
  });

  // A repository can be set up for evidtrail while this clone is not: the
  // config is committed, the hook is per clone. Generic advice would send the
  // reader looking at the wrong thing, so the clone is named.
  it('names the missing hook when the repo is configured but this clone is not', () => {
    const metrics = calculateMetrics(emptyStream);
    expect(coverageWarning(metrics, 'default-branch', { configured: true, hooked: false })).toContain(
      'THIS CLONE has no'
    );
    expect(coverageWarning(metrics, 'default-branch', { configured: true, hooked: true })).not.toContain(
      'THIS CLONE'
    );
  });
});
