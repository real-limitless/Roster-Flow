#!/bin/sh
# Container entrypoint (docs/STANDUP.md, "Data volume ownership").
#
# As root: create /data/{home,system,workspace,opencode} and chown everything
# under /data to the app user, touching only entries whose owner is wrong and
# never following symlinks out of /data. Then re-exec this script as the app
# user, which
# creates the directories, verifies they are writable, and runs the command
# (default: node server/index.mjs). Started without root, it only verifies,
# and exits 1 with a clear message instead of letting the app hit EACCES.
set -eu

DATA="${ROSTER_DATA_DIR:-/data}"
OC="${ROSTER_OPENCODE_DIR:-$DATA/opencode}"
HOME_DIR="${HOME:-$DATA/home}"
WORKSPACE="${ROSTER_WORKSPACE:-$DATA/workspace}"
SYSTEM="$DATA/system"
SYSTEM_OC="$SYSTEM/.opencode"
APP_USER="${ROSTER_APP_USER:-node}"
API_PORT="${ROSTER_API_PORT:-8790}"

export HOME="$HOME_DIR"
export ROSTER_DATA_DIR="$DATA"
export ROSTER_OPENCODE_DIR="$OC"
export ROSTER_STATIC_DIR="${ROSTER_STATIC_DIR:-/app/dist}"
export ROSTER_API_HOST="${ROSTER_API_HOST:-0.0.0.0}"
export ROSTER_API="${ROSTER_API:-http://127.0.0.1:$API_PORT}"
export OPENCODE_BIN="${OPENCODE_BIN:-/usr/local/bin/opencode}"

[ "$#" -gt 0 ] || set -- node server/index.mjs

log() { echo "entrypoint: $*" >&2; }
die() {
  echo "entrypoint: ERROR: $*" >&2
  exit 1
}

DATA_REAL="$(readlink -m "$DATA")"

under_data() {
  case "$(readlink -m "$1")" in
    "$DATA_REAL" | "$DATA_REAL"/*) return 0 ;;
  esac
  return 1
}

owner_of() { stat -c '%u:%g' "$1" 2>/dev/null || echo missing; }

# chown entries under $1 (resolved, inside /data) whose uid/gid differ from the
# app user. Extra find arguments narrow the walk. find -P (the default) never
# follows symlinks and chown -h changes the link itself, not its target.
fix_owner() {
  dir="$1"
  shift
  [ -e "$dir" ] || return 0
  if [ -z "$(find "$dir" "$@" \( ! -uid "$APP_UID" -o ! -gid "$APP_GID" \) -print -quit)" ]; then
    return 0
  fi
  log "fixing ownership under $dir -> $APP_USER ($APP_UID:$APP_GID)"
  find "$dir" "$@" \( ! -uid "$APP_UID" -o ! -gid "$APP_GID" \) -exec chown -h "$APP_UID:$APP_GID" {} + \
    || die "could not chown $dir to $APP_USER ($APP_UID:$APP_GID). Is the volume read-only or an NFS export with root_squash?"
}

repair_as_root() {
  if ! command -v setpriv >/dev/null 2>&1; then
    die "running as root but setpriv (util-linux) is missing, so the app cannot drop to $APP_USER"
  fi
  if ! id "$APP_USER" >/dev/null 2>&1; then
    die "running as root but user $APP_USER does not exist, so the app cannot drop privileges"
  fi
  APP_UID="$(id -u "$APP_USER")"
  APP_GID="$(id -g "$APP_USER")"

  if [ -L "$DATA" ] && [ ! -d "$DATA" ]; then
    die "$DATA is a dangling symlink"
  fi
  mkdir -p "$DATA"
  for dir in "$HOME_DIR" "$SYSTEM" "$WORKSPACE" "$OC"; do
    if under_data "$dir"; then
      mkdir -p "$(readlink -m "$dir")"
    else
      case "$dir" in
        "$DATA"/*) log "not creating or repairing $dir: it resolves outside $DATA through a symlink" ;;
      esac
    fi
  done
  fix_owner "$DATA_REAL"
}

# Runs as the app user. Creates the app's directories and reports what the app
# could not write: those directories, the config and state files it rewrites
# in place, and anything under /data owned by someone else and not writable.
prepare_as_app() {
  bad=""
  for dir in "$DATA" "$WORKSPACE" "$SYSTEM" "$SYSTEM_OC/agents" "$OC/agents" "$HOME_DIR" \
    "$HOME_DIR/.local" "$HOME_DIR/.local/share" "$HOME_DIR/.local/state" "$HOME_DIR/.config" "$HOME_DIR/.cache"; do
    mkdir -p "$dir" 2>/dev/null || true
    if [ ! -d "$dir" ] || [ ! -w "$dir" ] || [ ! -x "$dir" ]; then
      bad="$bad
  $dir (owner $(owner_of "$dir"))"
    fi
  done
  list_unwritable() {
    find "$@" ! -writable -exec sh -c \
      'for f; do printf "\n  %s (owner %s)" "$f" "$(stat -c %u:%g "$f")"; done' sh {} + 2>/dev/null
  }
  for dir in "$DATA" "$OC" "$OC/agents" "$SYSTEM_OC" "$SYSTEM_OC/agents"; do
    [ -d "$dir" ] && [ -x "$dir" ] || continue
    bad="$bad$(list_unwritable "$dir" -mindepth 1 -maxdepth 1 -type f)"
  done
  # Entries we own but made read-only (e.g. git objects) are deliberate.
  bad="$bad$(list_unwritable "$DATA_REAL" \( -type d -o -type f \) ! -uid "$(id -u)")"
  [ -z "$bad" ] && return 0
  total="$(printf '%s\n' "$bad" | sed '/^$/d' | sort -u | wc -l)"
  bad="$(printf '\n%s' "$(printf '%s\n' "$bad" | sed '/^$/d' | sort -u | head -n 25)")"
  [ "$total" -le 25 ] || bad="$bad
  ... and $((total - 25)) more"

  me="$(id -un 2>/dev/null || id -u) (uid $(id -u))"
  if [ "${ROSTER_ENTRYPOINT_DROPPED:-}" = "1" ]; then
    die "ownership was repaired as root, but $me still cannot write:$bad
Check for a read-only mount, an NFS export with root_squash, or a symlink out of $DATA."
  fi
  die "running as $me without root, so ownership under $DATA cannot be repaired, and these are not writable:$bad
Fix: run the container as root (the image default; remove any user: override in compose or Dokploy) so this entrypoint can chown them to $APP_USER, or chown -R the volume to uid $(id -u) once from the host."
}

if [ "$(id -u)" = "0" ]; then
  repair_as_root
  exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --init-groups \
    env ROSTER_ENTRYPOINT_DROPPED=1 /bin/sh "$0" "$@"
fi

prepare_as_app
unset ROSTER_ENTRYPOINT_DROPPED
exec "$@"
