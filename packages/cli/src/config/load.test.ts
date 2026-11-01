import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig } from './load.js';

const dirs: string[] = [];

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'evidtrail-config-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns defaults only when the file is absent', async () => {
    await expect(loadConfig(tempRepo())).resolves.toEqual({});
  });

  it('does not silently ignore malformed JSON or misspelled keys', async () => {
    const malformed = tempRepo();
    writeFileSync(join(malformed, '.evidtrail.json'), '{ broken');
    await expect(loadConfig(malformed)).rejects.toBeInstanceOf(SyntaxError);

    const typo = tempRepo();
    writeFileSync(join(typo, '.evidtrail.json'), JSON.stringify({ defaultMdoe: 'agent' }));
    await expect(loadConfig(typo)).rejects.toThrow('Unrecognized key');
  });

  // 2.0 stops reading the pre-rename name, but it must not fall back to
  // defaults in silence: a repository that set a threshold or extra tools
  // would get different numbers with nothing saying why. Refusing, with the
  // command that fixes it, is the honest form of the removal.
  it('refuses a retired .aida.json with the rename command, rather than running unconfigured', async () => {
    const repo = tempRepo();
    writeFileSync(join(repo, '.aida.json'), JSON.stringify({ defaultMode: 'agent' }));
    await expect(loadConfig(repo)).rejects.toThrow('git mv .aida.json .evidtrail.json');
  });

  it('prefers .evidtrail.json when both names exist', async () => {
    const repo = tempRepo();
    writeFileSync(join(repo, '.aida.json'), JSON.stringify({ defaultMode: 'agent' }));
    writeFileSync(join(repo, '.evidtrail.json'), JSON.stringify({ defaultMode: 'none' }));
    await expect(loadConfig(repo)).resolves.toMatchObject({ defaultMode: 'none' });
  });
});
