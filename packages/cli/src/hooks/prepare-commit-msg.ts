// TypeScript-facing re-export of the canonical JavaScript module. The hook
// body itself must remain directly importable by Node before this package is
// built, because root `pnpm install` runs `prepare` on a fresh clone.
export {
  HOOK_END_MARKER,
  HOOK_MARKER,
  HOOK_SCRIPT,
  LEGACY_HOOK_END_MARKER,
  LEGACY_HOOK_MARKER,
} from './prepare-commit-msg.mjs';
