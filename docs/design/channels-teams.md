# Channels and teams: every seat in every room

Status: design, no product code changed.
Base: `fix/harness-autostart-wake` (PR #77, `8999b81`) on top of `DEVELOPMENT` `fd89c4f`.
Trigger: the owner typed `Anyone here` in a channel, with no @mention, and no bot replied.

Goal: any bot seat can work in any channel it belongs to and in its team's room. Un-mentioned messages get a reply from a known seat. Bots can @mention each other. All of this stays inside the existing seat budgets, pause rules, and heartbeats.

---

## 1. What happens today when an un-mentioned message is posted

File and line references are to the base commit above.

### 1.1 The path, step by step

1. **The client posts.** `src/pages/Workspace.tsx` sends `POST /api/v1/channels/:id/messages`. It polls `GET …/messages` every 800 ms to render replies.
2. **CORE stores the human message.** `server/index.mjs:1172-1192` calls `postRoomMessage()`, which appends to `state.messages`. Then it calls `routeChannelMessage({ channelId, text, from })`. The HTTP response returns right away; the wake runs in the background (`pending`).
3. **Mentions are parsed.** `collectWakeTargets()` (`server/chat.mjs:80-114`) runs `parseMentions()` (`server/mentions.mjs`). `Anyone here` has no `@token`, so `mentions = []`, `notify = []`, and nothing is added from mentions.
   - The word `here` only counts when written `@here`.
4. **Implicit target.** With no targets, `implicitTargets()` (`server/chat.mjs:59-78`) picks one by room id prefix:

   | Room id | Implicit target |
   | --- | --- |
   | `team-<id>` | `team:<id>`, resolved by `teamWakeTarget()` to `supervisorSeatId`, then `genericSeatId`, then the first `seatIds` entry |
   | `project-<id>` | the project PM if it is a bot, otherwise the conductor |
   | `dm-<seat>` | that seat if it is a bot, otherwise nobody |
   | `session-<id>` | nobody |
   | anything else (`general`, `ship`, `incidents`, user-created) | **the `channel` conductor only** |

   Channel membership (`seatIds`, `teamIds`, `resolveMembers()` in `server/channels.mjs`) is **not consulted** for un-mentioned messages. It is only used to fan out `notify` bus rows when someone writes `@channel` or `@here`. Members are never woken by membership alone.
5. **Status line.** `routeChannelMessage` posts `Starting system harness…` or `Waking Channel (<model>)…` (`server/chat.mjs:285-295`).
6. **Harness ensure.** `runWakes()` → `ensureForTarget()` (`server/chat.mjs:171-200`). The conductor seat has `system: true` (`server/seed.mjs:10`), so `harnessKindForSeat()` returns `system`: the **System** `opencode serve` on port 14181, not the company serve. CORE calls `ensure({ kind: "system" })`. On failure the room gets `Harness offline: …` and the wake stops.
7. **Model plan.** `seatModelPlan()` (`server/chat.mjs:142-159`) checks the seat model (`xai/grok-4` for the conductor) against connected keys and the serve's `GET /config/providers`. If it is unusable, it falls back to `firstConnectedModel()`. If there is no fallback, the room gets a provider hint and the wake stops (`nokey`).
8. **Wake.** `wakeSeat("channel", text, { kind: "channel", channel })` (`server/bus.mjs:238-359`):
   - `wakeBlocked()` (`server/seats.mjs:170-182`): token budget, paused seat, or killed run stops it.
   - `ensureSeatSession()` reuses **one OpenCode session per seat** (`state.systemSessions.channel`), titled `roster:channel`, shared by every room the conductor is ever woken in.
   - `promptWithFallback()` builds `promptBody()` (`server/bus.mjs:121-153`) and calls `POST /session/:id/prompt_async` with `agent: "channel"`. The prompt says *"You own @channel. Notify members; only hand work to bots whose job matches"*, sets `Current room: #general`, and ends with *"Use roster_send_message / roster_handoff / roster_report to talk to peers."* `prompt_async` returns 204 before the model runs.
   - `meterPromptedWake()` charges an estimate (`text/4 + 480` in, 200 out) to the seat's `spent`.
9. **OpenCode turn.** The System serve runs agent `channel` (`.roster-flow/system/.opencode/agents/channel.md`). The `roster-flow-opencode` plugin's `experimental.chat.system.transform` hook calls `GET /api/v1/seats|teams|channels` and pushes the **whole org** (every bot's persona, job and instructions, and every room) into the system prompt (`packages/roster-flow-opencode/index.js:430-470`).
10. **Reply capture.** `followChannel()` (`server/chat.mjs:321-401`) polls `GET /session/:id/message` up to 40 times, 1.5 s apart (about 60 s). Every assistant **text part** it has not seen in this loop, and whose exact text is not already in this room, is posted as a mirrored bot message. A turn error found by `pullFailure()` posts `… could not reply: …`. No reply at all posts `… did not reply. Open Debug…`.
11. **Background mirror.** `syncBoundSessions()` (`server/chat.mjs:432-450`, every 2.5 s) mirrors each seat session's assistant text into `state.sessionRooms[seatId]`, which is **the last room that seat was woken in**.

