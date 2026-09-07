# CORE API — chatbots, teams, bus, harness

Base URL: `http://127.0.0.1:8787` (Vite proxies `/api` there in `npm run dev`).

Local standup has **no real auth**. Optional header: `Authorization: Bearer roster-demo`.

All JSON. Times are ISO-8601. Seat IDs match the org chart (`product`, `build`, `qa`, …).

## Health and harness

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | API + OpenCode status (`harness: "up" \| "offline"`) |
| POST | `/api/v1/harness/ensure` | Start or reuse `opencode serve` (Everflow ensure pattern) |
| GET | `/api/v1/harness` | Port, version, workspace, plugin path |
| GET | `/api/v1/opencode/config` | Current `opencode.json` written by settings |

`POST /api/v1/harness/ensure` body: `{ "forceRestart": false }`.

## Teams and bots

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/teams` | Named rosters (`eng`, `services`, `ship`) |
| GET | `/api/v1/bots` | Bot seats only |
| GET | `/api/v1/seats` | Full org (humans + bots) |
| POST | `/api/v1/seats` | Hire a seat (same fields as the chart hire form) |
| PATCH | `/api/v1/seats/:id` | Reparent, model, tools |

## Rooms and threads

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/channels` | Channels |
| GET | `/api/v1/channels/:id/messages` | Messages in a channel |
| POST | `/api/v1/channels/:id/messages` | Post as You (or `{ "who": "Maya" }`) |
| GET | `/api/v1/threads` | Thread index |
| GET | `/api/v1/threads/:id` | One thread |

`POST /api/v1/channels/:id/messages` body:

```json
{ "text": "Talk to Product and the Eng team…", "who": "You" }
```

If the text looks like a ship-train sentence, the API compiles a run (same as the workspace “Run ship train” button).

## Bot / team messaging

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/messages` | Send to a bot, team, or channel via the bus |
| GET | `/api/v1/bus` | Audited bus log |
| POST | `/api/v1/bus/send` | `send_message` / `handoff` / `report` / `ask_human` |

`POST /api/v1/messages`:

```json
{ "to": "build", "text": "Acceptance is ready. Implement webhook idempotency.", "from": "product" }
```

`to` may be a seat id, `team:eng`, or `channel:ship`.

`POST /api/v1/bus/send`:

```json
{
  "from": "product",
  "to": "build",
  "kind": "handoff",
  "text": "Brief + acceptance attached.",
  "wake": true
}
```

`wake: true` starts (or continues) the recipient’s OpenCode session when the harness is up.

## Autonomous runs

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/runs` | Compile + start a run |
| GET | `/api/v1/runs` | Recent runs |
| GET | `/api/v1/runs/:id` | Status, steps, bus ids |
| POST | `/api/v1/runs/:id/cancel` | Kill switch |

`POST /api/v1/runs`:

```json
{
  "prompt": "Talk to Product and the Eng team. When they complete, have DevOps deploy to staging and QA test everything.",
  "channel": "ship"
}
```

Steps default to Product → Eng.Build → Eng.Review → You (confirm) → DevOps → QA. Each bot step posts to the channel and sends a bus handoff to the next seat. With OpenCode up, bot steps also `prompt` that seat’s session.

## OpenCode sessions (proxy)

Used when `harness === "up"`:

| Method | Path | Maps to OpenCode |
|---|---|---|
| GET | `/api/v1/harness/sessions` | `GET /session` |
| POST | `/api/v1/harness/sessions` | `POST /session` `{ title, agent? }` |
| POST | `/api/v1/harness/sessions/:id/prompt` | async prompt |
| POST | `/api/v1/seats/:id/attach` | Ensure session bound to this seat |

## Providers and models (OpenChamber-shaped)

Settings UI at `/app/settings` writes these.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/providers` | Configured providers + connected flag |
| PUT | `/api/v1/providers` | Upsert provider block into `opencode.json` |
| POST | `/api/v1/providers/:id/auth` | Store API key (env ref or sidecar; never returned raw) |
| DELETE | `/api/v1/providers/:id` | Remove provider + auth |
| GET | `/api/v1/models` | Flattened model list |

`PUT /api/v1/providers`:

```json
{
  "id": "xai",
  "name": "xAI",
  "npm": "@ai-sdk/openai-compatible",
  "baseURL": "https://api.x.ai/v1",
  "models": [{ "id": "grok-4", "name": "Grok 4" }],
  "apiKeyEnv": "XAI_API_KEY"
}
```

Literal keys go to `.roster-flow/auth.json` (gitignored) and `{env:VAR}` is preferred in `opencode.json`, same idea as OpenChamber writing OpenCode config + auth.

## Errors

`4xx/5xx` JSON: `{ "error": "string", "detail": "…" }`. `409` if ensure is called and the CLI is missing.
