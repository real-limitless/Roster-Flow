# CORE API — chatbots, teams, bus, harness

Base URL: `http://127.0.0.1:8790` (Vite proxies `/api` there in `npm run dev`). `docker compose up` exposes **5175** (`ROSTER_WEB_PORT`) and **8790** (`ROSTER_API_PORT`) on the compose network only and does not publish them on the host. 8787 is mcp-flow.

Local standup has a **local owner account** after first-run setup. Send `Authorization: Bearer <token>` from `POST /api/v1/auth/login`. `ROSTER_SKIP_ONBOARDING=1` leaves the API open and still accepts `Authorization: Bearer roster-demo`.

Existing `.roster-flow/state.json` without an `onboarding` field is treated as already complete.

All JSON. Times are ISO-8601. Seat IDs match the org chart (`product`, `build`, `qa`, …).

## Setup and auth

Public without a session: `GET /health`, `GET /setup/status`, `POST /setup/install`, `POST /setup/first-user`, `POST /auth/login`, `POST /access`. `POST /setup/start-over` is reachable without a session so a logged-out owner can send a password, and it does not wipe an existing owner unless that proof succeeds. Everything else needs a bearer token unless `ROSTER_SKIP_ONBOARDING=1`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/setup/status` | Public callers get booleans only (`hasOwner`, `setupClosed`, `complete`, `authenticated`, `installSeen`, …). No owner email or name. A session may also receive `step` (install / first_user / login / harness / welcome / done) and that caller's own name and email. |
| POST | `/api/v1/setup/install` | Mark the installation checklist seen |
| POST | `/api/v1/setup/first-user` | Create the owner `{ name, email, password }` — **409** if a user exists |
| POST | `/api/v1/setup/harness` | `{ skipped?: true }` — mark harness step done |
| POST | `/api/v1/setup/complete` | `{ template: "starter" \| "empty" }` applies the org and finishes setup |
| POST | `/api/v1/setup/start-over` | `{ email, confirm: true, password? }`. When an owner exists (`setupClosed`), requires a valid owner session (login bearer, or an admin API token for that owner) **or** the owner's `password`, plus `ROSTER_BOOTSTRAP_TOKEN` when that env is set (`x-roster-bootstrap-token` or `bootstrapToken`). Authentication is checked before the email. Anonymous callers always get **401** (missing or wrong session, password, or bootstrap token), whether or not the email matches. **403** is only for an authenticated caller whose email does not match, or an API token that is not `admin`. Wipes org + users and reopens `/setup` |
| POST | `/api/v1/auth/login` | `{ email, password }` → `{ token, user }` |
| GET | `/api/v1/auth/me` | Current owner |
| POST | `/api/v1/auth/logout` | Drop this token |
| POST | `/api/v1/auth/password` | `{ current, next }` — owner is signed in. Other sessions are revoked; this token stays valid. |

`GET /api/v1/state` never includes `users`, `authSessions`, or waitlist PII. Passwords are scrypt hashes.

## Access waitlist

`POST /api/v1/access` is public. Rows live in CORE `accessRequests[]` (survive reload). Same email upserts. No mail is sent.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/access` | `{ name, email, company, role?, size?, replace?, note? }` — **201** new, **200** upsert |
| GET | `/api/v1/access` | `{ requests[] }` — owner / skip-onboarding operator dump |

Password recovery when the UI is unreachable: stop CORE, then `npm run owner:reset` (prompts, or `--password` / `OWNER_RESET_PASSWORD`). That rewrites the owner hash in `.roster-flow/state.json` and revokes every session. It does not delete seats or runs. Do not `rm` `state.json` to get back in.

The demo token (`Bearer roster-demo` with `ROSTER_SKIP_ONBOARDING=1`) cannot rotate the hash — sign in with the owner password first.

