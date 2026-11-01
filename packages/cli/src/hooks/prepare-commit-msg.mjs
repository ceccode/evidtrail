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
# Stamps 'AI-Mode: <mode>', 'Assisted-by: <tool>' when AI took part and the
# tool is known, and 'AI-Session: <agent>/<id>' when the person opted in, so
# commit provenance is declared, not inferred.
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

  # Best-effort detection of known agent environments. The tool is detected
  # on its own, so EVIDTRAIL_MODE=agent inside Claude Code still names it.
  detected_mode=""
  detected_agent=""
  if [ -n "$CLAUDECODE" ] || [ -n "$CLAUDE_CODE_ENTRYPOINT" ]; then
    detected_mode="agent"
    detected_agent="Claude Code"
  elif [ -n "$CURSOR_TRACE_ID" ]; then
    detected_mode="assisted"
    detected_agent="Cursor"
  fi

  mode="$EVIDTRAIL_MODE"
  [ -n "$mode" ] || mode="$detected_mode"

  # EVIDTRAIL_AGENT names a tool the hook cannot detect (Codex documents no
  # environment variable), or adds a model: "Claude Code:claude-opus-5-5".
  agent=$(printf '%s' "\${EVIDTRAIL_AGENT:-$detected_agent}" | tr -d '\\r\\n')

  # Repo-wide default, opt-in via .evidtrail.json { "defaultMode": "..." }.
  if [ -z "$mode" ] && [ -f .evidtrail.json ]; then
    mode=$(sed -n 's/.*"defaultMode"[[:space:]]*:[[:space:]]*"\\([a-z]*\\)".*/\\1/p' .evidtrail.json | head -n 1)
  fi

  has_assisted_by=""
  if grep -qiE '^Assisted-by:[[:space:]]*[^[:space:]]' "$msg_file"; then
    has_assisted_by=1
  fi

  # A person who wrote Assisted-by stated that AI took part. A repo-wide
  # 'none' prior must not stamp the opposite next to it.
  if [ -n "$has_assisted_by" ] && [ "$mode" = "none" ]; then
    return 0
  fi

  case "$mode" in
    none|autocomplete|assisted|agent) ;;
    *) return 0 ;;  # unknown stays unknown: write nothing
  esac

  # Assisted-by is the disclosure the Linux kernel, Fedora and LLVM ask for.
  # Written only when AI took part and the tool is known: a mode without a
  # tool name gets no guessed one.
  assisted_line=""
  case "$mode" in
    autocomplete|assisted|agent)
      if [ -n "$agent" ] && [ -z "$has_assisted_by" ]; then
        assisted_line="Assisted-by: $agent"
      fi
      ;;
  esac

  # Opt-in per person, via \`git config evidtrail.recordSession true\` or
  # EVIDTRAIL_RECORD_SESSION=1: point an AI commit at the agent session that
  # produced it. Not a .evidtrail.json key: these are your sessions, and
  # older evidtrail versions reject unknown keys there. EVIDTRAIL_SESSION
  # takes "<agent>/<id>" for agents the hook cannot detect. Only
  # filename-safe ids are written.
  session_line=""
  case "$mode" in
    autocomplete|assisted|agent)
      record="$EVIDTRAIL_RECORD_SESSION"
      if [ "$record" != "1" ] && \\
        [ "$(git config --bool --get evidtrail.recordSession 2>/dev/null)" = "true" ]; then
        record=1
      fi
      if [ "$record" = "1" ] && ! grep -qiE '^AI-Session:' "$msg_file"; then
        session="$EVIDTRAIL_SESSION"
        if [ -z "$session" ] && [ -n "$CLAUDE_CODE_SESSION_ID" ]; then
          session="claude-code/$CLAUDE_CODE_SESSION_ID"
        fi
        case "$session" in
          */.|*/..|./*|../*) session="" ;;
        esac
        if printf '%s' "$session" | grep -qE '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'; then
          session_line="AI-Session: $session"
        fi
      fi
      ;;
  esac

  # Comment lines are stripped by git; append before them so the trailer
  # survives into the final message.
  if [ -n "$assisted_line" ]; then
    printf '\\nAI-Mode: %s\\n%s\\n' "$mode" "$assisted_line" >> "$msg_file"
  else
    printf '\\nAI-Mode: %s\\n' "$mode" >> "$msg_file"
  fi
  if [ -n "$session_line" ]; then
    printf '%s\\n' "$session_line" >> "$msg_file"
  fi
}

evidtrail_stamp_mode "$1" 2>/dev/null || true
${HOOK_END_MARKER}
`;
