#!/usr/bin/env bash
# Capture marketing, workspace, setup, and login screenshots → docs/images/
# Workspace frames need the skipped-onboarding standup (ROSTER_SKIP_ONBOARDING=1).
# Setup / login frames spin a temporary API so they do not touch .roster-flow.
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