`GET /api/v1/setup/status` and `GET /api/v1/health` include `demo` and `demoResetMs` when `ROSTER_DEMO=1`. `POST /api/v1/reset` reseeds the starter company; it returns **403** on a public demo unless `ROSTER_ALLOW_RESET=1` (Playwright).

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/reset` | Re-seed starter company (disabled on `ROSTER_DEMO` unless `ROSTER_ALLOW_RESET=1`) |

## Health and harness

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | API + company OpenCode status (`harness`) plus `systemHarness`. `harnessReady` is true when the company serve is up and at least one company seat can run. One seat whose provider is not loaded stays `ready: false` on `seats` and does not clear `harnessReady`. `harnessReady` is false when the serve is down or every company seat is unhirable. `ready` is true when `harnessReady` is true and the system serve is up. `seats` is `[{ seat, model, ready, error }]`. `seatCount` is the roster size |
| POST | `/api/v1/harness/ensure` | Start or reuse `opencode serve` (`{ forceRestart, kind?: "company" \| "system" }`) |
| GET | `/api/v1/harness` | Company serve plus `systemHarness` (Architect / Channel), and the same per-seat `seats` / `harnessReady` report as `/health` |
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
| GET | `/api/v1/projects/:id/connectors` | Project-scoped knowledge sources |
| POST | `/api/v1/projects/:id/connectors` | Attach git path, GitHub remote, or docs tree |
| DELETE | `/api/v1/projects/:id/connectors/:id` | Disconnect (gone from subsequent wakes) |
| GET | `/api/v1/projects/:id/knowledge` | `?q=&seatId=` snippet search |
| POST | `/api/v1/seats` | Hire a seat (specialist when `team` is set; `projectId` + `asPm` for a project PM). Bots accept `tokenBudget`, `budgetCents`, `spent`. |
| PATCH | `/api/v1/seats/:id` | Reparent, model, persona, instructions, tools, `tokenBudget`, `budgetCents`, `spent` |
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

`to: "team:eng"` on the bus wakes that team's Supervisor. A job addressed to a team chooses its own routing (see Jobs).

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
| GET | `/api/v1/seats/:id/channels` | Rooms the seat is in: `id`, `name`, `direct` (a direct member), `viaTeams` (teams that make it a member), `lead`, `responder`, and the room's `respond` mode |
| GET | `/api/v1/seats/:id/inbox` | Bus mail for this seat (direct, `team:` if Supervisor, `channel:` / `#room` membership, `ask_human`) |
| GET | `/api/v1/seats/me/inbox` | Inbox for You |
| POST | `/api/v1/seats/:id/inbox/read` | `{ beforeId }` — mark unread after that bus id as read |
| POST | `/api/v1/seats/:id/pause` | Pause a bot (not You). System seats can pause; fire is still DELETE. Sets `pauseReason: owner`. |
| POST | `/api/v1/seats/:id/resume` | Resume a paused bot. **400** `raise tokenBudget first` when `spent >= tokenBudget`. |
| GET | `/api/v1/usage` | Meter rows (`tokens`, `usdEstimate`, `hours`) — filter `?projectId=` `?teamId=` `?seatId=` `&format=csv` |
| POST | `/api/v1/usage` | Record a meter row (`seatId`, `inputTokens`, `outputTokens`) |
| POST | `/api/v1/heartbeats/tick` | Wake seats with unread inbox / claimed tasks and `heartbeatMinutes` |
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

Wake prompts prepend linked goal title, project brief, constitution, attached knowledge pointers (not used for training), and `meta.runId` when present. `wakeSeat` does not prompt when the seat is paused, over `tokenBudget`, or the run is killed. Create/run a routine is rejected when `impliesDeploy` (or the prompt is clearly a deploy) and the seat `deny` includes `deploy`. Tick coalesces with another wake to the same seat in the same minute.

Plugin tool: `roster_inbox`.

## Seat budgets

Monthly token caps on bot seats. Unset `tokenBudget` is unmetered (wakes still record `usage[]` / `spent`). At 100% CORE calls the existing pause (`status: paused`, `pauseReason: budget`). Chart/Room show a budget pip, not a generic idle pip. Warn in the inspector at 80%. Period is UTC `YYYY-MM`; a new month zeros `spent` and lifts a budget pause.

Hire/PATCH fields: `tokenBudget`, optional `budgetCents`, `spent`. Raising `tokenBudget` above `spent` clears a budget pause. `GET /api/v1/usage` never includes API keys. `GET /api/v1/usage?format=csv` downloads the same rows. Filter with `?projectId=` `?teamId=` `?seatId=`. `POST /api/v1/usage` records a meter row (`seatId`, `inputTokens`, `outputTokens`, optional `runId` / `ms`) — used by tests and the audit export story.

Company and System `wakeSeat` prompts increment `spent` (prompt-size estimate plus 200 output tokens when OpenCode does not return usage). `@mention` / `POST /api/v1/bus/send` with `wake: true` and `POST /api/v1/seats/:id/attach` all go through `wakeBlocked`.

## Seat heartbeats

