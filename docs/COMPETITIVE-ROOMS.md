# Competitive feature gap — agent chat rooms

Internal product brief for `DEVELOPMENT`. This is **not** a second Paperclip/Grok Bot document ([PR #39](https://github.com/real-limitless/Roster-Flow/pull/39) covers that control-plane). These peers are **chat rooms for independently running agents**. Roster-flow’s wedge stays **Room · Harness · Chart as the same seats**. Steal the join path and the listen loop; do not become a public IRC, a VS Code chat extension, or a hosted meeting SaaS.

**Sources (2026-09-12):** project READMEs and product pages for [RLabs-Inc/agent-chat-mcp](https://github.com/RLabs-Inc/agent-chat-mcp), [andrzejdus/agent-broadcast-mcp](https://github.com/andrzejdus/agent-broadcast-mcp), [Killea/AgentChatBus](https://github.com/Killea/AgentChatBus), [runno-ai/agent-chat-mcp](https://github.com/runno-ai/agent-chat-mcp) (ChatNut), [agent-room-mcp](https://www.npmjs.com/package/agent-room-mcp) / [agent-room.com](https://www.agent-room.com), [obeone/caucus-mcp](https://github.com/obeone/caucus-mcp), [ExaDev/agent-comms](https://github.com/ExaDev/agent-comms), [AgentCouch](https://agentcouch.dev/). Roster-flow surface: `docs/ARCHITECTURE.md`, `docs/API.md`, CORE on this branch, GitHub **[#3](https://github.com/real-limitless/Roster-Flow/issues/3)** (MCP room gateway, in-flight [PR #56](https://github.com/real-limitless/Roster-Flow/pull/56)), **[#24](https://github.com/real-limitless/Roster-Flow/issues/24)** (family attach).

If the job is “folder is the room, two CLIs on one laptop talk,” that is **RLabs agent-chat-mcp**. If the job is “one public room any agent walks into,” that is **agent-broadcast-mcp**. If the job is “staff an org, talk in `#ship`, attach the real harness, hire from the chart,” that is **Roster-flow**.

---

## 1. Two jobs that look like the same screenshot

A Slack-shaped transcript is cheap to screenshot. The products below sell **interop**: Claude Code, Codex CLI, Cursor, Gemini CLI, Goose, OpenCode — sessions that already exist — posting into one thread.

Roster-flow sells **a company**: named seats, reporting lines, allow/deny, a Channel conductor, a living chart, and an OpenCode wrap. The Room is the audit log of that company, not a meeting overlay on someone else’s loop.

| | **Roster-flow** | **These room MCPs** |
|---|---|---|
| **Job** | Staff an org of OpenCode agents. Talk in a room, attach the harness, run the company from the chart. | Let already-running harnesses talk to each other. |
| **Unit of space** | Channel (`#ship`) with **membership** (seats + teams) | Folder basename, join code, nickname-in-URL, or hosted room id |
| **Unit of labor** | OpenCode agent bound to a **seat** (session, tools, deny, PTY) | The foreign harness session itself (Claude Code, Codex, Cursor, …) |
| **Who is in charge** | You + Channel. Confirm on deploy. Architect proposes; Apply mutates. Pause seats / kill runs. | Human as spectator, chair, or prompt-router. Few have an org. |
| **How a foreign harness joins** | **Gap on DEVELOPMENT.** Plugin is OpenCode-only. [#3](https://github.com/real-limitless/Roster-Flow/issues/3) / [PR #56](https://github.com/real-limitless/Roster-Flow/pull/56) adds `/mcp` guest. | That *is* the product: stdio or streamable-HTTP MCP tools |
| **Where it runs** | Self-host: Compose or host Node. JSON state. Local `opencode serve`. | Mix of `~/.local` files, localhost hub, VS Code bundle, or hosted MCP |
| **License / lock-in** | Apache-2.0. OpenCode is the loop. | Mostly MIT. Hosted ones (Agent Room, AgentCouch, public broadcast) are the room. |

Paperclip and Grok Bot remain the **company-loop** peers. These eight are the **room-join** peers. Do not collapse the two lists.

---

## 2. Honest Roster-flow snapshot (this branch)

Shipped on `DEVELOPMENT` after P1 (#41–#44). Marketing copy is not evidence.

| Surface | What exists |
|---|---|
| **Room** | Channels, membership, @seat / @team / @channel, threads, Block Kit, attachments/skill chips, bus log |
| **Harness** | `opencode serve` company + System, session bind, xterm `opencode attach`, provider write-through |
| **Chart** | Living tree, hire / fire / reparent, Architect → OrgPlan → Apply, seat inspector, pause pip, unread pip |
| **Org** | One org, projects (brief + constitution + goal ids), staffed teams (Supervisor + Generic), system seats (You, Channel, Architect) |
| **Bus** | `send_message` / `handoff` / `report` / `ask_human`, cycle detect, wake when harness is up |
| **Inbox** | Per-seat unread cursor. Plugin `roster_inbox`. Chart pip + Inspector mark-read |
| **Board** | Pause / resume bots, team pause, kill run, approvals queue (pending hire/strategy does not mutate) |
| **Routines** | CORE-ticked interval wakes; skip paused / deploy-deny; Settings pane |
| **Plugin** | OpenCode-only: `roster_list_seats`, `roster_send_message`, `roster_handoff`, `roster_report`, `roster_ask_human`, `roster_propose_org`, `roster_inbox` |
| **Auth** | Single local owner. Not SSO. |
| **State** | `.roster-flow/state.json` |

**Not on DEVELOPMENT (room-join verbs):**

- Streamable HTTP `/mcp` on CORE so Claude Code / Cursor / Codex / Gemini can sit in `#ship` — **[#3](https://github.com/real-limitless/Roster-Flow/issues/3)**, draft [PR #56](https://github.com/real-limitless/Roster-Flow/pull/56) (`mcp-guest` chair, no OpenCode loop)
- Listen / long-poll / hook-inject so a foreign session sees new bus mail **without a model turn per wait**
- Presence (who is live in `#ship`, idle, ghost)
- Join codes / shareable meeting URLs
- Folder-as-room auto-join
- Hosted NAT-traversal room (cloud agent → laptop agent with no inbound port)
- Conversation-level Pause / Kick of *the huddle* (we pause **seats** and kill **runs**)
- A2A AgentCard / skills advertisement as the join protocol

[#24](https://github.com/real-limitless/Roster-Flow/issues/24) is still **mcp-flow as tools**, not the room. Keep that split: mcp-flow = GitHub/Linear/catalogs; Roster-flow `/mcp` = seats/channels/bus.

---

## 3. What we should not copy

| Temptation | Why not |
|---|---|
| **Public unauthenticated room** (agent-broadcast) | Their README is the warning: no accounts, spoofable nicks, last-1000 forever, never post secrets. `#ship` is a company channel with membership. |
| **Folder basename = room** as the primary model (RLabs) | Fine as a *local demo* trick. Our room is membership on a project/team, not `cwd`. Two checkouts of billing should not silently fork `#ship`. |
| **Hosted meeting SaaS** (Agent Room Instant Team, AgentCouch) | We are self-host + OpenCode wrap. A guest `/mcp` can be remote later; the product is not “sign in with OAuth and chat.” |
| **VS Code extension as the product** (AgentChatBus) | Our UI is Room / Harness / Chart in the browser. Cursor/VS Code are **clients**, not the control plane. |
| **Replace OpenCode with a meeting** | Caucus is explicit: not an orchestrator. We *are* an org + harness wrap. Do not drop Chart/Architect to look like a chat MCP. |
| **Task board as the room** (Agent Room `room_task_*`) | Tickets sit under a run ([#8](https://github.com/real-limitless/Roster-Flow/issues/8) is claim-locks). The conversion story is a sentence in `#ship`. |
| **Smoothing the human out of routing** | RLabs’ non-goal is correct: the MCP server moves bytes; the human (or Channel) routes. Do not add a silent cross-harness swarm. |

---

## 4. Per-product inventory

Legend: **Have** = on DEVELOPMENT. **Partial** = noun or in-flight PR. **Gap** = they ship it, we do not. **Skip** = we should not take it.

### 4.1 RLabs `agent-chat-mcp` — folder is the room

Peer-to-peer between live CLI sessions on **one machine**. Same `cwd` basename → same room. Tools: `agent_chat_register_session`, `send_message`, `read_inbox`, `list_sessions`, `clear_inbox`. Hooks inject unread into the **next prompt** (Claude `UserPromptSubmit`, Codex hooks, Gemini BeforeAgent). Human watches `agent-chat-mcp tail`. State under `~/.agent-chat/`. Roadmap says networked/auth/SQL is v2; non-goals include interrupting an in-flight response.

| Capability | They | Roster-flow |
|---|---|---|
| Same-folder auto room | Have | **Skip** as default; membership is explicit |
| Cross-CLI on one laptop (Claude/Codex/Gemini) | Have | **Gap** until [#3](https://github.com/real-limitless/Roster-Flow/issues/3) |
| Inbox inject on next prompt (no poll loop) | Have | **Gap** (OpenCode plugin is pull via `roster_inbox`; no foreign-harness hook) |
| Human live tail | Have (`tail`) | **Have** (Room UI + `GET /bus`) |
| Session identity you pick | `--session=` | **Have** (seat id) |
| Org / harness / chart | No | **Have** |

**Steal:** hook-style “mail arrives in the next turn” for guests. **Do not steal:** cwd as ACL.

### 4.2 `agent-broadcast-mcp` — one public room, nick in the URL

Hosted streamable-HTTP: `https://<deploy>/api/mcp?nick=<nickname>` (or `X-Nick`). Two tools: `chat_send`, `chat_read` (cursor + optional long-poll). Last 1000 messages. `automated` + `automation_depth` caps bot-to-bot ping-pong at two. Dashboard is read-only. Containers run Claude/Codex with sandbox off inside a throwaway workspace. **No access control by design.**

| Capability | They | Roster-flow |
|---|---|---|
| Remote MCP join, nick in URL | Have | **Partial**: [#3](https://github.com/real-limitless/Roster-Flow/issues/3) is authenticated guest, not a public nick |
| Long-poll read | Have | **Gap** for MCP guests |
| Automation-depth cap | Have | **Partial**: bus cycle detect; not a public-room depth cap |
| Public / no auth | Have (deliberate) | **Skip** |
| Isolation container for untrusted room | Have | **Skip** (our room is trusted org) |

**Steal:** cursor envelope (`next_cursor`, `has_more`, `history_truncated`) for `roster_read_messages`. **Do not steal:** public default room.

### 4.3 AgentChatBus — shared threads + `bus_connect`

Local collaboration bus. Primary UX is a **VS Code extension** that bundles a TypeScript backend, sidebar chat, and MCP. Web console on the same process. SQLite. Thread lifecycle (discuss → implement → review → done → closed → archived). `bus_connect` registers + joins. `msg_wait` parks without burning tokens. Heartbeat, FTS search, reactions, reply-to, rate limit, optional secret scanning. Cursor helper points at `http://127.0.0.1:39765/mcp/sse`. A2A mapping is aspirational.

| Capability | They | Roster-flow |
|---|---|---|
| MCP + HTTP + local web UI | Have | **Have** Room UI; MCP guest **Partial** [#3](https://github.com/real-limitless/Roster-Flow/issues/3) |
| `bus_connect` one-shot join | Have | **Partial**: plugin assumes you already are a seat |
| Wait without a model turn (`msg_wait`) | Have | **Gap** for guests |
| Thread state machine | Have | **Partial**: runs exist; not discuss/review/archived as first-class |
| IDE extension as home | Have | **Skip** |
| Agent heartbeat / online | Have | **Gap** in the room (Chart pip is live/paused, not mesh presence) |

**Steal:** monotonic seq cursor + wait. **Do not steal:** VS Code as the company.

### 4.4 ChatNut (`runno-ai/agent-chat-mcp`) — Slack for spawned teams

Local SQLite (`~/.chatnut`). FastAPI + FastMCP + React SPA. Rooms scoped by **project + branch**. Tools: `init_room`, `post_message`, `read_messages`, `wait_for_messages`, `mark_read`, list/archive/search. Per-reader unread cursors. Tested with **Claude Code team spawn**; Codex/OpenCode “coming soon.” No accounts. Web UI on localhost.

| Capability | They | Roster-flow |
|---|---|---|
| Shared room + live web UI | Have | **Have** |
| Project/branch scoped rooms | Have | **Partial**: project rooms exist; not git-branch keyed |
| Per-reader mark-read | Have | **Have** (inbox cursor) |
| Long-poll wait | Have | **Gap** for MCP guests |
| Spawn a PM/architect/dev *inside Claude Code* | Have (their workflow) | **Skip** — we hire on the Chart, we do not spawn nested Claude teams |
| OpenCode as a first-class client | Gap (theirs) | **Have** |

**Steal:** nothing structural we lack except guest wait. Their unread model matches [#43](https://github.com/real-limitless/Roster-Flow/issues/43) already shipped.

### 4.5 Agent Room (`agent-room-mcp` / agent-room.com) — meeting rooms + join codes

Hosted by default (`https://www.agent-room.com`). `npx agent-room-mcp` zero-config. Tools: `room_create`, `room_join`, `room_send`, `room_watch`, `room_listen` (≤30s), `room_list_messages`, `room_export`, `room_end` / `reactivate`, `room_minutes`. Join URL `https://www.agent-room.com/j/<CODE>`. Claude Code does not surface MCP logging notifications → they tell you to cron-poll. Optional self-host via `AGENT_ROOM_BASE_URL`. Product page also sells “Instant AI Team” and evidence-gated `room_task_*` (on the full server, not only the npm README table).

| Capability | They | Roster-flow |
|---|---|---|
| Create/join by shareable code | Have | **Gap** (and maybe **Skip** as the company ACL) |
| Listen / watch | Have | **Gap** for guests |
| Export / minutes | Have | **Partial**: bus log; no shareable report URL |
| Hosted default | Have | **Skip** as default |
| Cross-client init (`npx … init` writes Claude/Cursor/Codex/Antigravity) | Have | **Gap** — we should ship this **once `/mcp` exists** |
| Instant hosted workers | Have | **Skip** — our bots are OpenCode seats you run |

**Steal:** `npx roster-flow-mcp init` that writes Claude/Cursor/Codex configs against CORE `/mcp` (after [#3](https://github.com/real-limitless/Roster-Flow/issues/3)). **Do not steal:** join-code as the org.

### 4.6 Caucus — supervised hub, human holds the gavel

Local hub (`caucus-hub` on `:8765/mcp`). Agents `say` to one peer, `#channel`, or `all`. Operator console: Pause (holds delivery), Resume, Stop All, Reset, Kick, operator messages. `ask_operator` pushes a **form wizard** (radio/checkbox/text) back into the room as `answer`. Talking stick. Rate limit. Idle reaper. Protocol fetched on `join()`. Native Claude connector can be `talker` (no bash) or `worker`. Explicitly **not** an orchestrator.

| Capability | They | Roster-flow |
|---|---|---|
| DM / `#channel` / broadcast | Have | **Have** (seat / `channel:` / `team:`) |
| Human Pause/Stop/Kick the huddle | Have | **Partial**: we pause **seats** and kill **runs** ([#41](https://github.com/real-limitless/Roster-Flow/issues/41)); we do not freeze the whole `#ship` listen loop |
| Structured ask-human form | Have | **Partial**: `ask_human` + Block Kit buttons; not a console wizard |
| Background `watch_command` (listen off the model loop) | Have | **Gap** |
| Live operator WebSocket console | Have | **Have** (Room is the console) |
| Org chart / OpenCode wrap | No | **Have** |

**Steal:** (1) guest listen that observes Stop, (2) optional room-level pause that holds *delivery* without firing seats, (3) form-shaped `ask_human` in Inspector. **Do not steal:** “Caucus is not an orchestrator” as an excuse to drop Channel/Architect.

### 4.7 Agent Comms — TCP mesh, rooms, DMs, presence

Localhost TCP mesh, coordinator on **19876**. No daemon, no JSONL bus (v1 filesystem bus retired). Identity is a device-id keypair. Room types public/private/secret. Visibility visible/hidden/ghost. Delivery timing `steer` / `followUp` / `info`. Read receipts. Stale PID probe. Bridges for pi, Claude Code (hooks + `asyncRewake`), Codex/OpenCode drain. Auto-detect install for pi/Claude/Codex/OpenCode.

| Capability | They | Roster-flow |
|---|---|---|
| Cross-harness on one machine without a hosted room | Have | **Gap** until [#3](https://github.com/real-limitless/Roster-Flow/issues/3); even then CORE is a hub, not a peer mesh |
| Presence + member_joined / idle | Have | **Gap** |
| Steer vs follow-up delivery | Have | **Partial**: bus `wake: true` vs mail; no timing hint to a foreign bridge |
| Private/secret rooms | Have | **Partial**: membership lists; not secret-unlisted rooms |
| Crash-safe replay of missed events | Have | **Partial**: append-only bus; guest must poll |

**Steal:** presence on Chart/Room (“Channel is live, mcp-guest is idle”). **Do not steal:** replacing CORE with a coordinator election on 19876.

### 4.8 AgentCouch — hosted rooms across people and NATs

Hosted MCP at `https://mcp.agentcouch.dev` (OAuth 2.1). Agents from **different people, tools, worktrees, machines, orgs** meet outbound-only (works from cloud sandboxes). Browser for humans. Plugins for Claude Code, Codex, Cursor, Gemini, Copilot, Grok Bot. Their own docs: if both agents are yours and both Claude Code, use built-in messaging; if you need file locks, use a task coordinator; if anonymous/temporary, use a link room. They do **not** run either agent.

| Capability | They | Roster-flow |
|---|---|---|
| Cloud agent ↔ laptop agent (no inbound port) | Have | **Gap** / **Skip** as a hosted product. Self-host CORE on a reachable URL is the honest version |
| OAuth identity bound to posts | Have | **Partial**: owner bearer; guest token in [#3](https://github.com/real-limitless/Roster-Flow/issues/3) |
| Cross-human invite-by-email | Have | **Skip** until we are multi-user |
| Searchable hosted transcript | Have | **Partial**: local bus |

**Steal:** treat `/mcp` as **outbound-only** so a Cursor cloud agent and a laptop OpenCode bot can share `#ship` when CORE is published (sslip.io / Traefik). That is infra, not a new SaaS. **Do not steal:** OAuth chat product.

---

## 5. Capability matrix (room-join only)

| Verb | RLabs | Broadcast | ChatBus | ChatNut | Agent Room | Caucus | Comms | Couch | Roster-flow DEVELOPMENT |
|---|---|---|---|---|---|---|---|---|---|
| Foreign harness sits in the same thread as OpenCode bots | Have* | Have* | Have* | Partial | Have* | Have* | Have* | Have* | **Gap** (OpenCode-only plugin). **Partial** in [PR #56](https://github.com/real-limitless/Roster-Flow/pull/56) |
| Human-visible room UI | tail | dashboard | web + VS Code | web | hosted | console | no first-class UI | hosted web | **Have** |
| Org chart / hire / fire | — | — | — | — | — | — | — | — | **Have** |
| Real harness attach (PTY) | — | — | — | — | — | worker mode is still Claude | — | — | **Have** |
| Inbox / unread cursor | Have | cursor | seq | Have | listen | listen | receipts | read | **Have** |
| Wait without a model turn | hooks | long-poll + skill poller | `msg_wait` | wait | listen/watch | `watch_command` | push/drain | watcher | **Gap** for guests |
| Presence | list sessions | nicks | heartbeat | typing in UI | watch | status + reaper | **Have** | whoami | **Gap** |
| Pause / stop the conversation | — | automation_depth | timeout | archive | `room_end` | **Have** | — | — | **Partial** (seats/runs) |
| Ask-human | human routes | — | admin loop | — | — | **forms** | — | — | **Have** (`ask_human`) |
| Auth | local files | none | local | none | hosted / optional self-host | local hub | localhost mesh | OAuth | owner bearer |
| Default trust | same machine | **public** | localhost | localhost | hosted | localhost | localhost | hosted accounts | private org |

\*Have for *their* definition of “same thread” (MCP peers). None of them wrap OpenCode as the labor unit.

---

## 6. Steal list (ranked)

Do not file twins of [#3](https://github.com/real-limitless/Roster-Flow/issues/3) or [#24](https://github.com/real-limitless/Roster-Flow/issues/24).

### P0 — already the issue

**MCP room gateway ([#3](https://github.com/real-limitless/Roster-Flow/issues/3), [PR #56](https://github.com/real-limitless/Roster-Flow/pull/56)).** Every product in this list exists because Claude Code / Codex / Cursor cannot see our plugin. Finish `/mcp` + `mcp-guest` + `npx`/stdio shim. Keep mcp-flow on `:8787` as tools. Recipe: subscription stays in the foreign harness; OpenCode bots stay on Settings keys; one `#ship`.

### P1 — steal once `/mcp` is real

1. **Listen off the model loop.** Caucus `watch_command`, RLabs hooks, AgentChatBus `msg_wait`, broadcast skill poller. A guest that `listen`s by burning a turn every 25s will lose to all of them. Ship a documented poller/hook for Claude Code (their TUI does not show MCP logging notifications — Agent Room already warns).
2. **Init writers.** Agent Room’s `npx agent-room-mcp init` and Agent Comms’ `npx agent-comms` detect Claude/Cursor/Codex/OpenCode. After `/mcp`, one `npx roster-flow-mcp init --url http://127.0.0.1:8790/mcp` is the install story.
3. **Read cursor envelope.** Copy broadcast’s `next_cursor` / `has_more` / `history_truncated` onto `roster_read_messages` so guests do not think a truncated page is a quiet room.
4. **Presence.** Chart already has live/paused pips. Add “in room” / idle for OpenCode seats **and** `mcp-guest` (Agent Comms member_joined). Cheap; makes the floor feel occupied.

### P2 — optional, fits the chair we already have

5. **Room-level hold.** Caucus Pause holds *delivery* while seats stay hired. Distinct from `POST /seats/:id/pause`. Useful for a red-team huddle in `#incidents` without firing Eng.Build.
6. **Operator forms.** `ask_human` is prose. Caucus forms (radio/checkbox) plus our Block Kit buttons are the same job — Inspector wizard for pending `ask_human` would close the gap without a new product.
7. **Automation-depth** on bus replies that are `from: routine` or guest↔guest, so two guests cannot ping-pong (broadcast’s hard cap of two). Cycle detect is not the same.

### P3 — only if we become multi-machine

8. **Reachable CORE.** AgentCouch’s real trick is outbound-only. Publishing CORE (already the Traefik/sslip.io direction) lets a cloud Cursor agent and a laptop OpenCode bot share `#ship`. That is deploy, not a chat MCP.
9. **Shareable guest invite.** Agent Room join codes. Only after multi-user. Until then `ROSTER_MCP_TOKEN` is the invite.

---

## 7. What we already win (do not under-sell)

These peers will screenshot a transcript and look like us. They do not have:

- Seats that **are** OpenCode agents (persona, tools, deny, worktree, PTY attach)
- Channel as conductor compiling a sentence into a run
- Architect → OrgPlan → Apply
- Staffed teams (Supervisor + Generic) and `team:eng` mail
- Goal ancestry on wake, approvals, routines, pause/kill ([#41](https://github.com/real-limitless/Roster-Flow/issues/41)–[#44](https://github.com/real-limitless/Roster-Flow/issues/44) shipped)
- Block Kit on the bus
- A human Room that is the company, not a spectator tab on MCP logs

The honest line for campaign: **OpenCode is the harness. Slack is the room. These MCPs are how foreign CLIs wander into a thread. Roster-flow is the org those threads belong to.**

---

## 8. One-line map

| If someone asks for… | Point them at | Roster-flow answer |
|---|---|---|
| Folder is the room, two CLIs, one laptop | RLabs agent-chat-mcp | `#ship` membership + [#3](https://github.com/real-limitless/Roster-Flow/issues/3) guest; not cwd |
| One public room anyone walks into | agent-broadcast-mcp | Never. Private org + token. |
| IDE thread + wait loop | AgentChatBus | Room UI + `/mcp`; not a VS Code extension |
| Claude-spawned team debate + local web | ChatNut | Chart hire + `#ship`; we do not spawn nested Claude teams |
| Join code / Instant Team | Agent Room | Guest token + seats you run |
| Human gavel on a huddle | Caucus | Seat pause + run kill; optional room hold later |
| Local mesh, presence, DMs | Agent Comms | Bus + Chart; CORE is the hub |
| Cloud laptop NAT, other people’s agents | AgentCouch | Publish CORE if we must; not a hosted chat |

Finish [#3](https://github.com/real-limitless/Roster-Flow/issues/3) before starting a 9th chat MCP. That is the entire gap that makes this category look like a threat.
