import { describe, it, expect } from 'vitest';
import { getDiffStats } from './diff.js';
import path from 'path';

// These tests run against the actual evidtrail repo
const REPO_PATH = path.resolve(__dirname, '..', '..', '..', '..');

describe('getDiffStats', () => {
  it('returns stats for a valid commit', async () => {
    const stats = await getDiffStats(REPO_PATH, 'HEAD');
    expect(stats).toHaveProperty('totalAdditions');
    expect(stats).toHaveProperty('totalDeletions');
    expect(stats).toHaveProperty('files');
    expect(stats.totalAdditions).toBeGreaterThanOrEqual(0);
    expect(stats.totalDeletions).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(stats.files)).toBe(true);
  });

  it('returns empty stats for invalid commit', async () => {
    const stats = await getDiffStats(REPO_PATH, 'deadbeef0000000000000000000000000000dead');
    expect(stats.totalAdditions).toBe(0);
    expect(stats.totalDeletions).toBe(0);
    expect(stats.files).toEqual([]);
  });

  it('files have required fields', async () => {
    const stats = await getDiffStats(REPO_PATH, 'HEAD');
    for (const file of stats.files) {
      expect(file).toHaveProperty('path');
      expect(file).toHaveProperty('additions');
      expect(file).toHaveProperty('deletions');
      expect(typeof file.path).toBe('string');
      expect(typeof file.additions).toBe('number');
      expect(typeof file.deletions).toBe('number');
    }
  });
});
