import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadAidaConfig } from './load.js';

const dirs: string[] = [];

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aida-config-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadAidaConfig', () => {
  it('returns defaults only when the file is absent', async () => {
    await expect(loadAidaConfig(tempRepo())).resolves.toEqual({});
  });

  it('does not silently ignore malformed JSON or misspelled keys', async () => {
    const malformed = tempRepo();
    writeFileSync(join(malformed, '.evidtrail.json'), '{ broken');
    await expect(loadAidaConfig(malformed)).rejects.toBeInstanceOf(SyntaxError);

    const typo = tempRepo();
    writeFileSync(join(typo, '.evidtrail.json'), JSON.stringify({ defaultMdoe: 'agent' }));
    await expect(loadAidaConfig(typo)).rejects.toThrow('Unrecognized key');
  });

  // Rename shim: a repo upgrading the CLI keeps its prior and threshold, and
  // is told to rename the file — silently losing a configured prior would
  // change every cohort in its next report.
  it('still reads the pre-rename .aida.json, and says so', async () => {
    const repo = tempRepo();
    writeFileSync(join(repo, '.aida.json'), JSON.stringify({ defaultMode: 'agent' }));
    const logger = { warn: vi.fn() };
    await expect(loadAidaConfig(repo, logger)).resolves.toMatchObject({ defaultMode: 'agent' });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0]).toContain('.evidtrail.json');
  });

  it('prefers .evidtrail.json when both names exist', async () => {
    const repo = tempRepo();
    writeFileSync(join(repo, '.aida.json'), JSON.stringify({ defaultMode: 'agent' }));
    writeFileSync(join(repo, '.evidtrail.json'), JSON.stringify({ defaultMode: 'none' }));
    const logger = { warn: vi.fn() };
    await expect(loadAidaConfig(repo, logger)).resolves.toMatchObject({ defaultMode: 'none' });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
