import { EvidtrailConfig, assertNoRetiredConfigKeys } from '@evidtrail/core';
import { readFile, access } from 'fs/promises';
import { join } from 'path';

export const CONFIG_FILENAME = '.evidtrail.json';
// The pre-rename file name, read until 2.0 and no longer. It is still LOOKED
// FOR: a repository that upgrades must not silently lose its threshold and
// tool list, because the honest state is "configured under a retired name",
// not "unconfigured".
export const RETIRED_CONFIG_FILENAME = '.aida.json';

export interface ConfigFile {
  path: string;
  name: string;
  // True when only the retired name exists: found, and refused.
  retired: boolean;
}

/** Which config file this repository carries, preferring the current name. */
export async function findConfigFile(repoPath: string): Promise<ConfigFile | null> {
  for (const name of [CONFIG_FILENAME, RETIRED_CONFIG_FILENAME]) {
    const path = join(repoPath, name);
    try {
      await access(path);
      return { path, name, retired: name === RETIRED_CONFIG_FILENAME };
    } catch {
      // try the next name
    }
  }
  return null;
}

/** Load the repository configuration without turning malformed input into defaults. */
export async function loadConfig(repoPath: string): Promise<Partial<EvidtrailConfig>> {
  const file = await findConfigFile(repoPath);
  if (!file) return {};
  if (file.retired) {
    throw new Error(
      `${RETIRED_CONFIG_FILENAME} is no longer read since evidtrail 2.0. Rename it: git mv ${RETIRED_CONFIG_FILENAME} ${CONFIG_FILENAME}`
    );
  }

  const raw = await readFile(file.path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  assertNoRetiredConfigKeys(parsed);
  return EvidtrailConfig.parse(parsed);
}
