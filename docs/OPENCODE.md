# OpenCode harness wrapper and CORE plugin

## Why a wrapper

Roster-flow must not become a second agent runtime. The Everflow pattern (see `ProjectEverflow/everflow-sandbox-agent/app/opencode_mgr.py` and `everflow-platform-api/app/api/v1/opencode.py`) is:

1. Resolve a real `opencode` binary (reject stubs).
2. `ensure` — `opencode serve --hostname 127.0.0.1 --port <n>` in the project workspace.
3. Health — `GET /global/health`.
4. Talk to sessions over HTTP (Room / API), or attach the TUI (`opencode attach --session`) in the Harness xterm pane.
5. Write agents, plugins, and providers into the workspace `opencode.json`.

`server/harness.mjs` is that manager for a single local workspace (`.roster-flow/workspace`).

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

Hooks:

- `event` — bind OpenCode `agent` / session id to a seat.
- `experimental.chat.system.transform` — inject roster + mailbox so the model knows its job and peers.

Configured in `.opencode/opencode.json` as `"plugin": ["roster-flow-opencode"]`. The CORE API points `OPENCODE` at the repo root so the plugin resolves.

## Provider settings (OpenChamber shape)

[OpenChamber](https://docs.openchamber.dev/providers/) is a Settings UI over OpenCode config + auth — not a parallel provider store. Roster-flow `/app/settings` does the same:

- Built-in-style ids: `anthropic`, `openai`, `xai`, plus **Other / Custom** (npm `@ai-sdk/openai-compatible`, `baseURL`, model list).
- API key as `{env:VAR}` in `opencode.json` when possible; literal keys only in `.roster-flow/auth.json` (gitignored).
- Per-seat model is a Roster-flow field stored as `provider/model`. Hire/patch writes `.opencode/agents/<seatId>.md` (frontmatter `model`, `mode`, `permissions`; body = persona + instructions) and the matching `agents` block in `opencode.json`. Attach/wake send `{ providerID, modelID }` plus that agent id.
- Team Supervisor agents are `mode: primary`. Generic and specialists are `mode: all`. Mail to `team:<id>` wakes the Supervisor.

## Environment

```
OPENCODE_BIN=          # optional absolute path
OPENCODE_PORT=14180    # preferred serve port; falls back if busy
ROSTER_API=http://127.0.0.1:8787
ROSTER_WORKSPACE=.roster-flow/workspace
```