Per-seat `heartbeatMinutes` (off when unset or `0`). Distinct from routines: a heartbeat checks unread inbox and claimed tasks, then wakes with a prompt that forbids deploy/merge. Skips paused and over-budget seats. Seats whose tools include `deploy` stay event-driven. Coalesces with another bus wake to the same seat in the same minute. `POST /api/v1/heartbeats/tick` runs one pass (CORE also ticks with routines). Inspector **Disable heartbeat** sets `heartbeatMinutes: 0`.

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
| GET | `/api/v1/channels` | Channels plus membership, `leadSeatId`, `respond`, `limits`, and `responderSeatId` (who answers un-mentioned messages now, before pause and model checks; `null` in a quiet room) |
| POST | `/api/v1/channels` | Create a room (`name`, `teamIds`, `seatIds`) |
| PATCH | `/api/v1/channels/:id` | Add/remove teams and seats; set `leadSeatId` (a bot member, or `null`); set `respond` (`lead`, `conductor`, or `quiet`); set `limits.implicitPerMinute` (1–1000, `null` restores the default of 4). Bad input is a 400 and changes nothing |
| GET | `/api/v1/channels/:id/messages` | Messages in a channel |
| POST | `/api/v1/channels/:id/messages` | Post as You; parse `@channel` / `@eng` / `@build` and wake. The response includes `runId` and `started` for the first wake, and `wakeResults` (`seat`, `runId`, `started`) for every seat woken. It returns once the wakes have started, not when the reply arrives. `queued: true` means the room's responder is still answering and the message will follow. `rateLimited: true` means the room hit `limits.implicitPerMinute`; `quiet: true` means the room is quiet and only people were notified |
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

A message with no mention, from a human, wakes one responder for the room. The order is: the channel's `leadSeatId`; the supervisors of member teams; bot members that report to a human member; other bot members; the Channel conductor. Seats that are paused, over budget, or whose model is not usable are skipped, and the room gets one `Skipped …` line. When nobody can answer, the first seat reports why. The responder is told to answer in plain text, and its reply is posted to the same room. A message from a bot seat with no mention wakes nobody.

The room's `respond` mode changes this. `lead` (the default) uses the order above. `conductor` always wakes the Channel conductor. `quiet` wakes nobody: the other people in the room get a notify row, and the room gets one System line. A room answers at most `limits.implicitPerMinute` un-mentioned messages a minute (default 4); past that, the room gets one `Rate limit:` line and @mentions still work.

Each seat has one OpenCode session per room it is woken in (`roster:<seat>:<room>`), separate from its DM session (`roster:<seat>`), which bus mail, heartbeats, its own DM, and Harness attach use. A room wake carries the room messages posted since the seat's last turn there (up to 20 lines, about 2k tokens, oldest first, without System lines or its own posts), and replies are read from that session only. Room sessions idle for 14 days are deleted and reopened on the next wake.

Every staffed team has a `team-<id>` room record with the team as a member and the Supervisor as lead. Created teams get one, and existing teams get one on load. Team and project rooms that have a record follow the same rules, with the Supervisor or PM answering first. Without a record, team rooms wake the Supervisor and project rooms the PM. DMs wake the bot.

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

`wake: true` starts (or continues) the recipient’s OpenCode session when the harness is up **and** the seat uses the OpenCode adapter. The bus row’s `runId` is set (a new id when the caller omitted one) and `started` is true once the prompt is accepted. If the wake cannot start a run, `started` is false and a system line in the room says why (harness offline, paused, model not loaded, human seat, MCP guest). Webhook / Claude Code / Codex seats get a notify payload instead. See [ADAPTERS.md](ADAPTERS.md).

## Seat adapters

`adapter` on a seat is a **transport**, not a second agent runtime. Unset or `opencode` is today’s attach/PTY path. `webhook` POSTs the wake to `adapterUrl` and accepts `report` / `handoff` callbacks. `claude-code` and `codex` notify (POST if `adapterUrl` is set); CORE does not wrap those loops.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/seats` | Hire accepts `adapter`, `adapterUrl`, `adapterSecret` |
| POST | `/api/v1/seats/:id/adapter/report` | Callback into `#ship` (`text`) |
| POST | `/api/v1/seats/:id/adapter/handoff` | Callback + optional wake of `to` |

`GET /api/v1/seats` strips `adapterSecret` (`hasAdapterSecret` remains).

`POST /api/v1/messages` and `POST /api/v1/bus/send` also accept optional `blocks` (Roster Block Kit array). `text` may be omitted when `blocks` is present. `jobId` on `POST /api/v1/bus/send` is stored on the bus row and the room message.

## Jobs