Teams follow the same path. A team room (`team-eng`) wakes only the supervisor. `@eng` in any room does the same. A team with no supervisor or generic seat falls back to its first `seatIds` entry. For the seeded `ship` team that entry is `channel`.

Bot-to-bot traffic goes through the plugin tools. `roster_send_message` → `POST /api/v1/messages` and `roster_handoff` → `POST /api/v1/bus/send` both default the room to **`#ship`** (`server/index.mjs:1227`, `server/bus.mjs:73`). `roster_report` without `channel` also posts to `#ship` (`packages/roster-flow-opencode/index.js:164`). Bot replies are never parsed for @mentions; only these tools wake other seats. Loop protection is `cycleSafe()` (`server/bus.mjs:389-395`): fewer than 8 ping-pongs between the same pair in the last 12 bus rows.

### 1.2 Every reason no seat responds to `Anyone here`

**By design (happens every time):**

1. **Only the conductor is eligible.** In a normal channel, an un-mentioned message wakes `channel` and nothing else. Member bots and team seats in the room are ignored, and humans get no notify row.
2. **In `#general` the conductor is the only bot.** Seeded `#general` members are `channel`, `you`, `maya`, `jules`, `priya`; the last four are humans. No room has a "lead" or "responder" setting.
3. **The conductor is told to route, not chat.** Its seat instructions say *"Compile human sentences into run graphs… Do not wake every bot."* The wake prompt and the plugin both say *"Talk through roster_send_message / roster_handoff / roster_report."* A model that obeys can answer with tool calls only. Tool calls are not text parts, so `followChannel` sees nothing.
4. **Tool replies land in the wrong room.** If the conductor answers with `roster_report` without `channel`, or with `roster_send_message` to a seat, the message is posted to **`#ship`**, not the room the owner is in.
5. **The conductor is hidden.** System seats are filtered from the roster unless "Show system seats" is checked (`src/pages/Workspace.tsx:641`). The owner may not see that a bot named Channel was the one that tried to answer.

**At runtime (depends on the deployment):**

6. **System serve not up.** Autostart needs an owner and a provider (`server/autostart.mjs`). If the `opencode` binary is missing or the serve does not become healthy, the room gets `Harness offline: …`.
7. **No usable model on the System serve.** The conductor is `xai/grok-4`. Without an xAI key, the wake depends on `firstConnectedModel()` finding a provider that the **System** serve loaded. If none is loaded, the room gets a provider hint and the wake stops. If a model is chosen but the serve did not load it, the wake ends with `PROVIDER_NOT_LOADED`.
8. **Seat blocked.** Over `tokenBudget`, paused by the owner, or a killed `runId` (`wakeBlocked`).
9. **Silent turn failure.** `prompt_async` returns 204 even when the turn later fails inside the serve. `pullFailure()` only catches failures recorded as `info.error` on the last assistant message. Anything else ends as `did not reply`.
10. **Slow model.** The follow loop stops after about 60 s. A later reply is only picked up by `syncBoundSessions`, which posts into the seat's *last* room. If the conductor was woken in another room meanwhile, the reply goes there.
11. **Plugin cannot reach CORE.** Once an owner exists, every API route needs auth (`server/index.mjs:269-272`). The plugin only sends a bearer token when the serve env has `ROSTER_API_TOKEN` (`packages/roster-flow-opencode/index.js:10-13`), which Compose leaves empty by default. Without it, every `roster_*` tool returns 401, and the system transform falls back to *"CORE API unreachable."* The model has no roster context, and any tool reply fails.
12. **One shared session per seat.** All rooms share `roster:channel`. A wake while the session is busy waits behind the previous turn. History from other rooms is in context. `followChannel` dedupes by text only, so older assistant text from other rooms can be reposted into this one. A reply identical to an earlier one in the same room (for example "Here.") is dropped.
13. **Room id prefixes.** `session-*` rooms and `dm-<human>` rooms never wake anyone.

The Debug panel trace tells the cases apart: `chat.route` → `harness.ensure` / `harness.error` → `seat.wake` / `seat.nokey` / `seat.paused` → `seat.prompted` → `seat.reply`, `seat.failed` or `seat.noreply`. A `seat.prompted` with no `seat.reply` points to reasons 3, 4, 9, 10 or 11. A missing `seat.prompted` points to 6, 7 or 8.

---

## 2. OpenCode multi-agent options (opencode-ai 1.19.x)

Current release is 1.19.3. What the serve gives us:

