# CORE API — chatbots, teams, bus, harness

Base URL: `http://127.0.0.1:8790` (Vite proxies `/api` there in `npm run dev`). `docker compose up` serves the UI and API on **5173** (same origin as `/setup` and `/app`) and also publishes the API on **8790** so it does not collide with mcp-flow on 8787.

Local standup has a **local owner account** after first-run setup. Send `Authorization: Bearer <token>` from `POST /api/v1/auth/login`. `ROSTER_SKIP_ONBOARDING=1` leaves the API open and still accepts `Authorization: Bearer roster-demo`.

Existing `.roster-flow/state.json` without an `onboarding` field is treated as already complete.

All JSON. Times are ISO-8601. Seat IDs match the org chart (`product`, `build`, `qa`, …).

## Setup and auth

Public without a session: `GET /health`, `GET /setup/status`, `POST /setup/install`, `POST /setup/first-user`, `POST /auth/login`. Everything else needs a bearer token unless `ROSTER_SKIP_ONBOARDING=1`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/setup/status` | Wizard resume (`step`: install / first_user / login / harness / welcome / done) |
| POST | `/api/v1/setup/install` | Mark the installation checklist seen |
| POST | `/api/v1/setup/first-user` | Create the owner `{ name, email, password }` — **409** if a user exists |
| POST | `/api/v1/setup/harness` | `{ skipped?: true }` — mark harness step done |
| POST | `/api/v1/setup/complete` | `{ template: "starter" \| "empty" }` applies the org and finishes setup |
| POST | `/api/v1/auth/login` | `{ email, password }` → `{ token, user }` |
| GET | `/api/v1/auth/me` | Current owner |
| POST | `/api/v1/auth/logout` | Drop this token |

`GET /api/v1/state` never includes `users` or `authSessions`. Passwords are scrypt hashes.

## Health and harness

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | API + company OpenCode status (`harness`) plus `systemHarness` |
| POST | `/api/v1/harness/ensure` | Start or reuse `opencode serve` (`{ forceRestart, kind?: "company" \| "system" }`) |
| GET | `/api/v1/harness` | Company serve plus `systemHarness` (Architect / Channel) |
| WS | `/api/v1/harness/pty?seat=<id>` | xterm PTY: `opencode attach --session` |
| POST | `/api/v1/seats/:id/attach` | Ensure serve, wake seat, return real `sessionId` + attach command |
| GET | `/api/v1/opencode/config` | Current `opencode.json` written by settings |

`POST /api/v1/harness/ensure` body: `{ "forceRestart": false, "kind": "company" }`. `kind: "system"` starts the dedicated System serve (port `OPENCODE_SYSTEM_PORT` / 14181, workspace `.roster-flow/system`). Architect chat auto-ensures System.

## Teams and bots

Staffed teams (`eng`, `services`) always have a **Supervisor** and a **Generic** seat. `ship` is a run roster only.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/teams` | Rosters plus `seatCount` and `models[]` in use |
| POST | `/api/v1/teams` | Create a staffed team (Supervisor + Generic + optional specialists) |
| GET | `/api/v1/teams/:id` | One team, enriched |
| PATCH | `/api/v1/teams/:id` | Charter, default/fallback model, strategy |
| GET | `/api/v1/bots` | Bot seats only |
| GET | `/api/v1/seats` | Full org (humans + bots) |
| GET | `/api/v1/organizations` | Single starter org |
| GET | `/api/v1/projects` | Projects under the org |
| POST | `/api/v1/projects` | Create a project (`name`, `brief`, `constitution`) |
| GET | `/api/v1/projects/:id` | One project |
| PATCH | `/api/v1/projects/:id` | Brief, constitution, PM seat, teams |
| POST | `/api/v1/seats` | Hire a seat (specialist when `team` is set; `projectId` + `asPm` for a project PM) |
| PATCH | `/api/v1/seats/:id` | Reparent, model, persona, instructions, tools |
| DELETE | `/api/v1/seats/:id` | Fire a seat (not `you` or system). Orphans reparent to the manager. |

`POST /api/v1/teams`:

```json
{
  "name": "platform",
  "role": "Platform",
  "description": "Shared infra",
  "job": "Keep CI green",
  "rules": "No prod deploys",
  "defaultModel": "anthropic/claude-sonnet",
  "fallbackModel": "xai/grok-4",
  "modelStrategy": "round_robin",
  "specialists": [{ "name": "Platform.API", "persona": "API implementer." }]
}
```

Creates `platform-supervisor` and `platform-generic`. Optional `specialists[]` hire at create time. `modelStrategy` is `default` | `random` | `round_robin` | `fuse`.

`to: "team:eng"` on the bus wakes that team's Supervisor.

Seat `model` is an OpenCode catalog id (`provider/model`). Changing a bot seat rewrites `.opencode/agents/<id>.md`.

`POST /api/v1/teams` accepts `projectId` to hang the team under a project. Unset `projectId` means org-shared (services).

## Architect

