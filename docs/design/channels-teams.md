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