| Capability | API / config | Use for us |
| --- | --- | --- |
| Many sessions per serve | `POST /session { title, parentID? }`, `GET /session`, `DELETE /session/:id`, `GET /session/:id/children` | A session per seat per room is cheap: sessions are rows on disk and cost nothing while idle |
| Pick agent and model per prompt | `POST /session/:id/prompt_async { agent, model, parts }` | Same as today |
| Inject context without a model call | `noReply: true` on a prompt | Load room history into a session without paying for a turn until it is woken |
| Per-prompt system text and tools | `system`, `tools` on a prompt | A small per-room system block instead of the whole org; turn off tools for chat-only replies |
| Status and events | `GET /session/status`, SSE `GET /event`: `message.part.updated`, `session.idle`, `session.error`, `session.status` | Replace the 60 s polling loop; know when a seat is busy |
| Stop a turn | `POST /session/:id/abort` | Kill switch and loop breaker |
| Compaction | Automatic, plus `POST /session/:id/summarize` and the `experimental.session.compacting` plugin hook | Keep long-lived room sessions small |
| Agents | `.opencode/agents/<id>.md` or `opencode.json` `agent`; `mode: primary\|subagent\|all`; `steps` caps agentic iterations; `permission` per tool | One agent per seat (already written by `server/agents.mjs`); `steps` bounds cost per wake |
| Subagents via the task tool | Built-in `task` tool spawns a child session running a `subagent` agent; `permission.task` allowlists which subagents an agent may call; `hidden: true` | Delegation *inside* one turn |
| MCP | `opencode.json` `mcp: { name: { type: "remote", url, headers } }` or `POST /mcp` at runtime | Connect external tools; CORE already serves `/mcp` |
| Plugins | Custom tools plus `event`, `tool.execute.before/after`, `experimental.chat.system.transform` hooks | Our `roster_*` tools and roster context |

### 2.1 Options for connecting many agents

**A. One session per seat (today).** It is simple, but rooms bleed into each other, replies go to the wrong room, a busy seat blocks every room, and context grows without bound.

**B. One session per seat per room, with routing in CORE (recommended).** CORE decides who is woken, keeps one session for each (seat, room) pair, sends only that room's recent messages, and posts the reply back to that room. Seats talk to each other through room messages and @mentions that CORE routes. This keeps CORE as the source of truth for membership, budgets, audit, and the Room UI, and OpenCode stays the harness, which is the rule in `docs/ARCHITECTURE.md`.

**C. OpenCode subagents (one orchestrator session calls seats through `task`).** It is native, and child sessions are visible. But:
- the parent drives every exchange, so humans cannot address a subagent in a room;
- subagents default to the parent's model and bill into the parent's turn, so CORE cannot enforce a per-seat `tokenBudget` before the call;
- company and system seats live on different serves and cannot call each other through `task`;
- traffic is hidden from the Room and the bus unless we mirror child sessions;
- concurrency and loops are governed by the model, not by CORE limits.

**D. MCP between agents.** CORE's `/mcp` is the right door for *external* agents (MCP guest seats). For our own OpenCode seats it is worse than the plugin: one remote MCP config is per serve, so the caller's seat identity is lost, while the plugin sees `ctx.agent`.

**Recommendation.** Use B now. Allow C later, only *inside* a seat's own turn for delegation to its direct reports. Set `permission.task` on each supervisor so it can only call its reports, and have CORE meter the child sessions by agent id. Keep D for external agents.

---

## 3. Design

### 3.1 Channel membership

Extend the channel record (`server/channels.mjs`):

```js
{
  id, name, topic,
  seatIds: [],            // direct members (humans and bots)
  teamIds: [],            // every seat on the team is a member
  leadSeatId: null,       // bot that answers un-mentioned messages
  respond: "lead",        // "lead" | "team" | "conductor" | "quiet"
  limits: {               // all optional; defaults below
    implicitPerMinute: 4,
    fanout: 3,
    maxHops: 4,
    maxBotWakesPerThread: 8,
    tokensPerDay: null,
  },
}
```

- `resolveMembers()` stays the membership truth: direct seats plus team seats plus the conductor.
- **Every bot can be in any number of rooms.** Membership does not move a seat between serves. Company seats stay on the company serve and system seats on the System serve.
- A seat's rooms are derived (`channelsForSeat(state, seatId)`), not stored on the seat, so there is one source of truth.
- `PATCH /api/v1/channels/:id` accepts `leadSeatId`, `respond`, and `limits`. `leadSeatId` must be a bot member; it is cleared when the seat is fired or leaves.

### 3.2 Team membership

- A team keeps `seatIds`, `supervisorSeatId`, and `genericSeatId`.
- **Each staffed team gets a real home room record** (`team-<id>`, `teamIds: [id]`, `leadSeatId: supervisorSeatId`, `respond: "lead"`). Today `team-<id>` is only a naming convention with no channel record.
- Adding a team to a room (`addTeam`) makes all its seats members. Seats hired onto the team later join automatically, because membership is resolved, not copied.
- `@team` in any room wakes the supervisor (as today). With `respond: "team"` on the room, it wakes up to `fanout` members instead (3.3).

