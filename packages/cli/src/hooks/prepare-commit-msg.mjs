// Canonical hook body shared by the published CLI and this repository's
// pre-build installer. Keep this module free of TypeScript syntax: a fresh
// clone must be able to import it before the CLI has been compiled.
export const HOOK_MARKER = '# >>> evidtrail mode stamp >>>';
export const HOOK_END_MARKER = '# <<< evidtrail mode stamp <<<';

// Hooks written before the rename carry these markers. They are still ours:
// an installer must recognise and upgrade them, never refuse them as foreign.
export const LEGACY_HOOK_MARKER = '# >>> aida-metrics mode stamp >>>';
export const LEGACY_HOOK_END_MARKER = '# <<< aida-metrics mode stamp <<<';

// Auto-detection is a convenience for known agent environments, not a
// guarantee. EVIDTRAIL_MODE always wins; when nothing is known we write nothing,
// because an absent trailer honestly means "unknown" while a guessed one
// would be a fabricated declaration.
export const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Stamps 'AI-Mode: <mode>' so commit provenance is declared, not inferred.
# Docs: https://github.com/ceccode/evidtrail/issues/61
# Remove with: evidtrail install-hooks --uninstall

evidtrail_stamp_mode() {
  msg_file="$1"
  [ -f "$msg_file" ] || return 0

  # Already declared (amend, rebase, template, or an agent that stamps its
  # own): never write a second trailer.
  if grep -qiE '^AI-Mode:[[:space:]]*(none|autocomplete|assisted|agent)[[:space:]]*$' "$msg_file"; then
    return 0
  fi

  # AIDA_MODE is the pre-rename name, honoured for one release.
  mode="\${EVIDTRAIL_MODE:-$AIDA_MODE}"

  # Best-effort detection of known agent environments
  if [ -z "$mode" ]; then
    if [ -n "$CLAUDECODE" ] || [ -n "$CLAUDE_CODE_ENTRYPOINT" ]; then
      mode="agent"
    elif [ -n "$CURSOR_TRACE_ID" ]; then
      mode="assisted"
    fi
  fi

  # Repo-wide default, opt-in via .evidtrail.json { "defaultMode": "..." }.
  # .aida.json is the pre-rename file name, read for one release.
  if [ -z "$mode" ]; then
    for cfg in .evidtrail.json .aida.json; do
      if [ -f "$cfg" ]; then
        mode=$(sed -n 's/.*"defaultMode"[[:space:]]*:[[:space:]]*"\\([a-z]*\\)".*/\\1/p' "$cfg" | head -n 1)
        break
      fi
    done
  fi

  case "$mode" in
    none|autocomplete|assisted|agent) ;;
    *) return 0 ;;  # unknown stays unknown: write nothing
  esac

  # Comment lines are stripped by git; append before them so the trailer
  # survives into the final message.
  printf '\\nAI-Mode: %s\\n' "$mode" >> "$msg_file"
}

evidtrail_stamp_mode "$1" 2>/dev/null || true
${HOOK_END_MARKER}
`;
