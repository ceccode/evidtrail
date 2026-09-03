import { promises as fs } from 'fs';
import { join } from 'path';
import { HOOK_END_MARKER, HOOK_MARKER, HOOK_SCRIPT } from './prepare-commit-msg.js';
import { HOOK_NAME, isAidaHook, resolveHooksDir } from './detect.js';

// The hook install used to live inside the `install-hooks` command action.
// `aida init` needs the same behaviour without shelling out to itself, so it
// is a plain function now and the command is a thin wrapper around it.

export type HookInstallResult =
  | { status: 'installed'; hookPath: string }
  | { status: 'unchanged'; hookPath: string }
  | { status: 'refused'; hookPath: string };

export async function installAidaHook(
  repoPath: string,
  options: { force?: boolean } = {}
): Promise<HookInstallResult> {
  const hooksDir = await resolveHooksDir(repoPath);
  const hookPath = join(hooksDir, HOOK_NAME);

  let existing: string | null = null;
  try {
    existing = await fs.readFile(hookPath, 'utf-8');
  } catch {
    existing = null;
  }

  // Idempotent by content, not by presence: an older AIDA hook body is
  // rewritten, an identical one is left alone, a foreign one is never
  // touched without --force — it is someone else's hook.
  if (existing === HOOK_SCRIPT) return { status: 'unchanged', hookPath };
  if (existing && !isAidaHook(existing) && !options.force) {
    return { status: 'refused', hookPath };
  }

  await fs.mkdir(hooksDir, { recursive: true });
  await fs.writeFile(hookPath, HOOK_SCRIPT, { mode: 0o755 });
  return { status: 'installed', hookPath };
}

// Removes only AIDA's marked block, leaving any surrounding hook intact.
function stripAidaBlock(content: string): string {
  const start = content.indexOf(HOOK_MARKER);
  const end = content.indexOf(HOOK_END_MARKER);
  if (start === -1 || end === -1) return content;
  const before = content.slice(0, start);
  const after = content.slice(end + HOOK_END_MARKER.length);
  return `${before.trimEnd()}\n${after.trimStart()}`.trim() + '\n';
}

export type HookUninstallResult =
  | { status: 'absent'; hookPath: string }
  | { status: 'removed'; hookPath: string }
  | { status: 'stripped'; hookPath: string };

export async function uninstallAidaHook(repoPath: string): Promise<HookUninstallResult> {
  const hooksDir = await resolveHooksDir(repoPath);
  const hookPath = join(hooksDir, HOOK_NAME);

  let existing: string | null = null;
  try {
    existing = await fs.readFile(hookPath, 'utf-8');
  } catch {
    existing = null;
  }
  if (!existing || !isAidaHook(existing)) return { status: 'absent', hookPath };

  const remainder = stripAidaBlock(existing);
  // Only our block was there → remove the file entirely
  if (remainder.replace(/^#!.*\n?/, '').trim() === '') {
    await fs.rm(hookPath);
    return { status: 'removed', hookPath };
  }
  await fs.writeFile(hookPath, remainder, { mode: 0o755 });
  return { status: 'stripped', hookPath };
}