### 3.3 Routing un-mentioned messages

New pure function `implicitResponders(channel, message, state)` in `server/channels.mjs`. It replaces the `else` branch of `implicitTargets()`.

1. **Only humans trigger implicit routing.** If the author is a bot seat, return `[]`. Bots must @mention to wake someone (3.4).
2. **`respond` mode:**
   - `lead`: the first awake seat from this list: `leadSeatId`; the team supervisor (team rooms); the first bot member whose `reportsTo` is a human member; the first bot member; the conductor.
   - `team`: up to `limits.fanout` awake bot members, lead first, each told *"reply only if you can help; otherwise reply with exactly `PASS`"*. `PASS` replies are not posted.
   - `conductor`: today's behavior.
   - `quiet`: nobody; humans get a notify row.
3. **"Awake"** means `wakeBlocked()` is null and `seatModelPlan().ok` is true. A paused or keyless lead is skipped, and the room gets one System line saying who was skipped and why.
4. **Rate limits:**
   - per room: at most `implicitPerMinute` implicit wakes;
   - per (seat, room): one in-flight wake;
   - messages that arrive while a wake is in flight are queued and delivered as one follow-up turn;
   - when a limit is hit, the room gets a single System line, not one per message.
5. **Defaults by room type:**

   | Room | Default `respond` | Default lead |
   | --- | --- | --- |
   | `team-*` | `lead` | supervisor |
   | `project-*` | `lead` | PM |
   | `dm-*` | `lead` | the bot |
   | Channels (`general`, `ship`, …) | `lead` | none set, so the fallback list applies; `#general` with no bot members falls back to the conductor |

### 3.4 Agent-to-agent @mentions

- **Bot replies are routed like human posts.** When CORE mirrors a bot reply into a room, it runs `collectWakeTargets()` on the text. `@build` in Eng Supervisor's reply wakes Eng.Build in that room, in Build's session for that room.
- **Thread context.** Every wake carries `{ threadId, hop, rootMessageId, runId }`. A human post starts a thread at hop 0, and each bot-triggered wake adds 1.
- **Limits:**
  - `hop` cannot exceed `limits.maxHops` (default 4);
  - a thread allows at most `maxBotWakesPerThread` bot-triggered wakes (default 8);
  - a seat never wakes itself;
  - bots cannot use `@channel` or `@here`;
  - a bot can only wake seats that are members of the room (a non-member mention becomes a notify row and a System line);
  - `cycleSafe()` is keyed by `(threadId, pair)`, not by the last 12 global bus rows.
- **When a limit is hit**, the room gets one System line (`Stopped: thread reached 4 hops`), and the seat that would have been woken gets a notify row instead.
- **Tools follow the room.** `roster_send_message`, `roster_handoff`, and `roster_report` default `channel` to the room of the calling session. The plugin resolves it from `ctx.sessionID` through a new `GET /api/v1/sessions/:id/room`. `#ship` stops being a silent default; with no room known, the call fails with a clear error.
- **Plugin auth.** CORE mints an internal, non-expiring, room-and-bus-scoped token at boot. It passes the token to both serves as `ROSTER_API_TOKEN` (unless the operator set one) and rotates it on restart. This removes reason 11.

### 3.5 Per-channel session context

- **Session map:** `state.roomSessions[seatId][channelId] = { sessionId, harness, cursor, lastWakeAt }`. `state.sessions` / `state.systemSessions` remain the seat's DM session, so the Harness attach pane keeps working. The title is `roster:<seat>:<room>`. `bindSessionMeta()` parses both title forms.
- **Context on wake:** the prompt carries the room messages after `cursor`, capped at 20 messages or about 2k tokens, oldest first, one line each (`[12:04] Maya: …`). Then `cursor` moves to the newest message. Older history lives in the OpenCode session itself, with compaction.
- **A smaller system block.** The plugin transform injects only this room's members and their one-line jobs, plus the caller's team, instead of the whole org. Most of the per-turn tokens today come from that full-org block.
- **Reply capture by session.** `followChannel` reads only the woken session and only assistant messages created after the wake's `since`. It dedupes by message id, not text, and posts into that session's room. `syncBoundSessions` uses the same session→room map, so a late reply lands in the right room. Phase 3 replaces polling with the serve's `/event` SSE (`session.idle`, `session.error`).
- **Cleanup:** room sessions idle for 14 days are deleted (`DELETE /session/:id`) and recreated on the next wake.

### 3.6 Cost and budget guards

