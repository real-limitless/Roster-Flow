#!/usr/bin/env bash
# Capture marketing + workspace screenshots → docs/images/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules/playwright ]]; then
  echo "Installing project deps (playwright)…"
  npm install
  npx playwright install chromium
fi

export BASE_URL="${BASE_URL:-http://127.0.0.1:5173}"

if ! curl -sf "${BASE_URL}/" >/dev/null; then
  echo "Nothing is listening on ${BASE_URL}."
  echo "Start the site first: npm run standup"
  exit 1
fi

npx playwright install chromium >/dev/null
node docs/campaign/capture.mjs
