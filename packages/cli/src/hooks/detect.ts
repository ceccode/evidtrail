import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { HOOK_MARKER, LEGACY_HOOK_MARKER } from './prepare-commit-msg.js';

const execFileAsync = promisify(execFile);

export const HOOK_NAME = 'prepare-commit-msg';

// Shared by `install-hooks` (to write the hook) and `analyze` (to notice it
// is missing). A hook is per-clone state, so "is evidtrail set up here?" and "is
// evidtrail set up in this repo?" are different questions — #75.

// Resolves the real hooks directory: worktrees and `core.hooksPath` both
// move it away from `.git/hooks`.
export async function resolveHooksDir(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: repoPath,
    });
    const relative = stdout.trim();
    return relative.startsWith('/') ? relative : join(repoPath, relative);
  } catch {
    return join(repoPath, '.git', 'hooks');
  }
}

// True only inside a real work tree. A package installed from a tarball, an
// `npm ci` in a container, or a Docker build context has no git at all —
// `--if-git` uses this to stay silent there instead of failing the install.
export async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

// A hook written before the rename is still ours — recognising it is what
// lets `install-hooks` upgrade it in place instead of refusing it as foreign.
export function isAidaHook(content: string): boolean {
  return content.includes(HOOK_MARKER) || content.includes(LEGACY_HOOK_MARKER);
}

// Whether THIS clone stamps modes. Deliberately checks the file rather than
// trusting `.evidtrail.json`: config is committed and shared, the hook is not.
export async function isAidaHookInstalled(repoPath: string): Promise<boolean> {
  try {
    const hooksDir = await resolveHooksDir(repoPath);
    const content = await fs.readFile(join(hooksDir, HOOK_NAME), 'utf-8');
    return isAidaHook(content);
  } catch {
    return false;
  }
}