- **Same gate everywhere.** Every wake, whether implicit, @mention, bot-to-bot, team fan-out, or heartbeat, goes through `wakeSeat()` → `wakeBlocked()`. Seat `tokenBudget`, owner pause, and killed runs apply unchanged.
- **Real usage.** After a turn, CORE reads `info.tokens` (input, output, reasoning, cache) and `info.cost` from the assistant message. It corrects the estimated `meterWake` row (`source: "wake"`), and adds `channelId` and `threadId` to the usage row. The CSV gains a `channelId` column.
- **Room budget (optional):** `limits.tokensPerDay` is checked against the sum of today's usage rows for the room. Over budget, the room switches to `quiet` until UTC midnight and posts a System line.
- **Steps cap.** `agentMarkdown()` writes `steps` (default 8 for specialists, 4 for the conductor and supervisors), so one wake cannot loop through tools without bound.
- **Heartbeats.** `heartbeatHasWork()` also counts unanswered @mentions of the seat in its rooms. `hasWakeThisMinute()` already coalesces a heartbeat with a recent wake. Heartbeat wakes run in the seat's DM session, not room sessions.
- **Fan-out is bounded:** worst case per human message is `fanout` (3) wakes plus `maxBotWakesPerThread` (8) bot wakes, each capped by `steps`.

### 3.7 UI

- **Channel header:** member avatars (bots and humans, with a team badge on members who joined through a team), a `Lead: Eng Supervisor` chip, and the `respond` mode (`Lead replies` / `Team replies` / `Quiet`).
- **Channel settings drawer:**
  - add or remove seats and teams;
  - pick the lead (bot members only);
  - pick the mode and limits;
  - optional daily token budget, with today's spend.
- **Live state:**
  - a `Eng.Build is thinking…` row while a wake is in flight (from run status or `session.status`), replacing the stacked `Waking …` System lines;
  - one condensed System line per skip reason (paused, no key, rate limit, hop limit).
- **Bot-to-bot messages:** a small `↳ from @eng-supervisor · hop 2/4` caption, and a thread budget chip once a thread passes 50% of `maxBotWakesPerThread`.
- **Seat inspector:** a "Rooms" list with the session per room, budget used, and a "Leave room" action.
- **Team page:** the home room link and the rooms the team belongs to.
- **System seats:** the conductor shows in a room's member list whenever it is that room's responder, even with "Show system seats" off.

---

## 4. Phased build plan

Each phase is one PR into `DEVELOPMENT`, with unit tests in `npm run test:unit` and a clean `npx tsc -b`.

### PR 1: `Anyone here` gets a reply (small)

Scope, all in CORE:

1. **`server/channels.mjs`:**
   - normalize `leadSeatId` (accepted by `PATCH`, validated as a bot member);
   - add `implicitResponder(channel, state)`: the `lead` fallback list from 3.3, skipping seats that are blocked or have no usable model.
2. **`server/chat.mjs`:**
   - `implicitTargets()` uses `implicitResponder()` for normal channels;
   - implicit routing is skipped when the author is a bot seat;
   - one in-flight implicit wake per room; later messages coalesce, using the existing `followingSeats` map.
3. **`server/bus.mjs` `promptBody()`:** for `kind: "channel"` (un-mentioned), add *"A human wrote in #<room> without mentioning anyone. Reply in plain text, briefly, as yourself. Do not use roster_report for this reply; CORE posts your text to #<room>. Route work only if they asked for work."*
4. **`server/chat.mjs` `followChannel()`:**
   - only mirror assistant messages created at or after `since`;
   - dedupe by message id, so stale or repeated text from other rooms is not reposted and a repeated short reply is not dropped.
5. **`server/bus.mjs`:** `pullAssistant(seatId, { since })` passes the cutoff through. `assistantText()` already has the message `info`.

Tests:
- `Anyone here` in `#general` wakes `channel` with reason `channel` and mirrors a stubbed reply into `#general`;
- with `leadSeatId: "build"` on `#ship`, it wakes `build`;
- a paused lead falls back to the next seat and posts one System line;
- a bot-authored un-mentioned post wakes nobody;
- an old assistant message in the shared session is not reposted.

Out of scope: UI, per-room sessions, bot @mention routing.

Acceptance on the live app: with a usable model loaded on the System serve, `Anyone here` in `#general` shows `Waking Channel (<model>)…`, then a Channel reply in `#general` within the follow window.

### PR 2: membership and lead in the UI

- Channel settings drawer, member list, and lead chip (3.7).
- `respond` modes `lead`, `conductor`, `quiet`.
- Team home room records created and migrated for staffed teams.
- `channelsForSeat()` and the "Rooms" list in the seat inspector.

### PR 3: per-room sessions

- `roomSessions` map, context delta with `cursor`, session titles, and migration from the flat map (3.5).
- Reply capture per session; `syncBoundSessions` uses the session→room map.
- Room-scoped plugin system block.
- `GET /api/v1/sessions/:id/room`.
- Idle session cleanup.

### PR 4: agents talk to each other

