// Installs evidtrail's own commit hook on `pnpm install`, before the CLI exists.
// This repository dogfoods the exact hook body shipped by the CLI; the small
// bootstrap below only resolves Git's hook directory and writes that body.
import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import {
  HOOK_MARKER,
  HOOK_SCRIPT,
  LEGACY_HOOK_MARKER,
} from '../packages/cli/src/hooks/prepare-commit-msg.mjs';

function gitPath(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

try {
  if (!gitPath(['rev-parse', '--git-dir'])) process.exit(0);

  const configuredHooksDir = gitPath(['rev-parse', '--git-path', 'hooks']);
  if (!configuredHooksDir) process.exit(0);

  const hooksDir = isAbsolute(configuredHooksDir)
    ? configuredHooksDir
    : resolve(process.cwd(), configuredHooksDir);
  const hookPath = resolve(hooksDir, 'prepare-commit-msg');
  const existing = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : null;

  // `prepare` must never overwrite another tool's hook. The published CLI
  // offers --force for an explicit choice; an install lifecycle does not.
  // A pre-rename hook carries the legacy marker: still ours, upgraded in place.
  if (existing && !existing.includes(HOOK_MARKER) && !existing.includes(LEGACY_HOOK_MARKER)) {
    console.warn(`[evidtrail] ${hookPath} belongs to another tool — hook installation skipped.`);
    process.exit(0);
  }

  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(hookPath, HOOK_SCRIPT, { mode: 0o755 });
  chmodSync(hookPath, 0o755);
  console.log(`[evidtrail] Installed ${hookPath}`);
} catch (error) {
  // Provenance hygiene must not make dependency installation fail.
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[evidtrail] Hook installation skipped: ${message}`);
}
