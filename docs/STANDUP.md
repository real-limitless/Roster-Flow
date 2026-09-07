# Standup path — humans and Playwright agents

Goal: an AI agent can install, seed, open the site, and bug-test Room / Harness / Chart / Settings end to end.

## Prerequisites

- Node 20+ (Node 22 is fine)
- npm
- Optional: [OpenCode CLI](https://opencode.ai) on `PATH`, or `OPENCODE_BIN=/path/to/opencode`
- Optional provider keys in the environment (`XAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …)

No login. Local demo is open. Seed roster loads automatically.

## Install

```bash
cd roster-flow
npm install
cp -n .env.example .env
npx playwright install chromium   # first time only
```

## Run (one command)

```bash
npm run standup
```

This starts:

| Process | URL | Role |
|---|---|---|
| CORE API | http://127.0.0.1:8787 | Teams, bots, bus, harness wrapper |
| Vite | http://127.0.0.1:5173 | Marketing + `/app` workspace |

Or separately:

```bash
npm run api          # :8787
npm run dev          # :5173, proxies /api → :8787
```

Health check:

```bash
curl -s http://127.0.0.1:8787/api/v1/health
curl -s http://127.0.0.1:5173/app
```

## URLs an agent should use

| URL | What to test |
|---|---|
| http://127.0.0.1:5173/ | Marketing home |
| http://127.0.0.1:5173/app | Live workspace (Room default) |
| http://127.0.0.1:5173/app?mode=chart | Org chart |
| http://127.0.0.1:5173/app/settings | Providers / models |
| http://127.0.0.1:5173/org | Marketing org page + mock |
| http://127.0.0.1:5173/access | Access form |

## Auth

None. If you send `Authorization: Bearer roster-demo` the API accepts it. Do not invent other tokens.

## Seed / demo data

On first API boot, `server/seed.mjs` writes `.roster-flow/state.json` from the same starter company as `src/data.ts`:

- Channels: `#ship`, `#incidents`, `#eng-agents`, `#general`
- Seats: You, Maya, Jules, Priya, Floor, Product, Eng.Build, Eng.Review, DevOps, QA, Scout, Docs, Sec, Scribe
- Seed messages in `#ship` and `#incidents`

Reset:

```bash
rm -rf .roster-flow/state.json
npm run api
```

## Stable selectors (use these, not CSS soup)

| `data-testid` | Where |
|---|---|
| `workspace-shell` | `/app` root |
| `mode-room` `mode-harness` `mode-chart` | Triple-mode toggle |
| `channel-ship` | `#ship` in the rail |
| `composer` | Room composer input |
| `send-message` | Send |
| `run-ship-train` | Starts the compiled pipeline |
| `org-chart` | Chart canvas |
| `org-connectors` | SVG overlay (paths should hit seats) |
| `seat-{id}` | Seat button, e.g. `seat-build` |
| `seat-inspector` | Right inspector |
| `attach-harness` | Inspector attach |
| `settings-providers` | Settings form |
| `provider-id` `provider-save` | Add provider |
| `access-form` | `/access` |

## Playwright

```bash
# API + Vite are started by webServer in playwright.config.ts
npm run test:e2e
```

Smoke covers: home render, workspace room send, ship-train run card, org chart connectors present, settings provider save.

Headed (watch the agent):

```bash
npm run test:e2e -- --headed
```

## OpenCode (optional)

```bash
export OPENCODE_BIN=$(command -v opencode)
curl -s -X POST http://127.0.0.1:8787/api/v1/harness/ensure -H 'content-type: application/json' -d '{"forceRestart":false}'
```

If the CLI is missing, health returns `"harness":"offline"` and the room still works. That is expected — do not treat it as a site bug.

## Agent bug-test checklist

1. `/` — hero, Room \| Harness \| Chart mock toggles.
2. `/app` — send a message in `#ship`; it appears.
3. Click **Run ship train** — Floor run card + bot messages land.
4. Mode **Chart** — connectors from parent seats to children (not floating mid-canvas). Resize to ~390px; lines still meet seats.
5. Click `seat-build` — inspector shows tools; **Attach harness** flips mode.
6. `/app/settings` — add a custom provider; GET `/api/v1/providers` shows it.
7. `/access` — submit form, success copy.
8. Hunt regressions: `/product`, `/org`, `/harness` still render the mock chart/room.