- Route @mentions in mirrored bot replies, with `threadId` / `hop` and the limits in 3.4.
- Room-aware defaults for `roster_send_message`, `roster_handoff`, and `roster_report`; no silent `#ship` fallback.
- Internal plugin token passed to both serves.
- Hop and thread captions in the UI.

### PR 5: cost, team mode, events

- `respond: "team"` with `fanout` and `PASS`.
- Real token metering from `info.tokens` / `info.cost`; `channelId` on usage rows; room daily budget.
- `steps` written into agent files.
- Heartbeats count unanswered mentions.
- SSE `/event` replaces the follow polling loop; a "thinking" row replaces the `Waking …` lines.

### PR 6 (optional): delegation through subagents

- Supervisors get `permission.task` limited to their direct reports, and report agents are written with `mode: all` so `task` can call them.
- CORE meters child sessions (`GET /session/:id/children`) against each child's seat budget and mirrors a one-line summary into the room.

## 5. Risks and open questions

- **More sessions:** roughly seats × rooms in the worst case. They are created lazily and cleaned up after 14 idle days. Watch OpenCode storage size on `/data`.
- **Team mode can get chatty.** `fanout` defaults to 3 and team mode is opt-in per room.
- **The conductor's role changes** from router only to fallback responder. Its seed instructions need a matching line, or it will keep answering through tools.
- **Company vs System serve:** bot-to-bot routing across the two serves goes through CORE, which is fine for option B. It is one more reason not to build on `task` across seats.
- **Busy sessions:** OpenCode version differences in how a prompt to a busy session is handled (queued or rejected) are avoided by CORE's one-in-flight-per-(seat, room) rule. PR 5 adds a check of `GET /session/status`.

## 6. Changes made during the build

