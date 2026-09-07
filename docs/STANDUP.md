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
- Seats: You, Maya, Jules, Priya, Floor, Product, Eng Supervisor + Eng Generic, Eng.Build, Eng.Review, DevOps, QA, Services Supervisor + Generic, Scout, Docs, Sec, Scribe
- Staffed teams: `@eng` and `@services` (Supervisor + Generic). `ship` is a run roster.
- Seed messages in `#ship` and `#incidents`

Reset:

```bash
rm -rf .roster-flow/state.json
npm run api
```

## Stable selectors (use these, not CSS soup)

| `data-testid` | Where |
|---|---|
| `team-eng` `team-inspector` `team-seat-count` | Teams rail + inspector |
| `hire-form` `hire-persona` `seat-model` | Specialist hire + seat model |
| `workspace-shell` | `/app` root |
| `mode-room` `mode-harness` `mode-chart` | Triple-mode toggle |
| `channel-ship` | `#ship` in the rail |
| `composer` | Room composer textarea |
| `send-message` | Send |
| `composer-attach` `composer-skill` `composer-file` `composer-mic` | Slack-style compose tools |
| `composer-picker` | Skill / file picker popover |
| `picker-item-{id}` | Picker row (`deploy`, `billing-webhook-ts`) |
| `message-{id}` | Thread row, e.g. `message-m2` |
| `chip-skill-{id}` `chip-file-{slug}` | Chips on a sent message |
| `run-ship-train` | Starts the compiled pipeline |
| `org-chart` | Chart canvas |
| `org-connectors` | SVG overlay (paths should hit seats) |
| `seat-{id}` | Seat button, e.g. `seat-build` |
| `seat-inspector` | Right inspector |
| `attach-harness` | Inspector attach |
| `harness-term` `harness-xterm` | Live OpenCode TUI (xterm) |
| `settings-providers` | Settings form |
| `provider-id` `provider-save` | Add provider |
| `access-form` | `/access` |

## Playwright

```bash
# API + Vite are started by webServer in playwright.config.ts
npm run test:e2e
```

Smoke covers: home render, workspace room send, skill/file chips, click message to open seat inspector, ship-train run card, org chart connectors present, settings provider save.

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

Two-bot proof (needs a provider key in env or Settings):

```bash
npm run prove:two-bot
```

This posts `product → build` with `wake: true`. It does **not** click Run ship train. Exit 2 means no key; exit 1 is a real failure.

Plugin + bus unit tests:

```bash
npm run test:unit
```

## Agent bug-test checklist

1. `/` — hero, Room \| Harness \| Chart mock toggles.
2. `/app` — send a message in `#ship`; it appears. Attach a skill and a workspace file; chips land on the message.
3. Click a Floor or Product message — inspector shows that seat.
4. Click **Run ship train** — Floor run card + bot messages land.
5. Mode **Chart** — connectors from parent seats to children (not floating mid-canvas). Resize to ~390px; lines still meet seats.
6. Click `seat-build` — inspector shows tools; **Attach harness** flips mode.
7. `/app/settings` — add a custom provider; GET `/api/v1/providers` shows it.
8. `/access` — submit form, success copy.
9. Hunt regressions: `/product`, `/org`, `/harness` still render the mock chart/room.
