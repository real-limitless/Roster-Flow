#!/bin/sh
set -eu

DATA="${ROSTER_DATA_DIR:-/data}"
OC="${ROSTER_OPENCODE_DIR:-$DATA/opencode}"
HOME_DIR="${HOME:-$DATA/home}"

mkdir -p "$DATA/workspace" "$DATA/system" "$HOME_DIR" "$OC/agents"
API_PORT="${ROSTER_API_PORT:-8787}"
export HOME="$HOME_DIR"
export ROSTER_DATA_DIR="$DATA"
export ROSTER_OPENCODE_DIR="$OC"
export ROSTER_STATIC_DIR="${ROSTER_STATIC_DIR:-/app/dist}"
export ROSTER_API_HOST="${ROSTER_API_HOST:-0.0.0.0}"
export ROSTER_API="${ROSTER_API:-http://127.0.0.1:$API_PORT}"
export OPENCODE_BIN="${OPENCODE_BIN:-/usr/local/bin/opencode}"

if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1 && id node >/dev/null 2>&1; then
  if ! setpriv --reuid=node --regid=node --init-groups test -w "$DATA"; then
    chown -R node:node "$DATA"
  fi
  exec setpriv --reuid=node --regid=node --init-groups \
    env HOME="$HOME_DIR" node server/index.mjs
fi

exec node server/index.mjs