Persistent work a caller hands to a seat or a team. Same bearer auth as the rest of the API: `read` can list, get, and wait; `write` can submit, complete, and cancel. Session logins are not scope-limited.

`fileRefs` store paths only (at most 32). File bytes go to the job file store (`POST /api/v1/jobs/:id/files`), capped at 1MB each, 8 files, and 4MB per job. `budget` is stored on the job. Enforcement is per caller (a later milestone); there is no global cap.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/jobs` | Submit a job, wake the resolved seat, post it in the room |
| GET | `/api/v1/jobs` | List, newest first. Optional `?status=&target=&assignee=` |
| GET | `/api/v1/jobs/:id` | One job |
| GET | `/api/v1/jobs/:id/wait` | Long-poll. `?timeout=` ms (0–60000, default 25000). `?since=` ISO `updatedAt` returns on any newer write; otherwise returns when status is `needs_human`, `done`, `failed`, or `cancelled` |
| POST | `/api/v1/jobs/:id/complete` | Seat result. `{ result, status?: done\|failed\|needs_human, cost?, tokens?, from?, announce?, prUrl?, branch? }`. `prUrl` / `branch` attach a GitHub card to the job's room line |
| POST | `/api/v1/jobs/:id/cancel` | Cancel a non-terminal job. `{ reason? }` |
| POST | `/api/v1/jobs/:id/files` | `{ name, content, encoding?: "utf8"\|"base64" }` stores bytes. **413** over the cap |
| GET | `/api/v1/jobs/:id/files/:name` | `{ name, size, sha256, encoding: "base64", content }` |
| POST | `/api/v1/jobs/:id/messages` | Follow-up `{ text }` into an open job. Wakes the assignee |
| GET | `/api/v1/jobs/callback-secret` | `admin`. The callback signing secret, header names, and signing string |
| POST | `/api/v1/jobs/callback-secret/rotate` | `admin`. Replace the secret. **409** when `ROSTER_CALLBACK_SECRET` is set |

`POST /api/v1/jobs`:

```json
{
  "target": "team:eng",
  "routing": "supervisor",
  "brief": "Implement webhook idempotency.",
  "fileRefs": [{ "path": "billing/webhook.ts", "name": "webhook.ts" }],
  "channel": "ship",
  "callbackUrl": "https://harness.example/hooks/roster",
  "budget": { "tokens": 20000, "cost": 1.5 },
  "runId": "run-optional"
}
```

`target` is a seat id or `team:<id>`. Team `routing` is `supervisor` (default; same seat the bus wakes today), `round_robin` (generic, then specialists, skipping humans and the Supervisor), or `specialist` with `specialist` set to a bot seat id on that team. `round-robin` is accepted as an alias. Routing on a seat target is `400`.

Submit writes a `kind: "job"` bus row and a room message (default `#ship`), then wakes `assignee`. An empty org has `#general` and no `#ship`; omitting `channel` posts there. An explicit missing channel is still **404**. Harness offline, paused, or killed runs stay `queued` and record `wake`. A prompted session moves the job to `running`. A human assignee moves it to `needs_human`.

Status: `queued`, `running`, `needs_human`, `done`, `failed`, `cancelled`. Terminal jobs reject another complete or cancel with **409**.

`tokens` is a number (stored as `{ "total": n }`) or `{ "input", "output", "total" }`. `cost` is a non-negative number. Omit either when the seat does not know usage.

`GET /api/v1/jobs/:id/wait` returns `{ "job", "timedOut" }`.

#### callbackUrl rules

`callbackUrl` must be `http` or `https` and must not carry credentials (`https://user:pass@…` is **400**). Job responses never include credentials in `callbackUrl`.

CORE resolves the host once, checks every address it returns, and connects only to one of those addresses. The `Host` header and TLS SNI stay the original hostname, so certificates are still checked against it. A DNS answer that changes between the check and the connect cannot move the request. This runs at submit (a bad URL is **400**) and again at every delivery. Redirects are not followed.

Blocked addresses (**400**):

- IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`.
- IPv6: `::/96` (unspecified, loopback, IPv4-compatible `::a.b.c.d`), `64:ff9b::/96`, `64:ff9b:1::/48`, `2001::/32` (Teredo), `2001:db8::/32`, `2002::/16` (6to4), `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`.
- IPv4-mapped `::ffff:a.b.c.d` is judged by the IPv4 inside it. For every form that embeds IPv4 (mapped, compatible, NAT64, 6to4, Teredo server and client), the embedded address is checked too.
- Link-local and cloud metadata: `169.254.0.0/16` (includes `169.254.169.254` and `169.254.170.2`), `fe80::/10`, `fd00:ec2::254`, `100.100.100.200`, `168.63.129.16`, and any IPv6 form that embeds one of them.

`ROSTER_CALLBACK_ALLOWLIST` lets named hosts resolve to otherwise blocked addresses, for example a harness on a private network. It never allows link-local or metadata addresses.

- Comma-separated `host` or `host:port`. IPv6 literals are `[addr]` or `[addr]:port`.
- Matching is exact and case-insensitive. There are no wildcards and no subdomain matching. A bare `host` matches any port; `host:port` matches only that port (`80` and `443` are the defaults for `http` and `https`).
- Entries must be ASCII. Write internationalized names in punycode (`xn--bcher-kva.example`, not `bücher.example`). URL parsing punycodes the callback host, so a non-ASCII entry would never match; CORE ignores it.

#### Callback delivery and signatures

On `needs_human`, `done`, `failed`, or `cancelled`, CORE POSTs the snapshot to `callbackUrl` when set. That includes a job that lands in `needs_human` at submit because its assignee is a human seat.

```json
{ "event": "job.status", "job": { "id": "job-…", "status": "done", "result": "…" } }
```

Every callback is signed with HMAC-SHA256 using the org's callback secret. CORE runs one org per instance, so there is one secret per instance. It is generated on first use and stored in state. `ROSTER_CALLBACK_SECRET` overrides it. Read it with `GET /api/v1/jobs/callback-secret` (`admin`) and rotate it with `POST /api/v1/jobs/callback-secret/rotate`. `GET /api/v1/state` never includes it.

| Header | Value |
|---|---|
| `X-Roster-Timestamp` | Unix time in seconds when the request was signed |
| `X-Roster-Job-Id` | The job id. Same as `job.id` in the body |
| `X-Roster-Signature` | `v1=` followed by the lower-case hex HMAC-SHA256 of the signing string |

Signing string: `<timestamp>.<jobId>.<body>`. `<timestamp>` and `<jobId>` are the header values, and `<body>` is the raw request body exactly as received, before any JSON parsing.

To verify:

1. Read the raw body bytes. Do not re-serialize parsed JSON.
2. Reject if `X-Roster-Timestamp` is more than 300 seconds from your clock. This limits replay.
3. Compute `HMAC-SHA256(secret, timestamp + "." + jobId + "." + body)` as hex, prefix `v1=`, and compare it to `X-Roster-Signature` with a constant-time compare.
4. Check that `X-Roster-Job-Id` equals `job.id` in the body.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyRosterCallback(secret, headers, rawBody) {
  const ts = headers["x-roster-timestamp"];
  const jobId = headers["x-roster-job-id"];
  const sig = Buffer.from(headers["x-roster-signature"] || "");
  if (!/^\d+$/.test(ts || "") || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = Buffer.from("v1=" + createHmac("sha256", secret).update(`${ts}.${jobId}.${rawBody}`).digest("hex"));
  return sig.length === want.length && timingSafeEqual(sig, want) && JSON.parse(rawBody).job?.id === jobId;
}
```

The attempt is stored on `job.callback` (`ok`, `status`, `error`). A failed callback does not change the job status. `announce: false` skips the room and bus note (the seat tool uses this when it is already posting the ask).

A seat finishes with `roster_report` `jobId` (optional `status`, `cost`, `tokens`). `roster_ask_human` `jobId` sets `needs_human` and still parks the question on `reports_to`.

`GET /api/v1/state` includes `jobs`.

A token with no `seatId` acts as the owner seat `you` and can see every job. A token bound to another seat sees jobs it submitted, jobs assigned to that seat, and nothing else. Listing and get return **404** for the rest.

That bound seat may task the descendants of its manager (the reporting line), not the manager and not other lines. Hire the guest with `guest: true` and `reportsTo` set to that manager, then pass the new seat id as `seatId` when creating the token.

`roster_report` / `POST /api/v1/bus/send` also accept optional `prUrl` and `branch`. A GitHub pull or issue URL in `text` renders a Room card. Token: `GITHUB_TOKEN` or `GH_TOKEN` (env only). See [GitHub cards](GITHUB.md).

## MCP backend

mcp-flow is the public MCP front door. The job tools below are served by the same `POST /mcp` endpoint as the room gateway ([MCP.md](MCP.md)); `tools/list` returns both sets and mcp-flow proxies it. Send JSON-RPC 2.0 (`Content-Type: application/json`) with the same bearer token. `GET /mcp` returns a short discovery document. A `read` token can list and poll; `submit_task`, `cancel_task`, `put_file`, and `send_message` (and the room write tools) need `write`.

