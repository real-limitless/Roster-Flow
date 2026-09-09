#!/usr/bin/env bash
set -euo pipefail
PORT="${ROSTER_HTTP_PORT:-5173}"
API="${ROSTER_API_PORT:-8790}"
curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null
curl -fsS "http://127.0.0.1:${API}/api/v1/health" >/dev/null || curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null
echo "roster-flow ok UI :${PORT} API :${API}"
