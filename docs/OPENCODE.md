# OpenCode harness wrapper and CORE plugin

## Why a wrapper

Roster-flow must not become a second agent runtime. The Everflow pattern (see `ProjectEverflow/everflow-sandbox-agent/app/opencode_mgr.py` and `everflow-platform-api/app/api/v1/opencode.py`) is:

1. Resolve a real `opencode` binary (reject stubs).
2. `ensure` — `opencode serve --hostname 127.0.0.1 --port <n>` in the project workspace.
3. Health — `GET /global/health`.
4. Talk to sessions over HTTP (Room / API), or attach the TUI (`opencode attach --session`) in the Harness xterm pane.
5. Write agents, plugins, and providers into the workspace `opencode.json`.

`server/harness.mjs` manages two local serves:

- **Company** — product bots, cwd repo root / `.roster-flow/workspace`, default port 14180.
- **System** — Architect and Channel only, cwd `.roster-flow/system`, default port 14181. Architect chat auto-ensures this serve and waits for a real OrgPlan.

## Plugin (Oh My OpenAgent shape)

[Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent) ships an OpenCode plugin package that registers tools + hooks (`team_send_message`, mailbox, lead/member lifecycle). We do the same, scoped to Roster-flow seats:

Package: `packages/roster-flow-opencode`

| Tool | Bus verb |
|---|---|
| `roster_list_seats` | Who is on the chart |
| `roster_send_message` | Peer or channel mail |
| `roster_handoff` | Close my phase, open yours |
| `roster_report` | Structured result to the originating thread |
| `roster_ask_human` | Park on `reports_to` (never `#general`) |
| `roster_propose_org` | Architect OrgPlan (does not apply) |

Hooks:

- `event` — bind OpenCode `agent` / session id to a seat.
- `experimental.chat.system.transform` — inject roster + mailbox so the model knows its job and peers.

Configured in `.opencode/opencode.json` (company) and `.roster-flow/system/.opencode/opencode.json` (System) as `"plugin": ["roster-flow-opencode"]`. The System serve sets `NODE_PATH` at the repo `node_modules` so the plugin still resolves.

## Settings (`/app/settings`)

[OpenChamber](https://docs.openchamber.dev/providers/) is a Settings UI over OpenCode config + auth — not a parallel provider store. Roster-flow Settings is the same write-through, plus the Flow-family join point. It does not reimplement Skills, MCP, or integrations.

| Pane | Owns | Writes |
|---|---|---|
| **Providers** | roster-flow | `.opencode/opencode.json` + `.roster-flow/auth.json` |
| **Harness** | roster-flow | `opencode serve` company (14180) and System (14181) |
| **Agents** | Chart (list only) | Hire/patch already writes `.opencode/agents/<seatId>.md` |
| **Family** | sibling products | none this pass — connection cards only |

Flow-family map (OpenChamber setting → owner):

- **Skills** — [skill-flow](https://github.com/real-limitless/skill-flow)
- **MCP** — [mcp-flow](https://github.com/real-limitless/mcp-flow)
- **Integrations** — [ansible-flow-mcp](https://github.com/real-limitless/ansible-flow-mcp) + [OpenFlow](https://github.com/real-limitless/OpenFlow) catalogs

Provider contract:

- Built-in-style ids: `anthropic`, `openai`, `xai`, `google`, plus **Other / Custom** (npm `@ai-sdk/openai-compatible`, `baseURL`, model list, optional headers).
- API key as `{env:VAR}` in `opencode.json` when possible; literal keys only in `.roster-flow/auth.json` (gitignored).
- Per-seat model is a Roster-flow field stored as `provider/model`. Hire/patch writes `.opencode/agents/<seatId>.md` (frontmatter `model`, `mode`, `permissions`; body = persona + instructions) and the matching `agents` block in `opencode.json`. Attach/wake send `{ providerID, modelID }` plus that agent id.
- Team Supervisor agents are `mode: primary`. Generic and specialists are `mode: all`. Mail to `team:<id>` wakes the Supervisor.
- Each staffed team also writes an OpenCode alias agent (`eng`, `services`, …) so harness `@eng` works. The Channel conductor is agent `channel` (`@channel`).
- Model pickers read the live `opencode serve` catalog when the harness is up, otherwise workspace + `~/.config/opencode`. Seats have default + fallback; teams can use `random`, `round_robin`, or `fuse`.

## Environment

```
OPENCODE_BIN=          # optional absolute path
OPENCODE_PORT=14180    # preferred serve port; falls back if busy
ROSTER_API=http://127.0.0.1:8787
ROSTER_WORKSPACE=.roster-flow/workspace
```