Register Roster on mcp-flow (admin token on mcp-flow, not on Roster):

```json
{
  "slug": "roster",
  "title": "Roster-Flow",
  "transport": "streamable-http",
  "url": "http://127.0.0.1:8790/mcp",
  "placement": { "mode": "remote" }
}
```

Forward the caller's Roster bearer token on that proxy. The token's `seatId` is the guest. Point `reportsTo` at the manager of the seats they may task (for a wiki team, the wiki supervisor).

Tools: `list_seats`, `list_teams`, `submit_task`, `get_task`, `wait_task`, `cancel_task`, `put_file`, `get_file`, `send_message`, `list_models`. `submit_task` takes `target`, `brief`, optional `routing`, `specialist`, `fileRefs`, inline `files`, `budget`, `priority`, and `callbackUrl`. `list_models` returns configured model ids only (no provider keys). PTY attach and Architect apply are not tools.

`initialize` answers the client's `protocolVersion` (default `2025-03-26`). `notifications/*` get **202**. The handler is stateless: mcp-flow may call `tools/call` without holding a session.

## Slack transport

Optional. Secrets in env (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`). See [SLACK.md](SLACK.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/slack` | `{ connected, env, shipChannel }` — never the token |
| POST | `/api/v1/slack/events` | Slack Events API (url_verification + human messages → mapped room) |
| POST | `/api/v1/slack/actions` | Interactive Confirm/Deny → bus `block_actions` |

## Roster Block Kit

Bots can attach a Slack-shaped `blocks` array on room messages. Types: `header`, `section`, `divider`, `context`, `image`, `actions`, `markdown`. Buttons with `action_id` post back to the originating seat.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/block-actions` | `{ messageId, actionId, value?, userId? }` → bus `block_actions` + wake. `github.refresh` / `github.merge` skip the harness wake. |

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
| GET | `/api/v1/sessions/:id/room` | Which seat and room an OpenCode session belongs to: `{ sessionId, seatId, channelId, kind, harness }`. `kind` is `room` for a seat's session in one room (`roster:<seat>:<room>`) and `dm` for its DM session (`roster:<seat>`). 404 when no seat owns the session |
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

## GitHub cards

Optional. See [GITHUB.md](GITHUB.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/github` | `{ connected, env, api }` — never the token |
| GET | `/api/v1/messages/:id/github` | Refresh PR/issue checks |
| POST | `/api/v1/block-actions` | `github.merge` is human-gated (`deny: ["deploy"]` cannot merge) |

## Room MCP

Streamable HTTP room gateway. mcp-flow is tools; this is seats, channels, and the bus. See [MCP.md](MCP.md).

| Method | Path | Purpose |
|---|---|---|
| POST | `/mcp` | JSON-RPC (`initialize`, `tools/list`, `tools/call`, `ping`). `Mcp-Session-Id` on initialize |
| POST | `/api/v1/mcp` | Same handler |
| GET | `/mcp` | Discovery JSON, or SSE `endpoint` if `Accept: text/event-stream` |
| DELETE | `/mcp` | Close session |

`tools/call` names: `roster_whoami`, `roster_join`, `roster_list_seats`, `roster_list_channels`, `roster_read_messages`, `roster_send_message`, `roster_handoff`, `roster_report`, `roster_ask_human`, `roster_inbox`. Guest seat `mcp-guest` is not an OpenCode loop. Optional `ROSTER_MCP_TOKEN`. stdio: `node scripts/roster-flow-mcp.mjs`.

## Errors

`4xx/5xx` JSON: `{ "error": "string", "detail": "…" }`. `409` if ensure is called and the CLI is missing.


## API tokens

`Authorization: Bearer rf_...` is accepted on every route. Scopes: `read` (GET/HEAD), `write` (other methods), `admin` (`/api/v1/tokens*`, `/api/v1/setup/*`, `/api/v1/jobs/callback-secret*`). Session logins are not scope-limited.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/tokens` | List (no hashes or plaintext) |
| POST | `/api/v1/tokens` | `{name, scopes: ["read","write","admin"], expiresAt? \| expiresInDays?, seatId?}` → `{token, record}`; `token` is shown once. `seatId` binds the token to that seat |
| DELETE | `/api/v1/tokens/:id` | Revoke; the token then gets 401 |
