import { AidaConfig, assertNoRetiredConfigKeys } from '@evidtrail/core';
import { readFile, access } from 'fs/promises';
import { join } from 'path';

export const CONFIG_FILENAME = '.evidtrail.json';
// The pre-rename file name. Read for one release so a repository upgrading
// the CLI does not silently lose its prior and threshold; every reader that
// finds it says so, because the honest state is "configured under an old
// name", not "unconfigured".
export const LEGACY_CONFIG_FILENAME = '.aida.json';

export interface ConfigFile {
  path: string;
  name: string;
  legacy: boolean;
}

/** Which config file this repository carries, preferring the current name. */
export async function findConfigFile(repoPath: string): Promise<ConfigFile | null> {
  for (const name of [CONFIG_FILENAME, LEGACY_CONFIG_FILENAME]) {
    const path = join(repoPath, name);
    try {
      await access(path);
      return { path, name, legacy: name === LEGACY_CONFIG_FILENAME };
    } catch {
      // try the next name
    }
  }
  return null;
}

/** Load the repository configuration without turning malformed input into defaults. */
export async function loadAidaConfig(
  repoPath: string,
  logger?: { warn(message: string): void }
): Promise<Partial<AidaConfig>> {
  const file = await findConfigFile(repoPath);
  if (!file) return {};
  if (file.legacy) {
    logger?.warn(
      `${LEGACY_CONFIG_FILENAME} is the pre-rename config name and will stop being read in the next major — rename it to ${CONFIG_FILENAME}.`
    );
  }

  const raw = await readFile(file.path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  assertNoRetiredConfigKeys(parsed);
  return AidaConfig.parse(parsed);
}
