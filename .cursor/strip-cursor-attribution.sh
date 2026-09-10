#!/usr/bin/env bash
# Environment hygiene: strip Cursor commit co-author attribution.
# Safe to run on every agent start. Idempotent. Does not install app deps.
set -euo pipefail

HOOKS_ROOT="${CURSOR_AGENT_HOOKS_ROOT:-/home/ubuntu/.cursor/agent-hooks}"
GIT_HOOKS="${GIT_DIR:-$(git rev-parse --git-dir 2>/dev/null || echo .git)}/hooks"
STRIP_HOOK="${GIT_HOOKS}/commit-msg"

reap_coauthor_files() {
  if [[ ! -d "$HOOKS_ROOT" ]]; then
    return 0
  fi
  find "$HOOKS_ROOT" -type f \( -name 'commit-msg.cursor.co-author' -o -name '*co-author*' \) -delete 2>/dev/null || true
}

install_strip_hook() {
  mkdir -p "$GIT_HOOKS"
  cat > "$STRIP_HOOK" <<'HOOK'
#!/usr/bin/env bash
# Strip Cursor / cursoragent co-author lines from commit messages.
set -euo pipefail
msg="${1:-}"
[[ -n "$msg" && -f "$msg" ]] || exit 0
tmp="$(mktemp)"
grep -viE \
  -e '^[[:space:]]*Co-authored-by:[[:space:]].*[Cc]ursor' \
  -e '^[[:space:]]*Co-authored-by:[[:space:]].*cursoragent@cursor\.com' \
  -e '^[[:space:]]*Made with [Cc]ursor' \
  -e 'cursoragent@cursor\.com' \
  "$msg" > "$tmp" || true
mv "$tmp" "$msg"
HOOK
  chmod +x "$STRIP_HOOK"
}

reap_coauthor_files
install_strip_hook

# Reaper: Cursor may recreate commit-msg.cursor.co-author at commit time.
if command -v inotifywait >/dev/null 2>&1 && [[ -d "$HOOKS_ROOT" ]]; then
  if ! pgrep -f "strip-cursor-attribution-reaper" >/dev/null 2>&1; then
    (
      # shellcheck disable=SC2034
      STRIP_CURSOR_ATTRIBUTION_REAPER=1
      while inotifywait -q -r -e create,moved_to "$HOOKS_ROOT" >/dev/null 2>&1; do
        reap_coauthor_files
      done
    ) >/dev/null 2>&1 &
    disown || true
  fi
fi

reap_coauthor_files
exit 0