### Phase 1
- **A responder needs a usable model.** `ea725ed` (#77) refuses a wake when the seat's assigned model is not loaded, instead of swapping in another model. The responder pick therefore skips seats whose model is not usable, along with paused and over-budget seats, and posts one `Skipped …` line. If no candidate is usable, the first one is woken anyway so its provider hint explains why; nothing is sent to OpenCode. In `#general` with the seed roster, the conductor is the only candidate, so its model must be loaded, or the owner sets a lead with a working model.
- **The fallback order lives in `responderCandidates()`** (`server/channels.mjs`). `implicitTargets()` keeps the `team-*`, `project-*` and `dm-*` rules.
- **Un-mentioned posts in `#ship` now go to Product, not the conductor.** Product is the first bot reporting to a human member. Existing tests that meant the conductor now post to `#general`.
- **`POST /channels/:id/messages` returns once the wakes start.** It no longer waits for the reply loop; the route awaits the new `started` promise, and `pending` still resolves after the follow.
- **Adapter seats (webhook, claude-code, codex) are woken directly from rooms.** Before, they went through the OpenCode harness check and model plan, which always refused them.
- **Reply dedupe is by OpenCode message id across all rooms** (`alreadyMirrored`), and the follow loop ignores assistant messages created before the wake. `assistantText()` now returns `created`.
- **`chat.test.mjs` seeds the starter company** when the shared test store is empty. Before, it only passed after an e2e run had seeded `.roster-flow/state.json`.
- **e2e uses a fake OpenCode serve** (`tests/e2e/fake-opencode.ts`). CORE adopts any healthy serve on 14180 or 14181, so wakes run end to end without the binary.
- **`POST /api/v1/reset` clears queued and in-flight room wakes** (`resetChatRuntime()`), so a later post is not queued behind an answer from before the reset.

### Phase 2
- **`respond: "team"` is rejected for now** (400). The modes in this phase are `lead`, `conductor`, and `quiet`; Phase 5 adds `team`.
- **Room settings live in `server/room-config.mjs`**, a small module with no imports, so `seed.mjs` (migration) and `channels.mjs` share the mode and limit rules without a load-order problem.
- **Channels sent to clients carry `responderSeatId`** (`publicChannel()`), the seat that answers under the current mode before pause and model checks. The header chip, the seat inspector's Rooms list, and the room settings all read it, so the UI does not repeat the fallback order.
- **Quiet rooms post one System line** ("This room is quiet…") besides the notify rows, so the person who posted can see why nobody answered.
- **The rate limit counts started implicit wakes only.** Queued follow-ups do not count, and @mentions are never limited. The limit state is in memory and `POST /api/v1/reset` clears it.
- **Team home rooms are created in `migrateState` and `createStaffedTeam`.** A `team-<id>` record the client drafted earlier (no `respond` field) gets the team added and the Supervisor as lead once; after that, an owner who clears the lead keeps it cleared. Team rooms without a record still wake `team:<id>`.
- **Project rooms with a record put the PM first** when no lead is set, then the usual order.
- **The header hides system seats** unless "Show system seats" is on or the seat is the room's responder. The responder's avatar is listed first.
- **"Leave room" only shows for direct members.** A seat that is in a room through a team leaves by leaving the team or removing the team from the room.

### Phase 3
- **Which wakes use a room session:** room wakes (implicit, @mentions, team, project and channel rooms). Bus mail (`roster_send_message` / `roster_handoff`), heartbeats, jobs, and the seat's own `dm-<seat>` room stay in the DM session. Phase 4 moves tool calls onto the room of the calling session.
- **No migration of the flat map.** `state.sessions` / `state.systemSessions` stay the DM sessions as they are. `state.roomSessions` starts empty, and a seat's first wake in a room opens `roster:<seat>:<room>`. `sessionRooms` is now only set by DM-session wakes from the seat's DM room, so DM replies no longer jump to the last room the seat was mentioned in.
- **A room session belongs to one serve.** The entry records `harness`. If the seat moves between the company and System serve, the next wake opens a new session there.
- **Context starts with room history.** A new room session has no cursor, so the first wake carries the last 20 room messages. After each prompt is accepted, the cursor moves to the newest room message. The triggering message is left out because the prompt already quotes it.
- **Reply capture follows the wake's session id.** `followChannel` gets a seat→session map from the wake results. Seats it picks up from bus mail in the room are read from their DM session, as before. `syncBoundSessions` mirrors room sessions into their room and DM sessions into `sessionRooms[seat]` or `dm-<seat>`.
- **Plugin system block (`systemBlock()`)** looks up the session through `GET /api/v1/sessions/:id/room`. A room session gets the rules, the room name, and one line (id, name, team, job) per member of the room and of the caller's team, with no persona or instructions. DM and unknown sessions keep the full-org block.
- **Cleanup runs hourly** from `startSessionSync` (`cleanupRoomSessions()`), using `lastWakeAt`. The serve's `DELETE /session/:id` failing (already gone) still drops the entry.
- **Fixed while testing: an adopted serve was dropped on the next `ensure()`.** `ensureOnce` only kept an instance that had a child process, so a serve CORE adopted (started by the container entrypoint, or the e2e fake) was discarded on the second wake, and CORE tried to spawn `opencode` instead. It now keeps a healthy adopted serve.

### Phase 4
- **Bot mentions use `planBotMentions()`** (`server/threads.mjs`), not `collectWakeTargets()`. Human posts and bot replies follow different rules (bots get no `@channel`, no self-wake, members only, hop and budget limits), so they get their own planner. Thread state (bot wakes and pair counts per thread) is in memory and `POST /api/v1/reset` clears it.
- **The thread id is the human post's message id.** `routeChannelMessage` gets `messageId` from the room route; callers without one get a generated `thr-…` id.
- **The pair limit lives in the thread** (`PAIR_LIMIT = 4` wakes between the same two seats). The old global `cycleSafe()` on the last 12 bus rows still guards `POST /api/v1/messages`, as before.
- **Mentioned humans and MCP guests get a notify row**, with no System line. Seats outside the room get both.
- **Only replies to wakes this process started are routed.** CORE remembers the thread of each seat's latest wake per room; a mirrored reply with no remembered wake (sync after a restart, an old transcript) is posted but wakes nobody.
- **The follow loop waits for every woken seat.** Before, it stopped polling for the rest once one seat answered. A bot-triggered wake also polls in its own loop, because a loop already running for the room could be on its last tick.
- **The API keeps `#ship` as the last fallback, and says so.** `POST /api/v1/messages` and `/bus/send` use `channel`, then the room of `sessionId`, then `#ship`, so existing scripts keep working. Falling back posts a System line in `#ship` and returns `note`: "No room was given, so this was posted to #ship." An explicit `channel`, including `ship`, and a resolved session room do not. The plugin still fails with a clear error when the session has no room and no `channel` was passed. `roster_report` with a `jobId` still works without a room.
- **The internal plugin token is scoped by a route allowlist**, not a new token scope. It is `rf_int_<hex>`, kept in memory, matched with a constant-time compare, and acts as the first owner. A seat `PATCH` with it may only set `lastSession`.
- **Room settings show the thread limits** (bot hops per thread, bot wakes per thread). Replies from a thread show `↳ from @seat · hop n/max`, and a `thread n/max bot wakes` chip once more than half of the thread's bot wakes are used.

### Phase 5
- **Team mode reuses the responder order** (`responderCandidates()`), minus the conductor, and takes the first `fanout` awake members. With nobody awake, the first one is woken so it reports why. The whole fan-out counts as one implicit wake for the rate limit, and follow-ups queued while it runs go to the same members.
- **`PASS` is matched loosely** (`pass`, `PASS.`), and never posted, by the follow loop or by session sync. A pass counts as an answer, so it does not trigger the "did not reply" hint; when everyone passes, the room gets one `Nobody had anything to add (…)` line.
- **Real usage replaces the estimate in the same row** instead of adding a second row. CORE keeps the estimate when the prompt is accepted (so budget checks still see spend immediately), then rewrites the row from `info.tokens` and `info.cost`, summed over every assistant message of the turn, including tool-only steps, once when the reply lands and again on `session.idle`. Rewriting is idempotent; `spent` moves by the difference. Billed tokens are input + output + reasoning; cache read and write are recorded but not counted against the budget.
- **The room budget is computed, not stored.** `roomBudget()` sums today's (UTC) usage rows with the room's `channelId`, so there is no switch to reset at midnight. Over budget, `effectiveRespond()` reads as `quiet` for un-mentioned messages only. @mentions still wake, because seat budgets already cap those, and a room that cut off its own members' mentions would be hard to explain.
- **SSE wakes the follow loop; it does not replace it.** CORE subscribes to the serve's one `GET /event` stream when it first follows a room on it, and reconnects with backoff. The subscription is shared with the provider-turn check that decides whether a wake started (#77), so each serve has a single connection, and a serve restart closes it so both reconnect to the new process. While the stream is up, a follow tick waits 4× as long, and `message.updated`, `session.idle`, or `session.error` for a followed session ends the wait early without using up a tick. The follow window stays the same, so a dropped stream degrades to the old polling. `syncBoundSessions` still polls every 2.5 s.
- **"Thinking" is CORE state**, not run status: a seat is marked thinking when its wake is chosen and cleared on its reply, PASS, a real failure, or the end of the follow window (and after 5 minutes regardless). A slow first chunk is still in flight: `started: false` from the provider-start window does not clear the row and does not post "did not start". A turn that completes or goes idle with no text is finished: the run is blocked, the row clears, and the room gets one line, `<seat> finished without a reply`. A turn still open after that window has a deadline (`ROSTER_WAKE_DEADLINE_MS`, default 120s, under the 5 minute stale drop). On expiry the watch stops, the run is blocked, and the room gets `<seat> did not reply: the provider timed out`. A reply that arrives after that line is posted once, with no second failure line. Reply, error, empty completion, deadline, and that stuck turn all go through one cleanup, once. The UI polls `GET /channels/:id/thinking` with the messages. The `Waking … (model)…` System lines are gone; the model shows on the thinking row. An over-budget seat says it is over its token budget, not merely that it is paused.
- **Repeated System lines.** `statusMessage()` now skips a line only when the room's latest message is already that line. Before, it compared against the last System line, which only worked because a `Waking …` line sat between two identical hints.
- **`steps`**: 4 for the conductor and supervisors, 8 for other bots, overridable per seat with `steps`. Written to agent files and the System serve's `opencode.json`.
- **Heartbeat mentions** count @mentions after the seat's last post and its room cursor, so a mention that already woke the seat does not count again. The heartbeat prompt names the rooms and asks the seat to answer with `roster_report channel=<room>`, since heartbeats run in the DM session.
- **The UI re-reads rooms when the open room gets a message**, so the responder chip and budget line follow server-side changes such as the budget running out.
- **Fixed while testing: follow loops outlived `POST /api/v1/reset`.** A loop still running from before a reset kept reading the session ids it had, and a reused id mirrored a reply into the wrong room. Reset now ends running loops (a generation counter checked after every poll). The e2e fake also no longer reuses session ids across restarts.
- **Not done:** checking `GET /session/status` before prompting a busy session (section 5). The one-in-flight rule per seat and room already covers it for room wakes.

### Phase 6
- **The `task` allowlist is static, written at agent-file sync.** OpenCode reads `permission.task` from agent config, so CORE cannot change it per wake. It is rewritten for every company supervisor on any hire, fire, or seat change, and a running serve may need a restart to pick it up (the same as other agent-file edits).
- **OpenCode cannot refuse a task to an over-budget report.** The permission check is by agent name only. CORE meters the child after the fact (which pauses the report at its budget, as for any wake) and lists unavailable reports in the supervisor's prompt with "Do not delegate to: …". A supervisor that ignores that line still gets one turn of the report's work, metered to the report.
- **Who can be delegated to:** direct bot reports on the company serve that use the OpenCode adapter and are not supervisors. Supervisors are `mode: primary` and cannot be subagents; System seats are on the other serve; MCP guests and external adapters have no OpenCode agent. Reports were already written with `mode: all`, so no agent mode changed. Specialists' `task` permission is unchanged (OpenCode's default), so they can still use built-in subagents.
- **No double counting.** OpenCode keeps a subagent's messages in its own child session, so the parent's `turnUsage` never includes them. Each child is metered once, on its own session, keyed by `<parent run>:<child session>`, and rewritten in place like Phase 5's rows. Children run as built-in agents (`explore`, `general`) are not seats, so they are billed to the parent seat.
- **Delegation lines are deduped by child session id**, because metering runs twice (when the reply lands and on `session.idle`). The UI shows a `task → <seat>` chip on that line.
- **Not done:** live progress of a running child in the room. The line is posted when the parent's turn is metered, not when the child starts.
