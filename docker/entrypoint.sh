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

owner_of() { stat -c 'owner %u:%g, mode %a' "$1" 2>/dev/null || echo missing; }

# Mount points strictly below $1. Bind mounts from the same filesystem share
# its device number, so -xdev alone would walk into them.
mounts_under() {
  [ -r /proc/self/mountinfo ] || return 0
  cut -d' ' -f5 /proc/self/mountinfo | while IFS= read -r m; do
    m="$(printf '%b' "$m")"
    case "$m" in "$1"/*) echo "$m" ;; esac
  done
}

# Roots to walk: /data, plus each app directory mounted separately inside it.
# Any other mount inside /data is neither walked nor chowned.
walk_roots() {
  echo "$DATA_REAL"
  data_mounts="$(mounts_under "$DATA_REAL")"
  data_dev="$(stat -c %d "$DATA_REAL" 2>/dev/null || true)"
  for dir in "$HOME_DIR" "$SYSTEM" "$WORKSPACE" "$OC"; do
    under_data "$dir" || continue
    dir="$(readlink -m "$dir")"
    [ -d "$dir" ] || continue
    if printf '%s\n' "$data_mounts" | grep -qxF "$dir" \
      || [ "$(stat -c %d "$dir" 2>/dev/null || true)" != "$data_dev" ]; then
      echo "$dir"
    fi
  done
}

# find ROOT TESTS...: walks ROOT, pruning mount points below it. Only
# expressions go in TESTS (no global options such as -maxdepth).
find_under() {
  root="$1"
  shift
  n=$#
  prunes="$(mounts_under "$root")"
  while IFS= read -r m; do
    [ -n "$m" ] && set -- "$@" -path "$m" -prune -o
  done <<EOF
$prunes
EOF
  i=0
  while [ "$i" -lt "$n" ]; do
    set -- "$@" "$1"
    shift
    i=$((i + 1))
  done
  find "$root" -xdev "$@"
}

# chown entries under $1 whose uid/gid differ from the app user. find -P (the
# default) never follows symlinks and chown -h changes the link itself, not
# its target. find exits non-zero on anything it cannot read or chown (e.g.
# NFS root_squash); that must not abort the script, because prepare_as_app
# reports whatever is still inaccessible once privileges are dropped.
fix_owner() {
  dir="$1"
  [ -e "$dir" ] || return 0
  if [ -z "$(find_under "$dir" \( ! -uid "$APP_UID" -o ! -gid "$APP_GID" \) -print -quit 2>/dev/null || true)" ]; then
    return 0
  fi
  log "fixing ownership under $dir -> $APP_USER ($APP_UID:$APP_GID)"
  find_under "$dir" \( ! -uid "$APP_UID" -o ! -gid "$APP_GID" \) -exec chown -h "$APP_UID:$APP_GID" {} + \
    || log "warning: could not repair everything under $dir (read-only mount or NFS root_squash?); checking as $APP_USER next"
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
  walk_roots | while IFS= read -r root; do fix_owner "$root"; done
}

# Runs as the app user. Creates the app's directories and reports what the app
# cannot use: those directories, the config and state files it rewrites in
# place, and anything under /data owned by someone else that it cannot read,
# write, or (for directories) enter.
prepare_as_app() {
  bad=""
  for dir in "$DATA" "$WORKSPACE" "$SYSTEM" "$SYSTEM_OC/agents" "$OC/agents" "$HOME_DIR" \
    "$HOME_DIR/.local" "$HOME_DIR/.local/share" "$HOME_DIR/.local/state" "$HOME_DIR/.config" "$HOME_DIR/.cache"; do
    mkdir -p "$dir" 2>/dev/null || true
    if [ ! -d "$dir" ] || [ ! -r "$dir" ] || [ ! -w "$dir" ] || [ ! -x "$dir" ]; then
      bad="$bad
  $dir ($(owner_of "$dir"))"
    fi
  done
  # find exits non-zero when it meets a directory it cannot read; those are
  # exactly what we report, so its status must not trip set -e.
  list_paths() {
    "$@" -exec sh -c \
      'for f; do printf "\n  %s (%s)" "$f" "$(stat -c "owner %u:%g, mode %a" "$f")"; done' sh {} + 2>/dev/null || true
  }
  for dir in "$DATA" "$OC" "$OC/agents" "$SYSTEM_OC" "$SYSTEM_OC/agents"; do
    [ -d "$dir" ] && [ -x "$dir" ] || continue
    bad="$bad$(list_paths find "$dir" -mindepth 1 -maxdepth 1 -type f \( ! -readable -o ! -writable \))"
  done
  # Entries we own but made read-only (e.g. git objects) are deliberate, so
  # only foreign-owned entries count as unwritable.
  roots="$(walk_roots)"
  while IFS= read -r root; do
    bad="$bad$(list_paths find_under "$root" \( -type d -o -type f \) \
      \( ! -readable -o -type d ! -executable -o ! -uid "$(id -u)" ! -writable \))"
  done <<EOF
$roots
EOF
  [ -z "$bad" ] && return 0
  total="$(printf '%s\n' "$bad" | sed '/^$/d' | sort -u | wc -l)"
  bad="$(printf '\n%s' "$(printf '%s\n' "$bad" | sed '/^$/d' | sort -u | head -n 25)")"
  [ "$total" -le 25 ] || bad="$bad
  ... and $((total - 25)) more"

  me="$(id -un 2>/dev/null || id -u) (uid $(id -u))"
  if [ "${ROSTER_ENTRYPOINT_DROPPED:-}" = "1" ]; then
    die "ownership was repaired as root, but $me still cannot read or write:$bad
Check for a read-only mount, an NFS export with root_squash, or a symlink out of $DATA."
  fi
  die "running as $me without root, so ownership under $DATA cannot be repaired, and it cannot read or write these:$bad
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