Chart-mode planner. Proposes an `OrgPlan`; nothing mutates until Apply.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/architect/chat` | `{ message, history? }` → `{ reply, plan, source }` |
| POST | `/api/v1/architect/apply` | `{ planId }` applies ops via hire / team / fire / create_project |
| GET | `/api/v1/architect/plans/:id` | Stored plan |

`POST /api/v1/architect/apply` records an approved `strategy` approval (actor You) then applies. Chart hire (`POST /api/v1/seats`) is owner-immediate and writes an approved `hire` row. `POST /api/v1/approvals` creates `pending`; pending hire/strategy does not mutate until `POST /api/v1/approvals/:id/approve`.

`source` is `live` when the Architect System-harness session answered. Keyword templates run only when `ROSTER_ARCHITECT_MODE=template` (tests). Missing OpenCode is an error, not a silent mock. Ops: `replace_org`, `create_project`, `create_team`, `hire`, `reparent`, `fire` (max 48). `replace_org` keeps You / Channel / Architect and clears the rest before later ops.

## Goals, inbox, board, routines

Company loop verbs. `GET /api/v1/state` includes `goals`, `approvals`, `routines` (webhook secrets stripped), `inboxCursors`, `pausedRunIds`, and `inboxUnread`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/goals` | Org goals (`id`, `title`, `description`, `parentId`, `status`) |
| POST | `/api/v1/goals` | Create a goal |
| PATCH | `/api/v1/projects/:id` | Also accepts `goalIds` |
| GET | `/api/v1/seats/:id/inbox` | Bus mail for this seat (direct, `team:` if Supervisor, `channel:` / `#room` membership, `ask_human`) |
| GET | `/api/v1/seats/me/inbox` | Inbox for You |
| POST | `/api/v1/seats/:id/inbox/read` | `{ beforeId }` — mark unread after that bus id as read |
| POST | `/api/v1/seats/:id/pause` | Pause a bot (not You). System seats can pause; fire is still DELETE |
| POST | `/api/v1/seats/:id/resume` | Resume a paused bot |
| POST | `/api/v1/teams/:id/pause` | Pause every bot seat on the team |
| POST | `/api/v1/runs/:runId/kill` | Add to `pausedRunIds` — `wakeSeat` returns `{ paused: true }` |
| GET | `/api/v1/approvals` | Optional `?status=pending` |
| POST | `/api/v1/approvals` | `{ kind: hire\|strategy\|budget_override\|deploy, payload?, planId?, seatId? }` — pending |
| POST | `/api/v1/approvals/:id/approve` | Approve and, for hire/strategy, apply |
| POST | `/api/v1/approvals/:id/reject` | Reject; no org mutation |
| GET | `/api/v1/routines` | Scheduled wakes (CORE process only) |
| POST | `/api/v1/routines` | `{ seatId, title, intervalMinutes, prompt, cron?, timezone?, impliesDeploy?, enabled? }` |
| PATCH | `/api/v1/routines/:id` | Enable/pause, prompt, interval |
| POST | `/api/v1/routines/:id/run` | Manual or webhook run — posts bus `{ from: "routine", wake: true }` |

Wake prompts prepend linked goal title, project brief, constitution, and `meta.runId` when present. `wakeSeat` does not prompt when the seat is paused or the run is killed. Create/run a routine is rejected when `impliesDeploy` (or the prompt is clearly a deploy) and the seat `deny` includes `deploy`. Tick coalesces with another wake to the same seat in the same minute.

Plugin tool: `roster_inbox`.

## Tasks (claim locks)

Durable units Channel can compile into. `dependOn` is the shipped `depend_on` field. Two claims: first mutate wins (409 after).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/tasks` | Optional `?projectId=` `?runId=` |
| POST | `/api/v1/tasks` | `{ title, projectId?, runId?, ownerSeatId?, dependOn? \| depend_on?, path? }` |
| POST | `/api/v1/tasks/:id/claim` | `{ seatId }` — **409** if claimed or a blocker is open |
| POST | `/api/v1/tasks/:id/complete` | Mark done; unblocks dependents |

Plugin tools: `roster_task_create`, `roster_task_claim`, `roster_task_complete`. `GET /api/v1/state` includes `tasks`.

## Rooms and threads

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/channels` | Channels plus membership |
| POST | `/api/v1/channels` | Create a room (`name`, `teamIds`, `seatIds`) |
| PATCH | `/api/v1/channels/:id` | Add/remove teams and seats |
| GET | `/api/v1/channels/:id/messages` | Messages in a channel |
| POST | `/api/v1/channels/:id/messages` | Post as You; parse `@channel` / `@eng` / `@build` and wake |
| GET | `/api/v1/threads` | Thread index |
| GET | `/api/v1/threads/:id` | One thread |

`POST /api/v1/channels/:id/messages` body:

```json
{
  "text": "Talk to Product and the Eng team…",
  "who": "You",
  "seatId": "you",
  "skills": [{ "id": "deploy", "name": "deploy" }],
  "files": [{ "path": "billing/webhook.ts", "name": "webhook.ts" }],
  "attachments": [{ "id": "att_1", "name": "screenshot.png", "size": 24012, "type": "image/png" }]
}
```

`text` may be empty when at least one of `skills`, `files`, `attachments`, or `blocks` is present. Mentions wake the bus: `@build` a seat, `@eng` the team Supervisor, `@channel` notifies members and wakes the Channel conductor.

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

`POST /api/v1/messages` and `POST /api/v1/bus/send` also accept optional `blocks` (Roster Block Kit array). `text` may be omitted when `blocks` is present.

## Roster Block Kit

Bots can attach a Slack-shaped `blocks` array on room messages. Types: `header`, `section`, `divider`, `context`, `image`, `actions`, `markdown`. Buttons with `action_id` post back to the originating seat.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/block-actions` | `{ messageId, actionId, value?, userId? }` → bus `block_actions` + wake |

Builder UI: `/app/blocks`. SDK: `roster-flow-blocks` (`Blocks`, `Elements`, `validateBlocks`).

```json
{
  "text": "New request",
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "New request" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "*Type:* Paid Time Off" } }
  ]
}
```

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
