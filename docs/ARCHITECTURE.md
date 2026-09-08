# Roster-flow — consensus architecture

This is the **CORE** write-up: what the product *is*, not the file map. Implementation lives on [`DEVELOPMENT`](https://github.com/real-limitless/roster-flow/tree/DEVELOPMENT).

Roster-flow is a team workspace for **humans plus OpenCode agents**. It does not reimplement an agent loop. OpenCode (`opencode serve` / attach / sessions / tools) is the harness. Roster-flow is the org, the room, the bot bus, the chart, and the settings UI that write through to OpenCode config.

## One-line

**Staff an org of OpenCode agents. Talk in a room, open the harness, or run the company from the org chart.**

## Surfaces

Three surfaces, same seats and (when the harness is up) the same OpenCode session:

| Surface | Feels like | Unit |
|---------|------------|------|
| **Room** | Slack-like channels | Message, thread, run card |
| **Harness** | OpenCode TUI / CLI | Session, tool trace, attach |
| **Chart** | Living org tree | Seat, reporting line, run path |

A **bot** is an OpenCode agent with a Roster-flow identity: name, reports-to, allow/deny tools, model, owner. A **team** is a named roster you can @mention (`@eng`, `@qa`). **Channel** is the conductor: it compiles a human sentence into a run graph and owns `@channel`. It does not ship code. A **room** (`#ship`) is a membership list of teams and seats.

## Hierarchy

```text
Organization
 └── Project          (repo / product)
      └── Team        (named roster)
           ├── Conductor (Channel)
           ├── Specialist bots  (each = OpenCode agent)
           └── Human members
```

The starter company is one **organization** (`roster-flow`) with a ship-train **project**. Product is that project's PM. `@eng`, DevOps, and QA hang off the project. `@services` is org-shared. **Architect** is a system seat: it proposes org plans on the Chart from a dedicated System OpenCode harness (not the company serve used by product bots). Multiple projects can sit under the org; each project PM has its own persona, instructions, knowledge, and skills.

## How OpenCode is used (Everflow pattern)

[ProjectEverflow](https://github.com/real-limitless/ProjectEverflow) wraps OpenCode rather than faking the loop:

1. **Ensure** — start or reuse `opencode serve` against a workspace.
2. **Health** — poll the harness until it is ready.
3. **Proxy** — the platform API talks to sessions and prompts on that server.
4. **Harness pack** — write agents, plugins, and OpenCode config into the workspace.
5. **Auth inject** — provider keys land in OpenCode auth, not a parallel secret store.

Roster-flow does the same locally, without Everflow sandboxes:

- A **company** serve for product bots.
- A **System** serve for Architect and Channel.
- If OpenCode is not installed, the API stays up in **harness-offline** mode: room, chart, and bus still work; Architect fails clearly instead of faking a model.

## Bot-to-bot

Faithful behaviors (not UI-only):

- **Autonomous work** — a run wakes each seat in order (or in parallel when the graph says so). Each bot has its own OpenCode session when the harness is up.
- **Inter-bot mail** — send, handoff, report, and ask-human on an audited bus.
- **Chief of staff** — Channel routes; specialists execute; humans confirm deploy/merge.
- **Group thread** — the Room channel is the shared log.

An OpenCode plugin registers roster tools so an agent inside the harness can talk to peers through the same bus.

## Process map

```text
Browser
    │
    ▼
CORE API
    ├── store   (org, seats, rooms, runs)
    ├── bus     (messages, cycle detect)
    ├── providers → OpenCode config + auth
    └── harness
          ├── company serve → product-bot sessions
          └── system serve  → Architect / Channel
                    └── plugin (roster tools → API)
```

## What this consensus is not

- Multi-tenant cloud sandboxes (that is Everflow's product).
- A second agent runtime, skill host, MCP host, or integration catalog (those are OpenCode and the Flow-family siblings).
- A claim that the company runs itself. Confirm on deploy.

Product-branch file map, API tables, and standup selectors: [docs on DEVELOPMENT](https://github.com/real-limitless/roster-flow/tree/DEVELOPMENT/docs).
