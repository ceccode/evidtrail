import { describe, it, expect } from 'vitest';
import { categorizeFile } from './file-category.js';

describe('categorizeFile', () => {
  it('classifies by path heuristics, first match wins', () => {
    expect(categorizeFile('src/index.ts')).toBe('source');
    expect(categorizeFile('src/utils/dates.test.ts')).toBe('tests');
    expect(categorizeFile('__tests__/foo.js')).toBe('tests');
    expect(categorizeFile('db/migrations/001_init.sql')).toBe('migrations');
    expect(categorizeFile('README.md')).toBe('docs');
    expect(categorizeFile('docs/index.html')).toBe('docs');
    expect(categorizeFile('.evidtrail.json')).toBe('config');
    expect(categorizeFile('packages/core/tsconfig.json')).toBe('config');
    expect(categorizeFile('.github/workflows/ci.yml')).toBe('config');
    expect(categorizeFile('pnpm-lock.yaml')).toBe('generated');
    expect(categorizeFile('packages/cli/CHANGELOG.md')).toBe('generated');
    expect(categorizeFile('src/__snapshots__/app.snap')).toBe('generated');
  });

  it('prefers generated over docs and config for lockfiles/changelogs', () => {
    expect(categorizeFile('CHANGELOG.md')).toBe('generated');
    expect(categorizeFile('package-lock.json')).toBe('generated');
  });
});
