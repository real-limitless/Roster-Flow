# Roster-flow — product and architecture

Roster-flow is a team workspace for **humans plus OpenCode agents**. It does not reimplement an agent loop. OpenCode (`opencode serve` / attach / sessions / tools) is the harness. Roster-flow is the org, the room, the bot bus, the chart, and the settings UI that write through to OpenCode config.

This document matches the code on the `system/core` branch: a Vite marketing + workspace client, a local CORE API that wraps OpenCode, and an OpenCode plugin that maps org-chart seats onto harness agents.

## What it is

One-line: **Staff an org of OpenCode agents. Talk in a room, open the harness, or run the company from the org chart.**

Three surfaces, same seats and (when the harness is up) the same OpenCode session:

| Surface | Feels like | Unit |
|---|---|---|
| **Room** | Slack-like channels | Message, thread, run card |
| **Harness** | OpenCode TUI / CLI | Session, tool trace, attach |
| **Chart** | Living org tree | Seat, reporting line, run path |

A **bot** is an OpenCode agent with a Roster-flow identity: name, reports-to, allow/deny tools, model, owner. A **team** is a named roster you can @mention (`@eng`, `@qa`). **Floor** is the conductor: it compiles a human sentence into a run graph; it does not ship code.

## Hierarchy

```
Organization
 └── Project          (repo / product)
      └── Team        (named roster)
           ├── Conductor (Floor)
           ├── Specialist bots  (each = OpenCode agent)
           └── Human members
```

The starter company in `src/data.ts` and the API seed is the same tree: You / Maya / Jules / Priya plus Product, Eng.Build, Eng.Review, DevOps, QA, and a services lane (Scout, Docs, Sec, Scribe).

## How OpenCode is used (Everflow pattern)

[ProjectEverflow](https://github.com) on this machine wraps OpenCode rather than faking the loop:

1. **Ensure** — start or reuse `opencode serve` against a workspace (`everflow-sandbox-agent` `OpenCodeManager.ensure_host`).
2. **Health** — poll `/global/health`.
3. **Proxy** — platform API reverse-proxies session/message/prompt calls to that server.
4. **Harness pack** — write agents, plugins, and `opencode.json` into the workspace (Everflow `opencode_harness.py`).
5. **Auth inject** — provider keys land in OpenCode auth, not a parallel secret store.

Roster-flow CORE does the same locally, without Everflow sandboxes:

- `server/harness.mjs` resolves `OPENCODE_BIN` or `opencode` on `PATH`, binds a free port, runs `opencode serve --hostname 127.0.0.1 --port <n>`, waits on `/global/health`.
- `server/index.mjs` exposes Roster-flow resources (teams, bots, threads, runs, bus) and **proxies** OpenCode session/prompt when the harness is healthy.
- If OpenCode is not installed, the API stays up in **harness-offline** mode: room, chart, bus, and scripted ship-train still work; prompts are not faked as a real model.

## Bot-to-bot (Grok Bot + Oh My OpenAgent)

Faithful behaviors we implement (not UI-only):

- **Autonomous work** — a run wakes each seat in order (or in parallel when the graph says so). Each bot has its own OpenCode session when the harness is up.
- **Inter-bot mail** — `send_message` / `handoff` / `report` / `ask_human` on an audited bus (Oh My OpenAgent team mailbox pattern: fire-and-forget, inbox, wake idle recipient).
- **Chief of staff** — Floor routes; specialists execute; humans confirm deploy/merge.
- **Group thread** — the Room channel is the shared log (Grok Bot group chat).

The OpenCode plugin (`packages/roster-flow-opencode`) registers `roster_*` tools so an agent inside the harness can talk to peers through the same bus.

## Process map

```
Browser (Vite :5173)
    │  /api/v1/*
    ▼
CORE API (:8787)
    ├── store  (.roster-flow/state.json)
    ├── bus    (messages, cycle detect)
    ├── providers → writes .opencode/opencode.json + auth sidecar
    └── harness → opencode serve → sessions / prompt
              └── plugin roster-flow-opencode (roster_* tools → API)
```

## What is not in this slice

- Multi-tenant cloud sandboxes (that is Everflow’s product).
- Real SSO. Local demo uses no login, or `Authorization: Bearer roster-demo`.
- OpenChamber / OpenCode web iframe. Harness embeds `opencode attach` in xterm (PTY), not a second web app.
