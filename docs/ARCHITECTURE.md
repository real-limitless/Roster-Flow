# Roster-flow — product and architecture

Roster-flow is a team workspace for **humans plus OpenCode agents**. It does not reimplement an agent loop. OpenCode (`opencode serve` / attach / sessions / tools) is the harness. Roster-flow is the org, the room, the bot bus, the chart, and the settings UI that write through to OpenCode config.

This document matches the code on the `DEVELOPMENT` branch: a Vite marketing + workspace client, a local CORE API that wraps OpenCode, and an OpenCode plugin that maps org-chart seats onto harness agents.

## What it is

One-line: **Staff an org of OpenCode agents. Talk in a room, open the harness, or run the company from the org chart.**

Three surfaces, same seats and (when the harness is up) the same OpenCode session:

| Surface | Feels like | Unit |
|---|---|---|
| **Room** | Slack-like channels | Message, thread, run card |
| **Harness** | OpenCode TUI / CLI | Session, tool trace, attach |
| **Chart** | Living org tree | Seat, reporting line, run path |

A **bot** is an OpenCode agent with a Roster-flow identity: name, reports-to, allow/deny tools, model, owner. A **team** is a named roster you can @mention (`@eng`, `@qa`). **Channel** is the conductor: it compiles a human sentence into a run graph and owns `@channel`. It does not ship code. A **room** (`#ship`) is a membership list of teams and seats.

## Hierarchy

```
Organization
 └── Project          (repo / product)
      └── Team        (named roster)
           ├── Conductor (Channel)
           ├── Specialist bots  (each = OpenCode agent)
           └── Human members
```

The starter company is one **organization** (`roster-flow`) with project **billing** (today’s ship-train). Product is that project’s PM. `@eng`, DevOps, and QA hang off billing. `@services` is org-shared. **Architect** is a system seat: it proposes org plans on the Chart from a dedicated **System** OpenCode harness (not the company serve used by product bots). The Channel conductor still compiles ship-train runs and owns `@channel`. Multiple projects can sit under the org; each project PM has its own persona, instructions, knowledge, and skills.

## How OpenCode is used (Everflow pattern)

[ProjectEverflow](https://github.com) on this machine wraps OpenCode rather than faking the loop:

1. **Ensure** — start or reuse `opencode serve` against a workspace (`everflow-sandbox-agent` `OpenCodeManager.ensure_host`).
2. **Health** — poll `/global/health`.
3. **Proxy** — platform API reverse-proxies session/message/prompt calls to that server.
4. **Harness pack** — write agents, plugins, and `opencode.json` into the workspace (Everflow `opencode_harness.py`).
5. **Auth inject** — provider keys land in OpenCode auth, not a parallel secret store.

Roster-flow CORE does the same locally, without Everflow sandboxes:

- `server/harness.mjs` resolves `OPENCODE_BIN` or `opencode` on `PATH` and can run **two** serves: company (product bots, default port 14180) and System (Architect / Channel, port 14181, cwd `.roster-flow/system`).
- `server/index.mjs` exposes Roster-flow resources (teams, bots, threads, runs, bus) and **proxies** OpenCode session/prompt when the matching harness is healthy.
- If OpenCode is not installed, the API stays up in **harness-offline** mode: room, chart, bus, and scripted ship-train still work; Architect chat fails clearly instead of faking a model. `ROSTER_ARCHITECT_MODE=template` is test-only.

## Bot-to-bot (Grok Bot + Oh My OpenAgent)

Faithful behaviors we implement (not UI-only):

- **Autonomous work** — a run wakes each seat in order (or in parallel when the graph says so). Each bot has its own OpenCode session when the harness is up.
- **Inter-bot mail** — `send_message` / `handoff` / `report` / `ask_human` on an audited bus (Oh My OpenAgent team mailbox pattern: fire-and-forget, inbox, wake idle recipient).
- **Chief of staff** — Channel routes; specialists execute; humans confirm deploy/merge.
- **Group thread** — the Room channel is the shared log (Grok Bot group chat).

The OpenCode plugin (`packages/roster-flow-opencode`) registers `roster_*` tools so an agent inside the harness can talk to peers through the same bus. CORE also serves those bus verbs (plus seat/channel reads) at `POST /mcp` so Claude Code, Cursor, and other MCP clients can sit in the room as `mcp-guest` without becoming a second OpenCode loop. mcp-flow remains the tool gateway.

## Process map

```
Browser (Vite :5173, or CORE-served dist in Compose)
    │  /api/v1/*
    ▼
CORE API (ROSTER_API_HOST, default 127.0.0.1:8787; Compose binds 0.0.0.0)
    ├── store  (ROSTER_DATA_DIR / .roster-flow/state.json)
    ├── bus    (messages, cycle detect)
    ├── providers → writes ROSTER_OPENCODE_DIR/opencode.json + auth sidecar
    └── harness
          ├── company serve → product-bot sessions
          └── system serve  → Architect / Channel
                    └── plugin roster-flow-opencode (roster_* tools → API)
```

`docker compose up` is the official install: one image runs CORE + the built UI + OpenCode. Company and System serves stay on container localhost so PTY attach still uses `opencode attach http://127.0.0.1:<port>`. Persist `/data` (`roster-data` volume). Host `npm run standup` is unchanged (Vite + loopback CORE).

## What is not in this slice

- Multi-tenant cloud sandboxes (that is Everflow’s product).
- Real SSO. Local first-run is an owner account (name, email, password) plus a bearer session. `ROSTER_SKIP_ONBOARDING=1` keeps the open-API demo path and still accepts `Authorization: Bearer roster-demo`.
- OpenChamber / OpenCode web iframe. Harness embeds `opencode attach` in xterm (PTY), not a second web app.
