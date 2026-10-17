# OpenCode harness wrapper and CORE plugin

## Why a wrapper

Roster-flow must not become a second agent runtime. The Everflow pattern (see `ProjectEverflow/everflow-sandbox-agent/app/opencode_mgr.py` and `everflow-platform-api/app/api/v1/opencode.py`) is:

1. Resolve a real `opencode` binary (reject stubs).
2. `ensure` — `opencode serve --hostname <OPENCODE_HOSTNAME, default 127.0.0.1> --port <n>` in the project workspace.
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
| `roster_report` | Structured result to the originating thread (`prUrl` / `branch` → GitHub card). `jobId` completes that job (`done`, `failed`, or `needs_human`) |
| `roster_knowledge` | Project-scoped file/snippet search |
| `roster_ask_human` | Park on `reports_to` (never `#general`). `jobId` sets that job to `needs_human` |
| `roster_propose_org` | Architect OrgPlan (does not apply) |

Hooks:

- `event` — bind OpenCode `agent` / session id to a seat.
- `experimental.chat.system.transform` — inject roster + mailbox so the model knows its job and peers.

Configured in `.opencode/opencode.json` (company) and `.roster-flow/system/.opencode/opencode.json` (System) as `"plugin": ["roster-flow-opencode"]`. The System serve sets `NODE_PATH` at the repo `node_modules` so the plugin still resolves.

Each serve is spawned outside the git checkout (`ROSTER_WORKSPACE` for company, `.roster-flow/system` for System) with `OPENCODE_DISABLE_PROJECT_CONFIG=1`, so a project `opencode.json` or plugin cannot replace the provider list. `OPENCODE_CONFIG` and `OPENCODE_CONFIG_DIR` point at the file this process writes: `ROSTER_OPENCODE_DIR/opencode.json` for company (`/data/opencode` in Compose) and `.roster-flow/system/.opencode/` for System. An operator `OPENCODE_CONFIG` is deep-merged into both of those files before the serve starts (including `username`, `mcp`, and any other keys). The process does not load the operator path instead. Roster provider blocks win when the same provider id is set in both files. Plugin lists are the union of the operator list and the roster list, and always include `roster-flow-opencode`. Every `{env:VAR}` a provider block references is passed through to both serves.

Provider writes (`PUT /api/v1/providers`, key, delete) restart a running serve so it reloads. Before a wake, CORE reads `GET /config/providers` from the serve and only sends a model OpenCode loaded; the fallback model and the `Waking <seat> (<model>)…` line use the same list. A provider that is missing, or a turn the provider rejects (for example 401), is posted to the room as a System line instead of an opaque 500 or a silent no-reply. `harness`, `loadedProviders`, and setup `harnessReady` all come from a live health check.

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
- **MCP tools** — [mcp-flow](https://github.com/real-limitless/mcp-flow)
- **MCP room** — Roster-Flow CORE `POST /mcp` (guest seat on the chart; not an OpenCode loop). [docs/MCP.md](MCP.md)
- **Integrations** — [ansible-flow-mcp](https://github.com/real-limitless/ansible-flow-mcp) + [OpenFlow](https://github.com/real-limitless/OpenFlow) catalogs

Provider contract:

- Built-in-style ids: `anthropic`, `openai`, `xai`, `google`, plus **Other / Custom** (npm `@ai-sdk/openai-compatible`, `baseURL`, model list, optional headers).
- API key as `{env:VAR}` in `opencode.json` when possible; literal keys only in `.roster-flow/auth.json` (gitignored).
- Per-seat model is a Roster-flow field stored as `provider/model`. Hire/patch writes `.opencode/agents/<seatId>.md` (frontmatter `model`, `mode`, `permissions`; body = persona + instructions) and the matching `agents` block in `opencode.json`. Attach/wake send `{ providerID, modelID }` plus that agent id.
- Team Supervisor agents are `mode: primary`. Generic and specialists are `mode: all`. Mail to `team:<id>` wakes the Supervisor. Jobs use an explicit routing mode (`supervisor`, `round_robin`, or a named specialist) instead of always waking the Supervisor.
- Each staffed team also writes an OpenCode alias agent (`eng`, `services`, …) so harness `@eng` works. The Channel conductor is agent `channel` (`@channel`).
- Model pickers read the live `opencode serve` catalog when the harness is up, otherwise workspace + `~/.config/opencode`. Seats have default + fallback; teams can use `random`, `round_robin`, or `fuse`.

## Environment

```
OPENCODE_BIN=          # optional absolute path
OPENCODE_HOSTNAME=127.0.0.1
OPENCODE_PORT=14180    # preferred serve port; falls back if busy
ROSTER_API=http://127.0.0.1:8790
ROSTER_API_HOST=127.0.0.1   # Compose sets 0.0.0.0
ROSTER_DATA_DIR=.roster-flow
ROSTER_OPENCODE_DIR=.opencode
ROSTER_WORKSPACE=.roster-flow/workspace
ROSTER_STATIC_DIR=          # set to dist/ so CORE serves the UI
GITHUB_TOKEN=               # optional PAT / GitHub App installation token
GH_TOKEN=                   # alias
ROSTER_GITHUB_API=https://api.github.com
ROSTER_MCP_TOKEN=            # optional dedicated bearer for POST /mcp
WIKIFLOW_URL=               # wiki-flow base URL (wikiflow_* tools)
WIKIFLOW_TOKEN=             # wiki-flow Bearer token; never commit it
FEATHERLESS_API_KEY=        # used by scripts/setup-wiki-team.mjs seats via {env:...}
```

## OpenCode config schema

Roster writes `opencode.json` using OpenCode's documented keys only ([config schema](https://opencode.ai/config.json)):
`provider` (blocks with `npm`, `name`, `options.{baseURL,apiKey}`, `models`), `agent` (entries with `prompt`, `mode`, `model`, `permission`),
and agent Markdown frontmatter `permission:` (`edit: deny`, `bash: deny`, or a bash pattern map). OpenCode keeps the last matching bash rule, so `"*": allow` is written before `"deploy *": deny`.
Older configs with `providers` / `agents` / `settings` / `package` / `system` / `permissions` are folded into that shape on the next write (`normalizeOpenCodeConfig` in `server/providers.mjs`).

## wiki-flow tools

The `roster-flow-opencode` plugin adds three tools that call wiki-flow with `Authorization: Bearer $WIKIFLOW_TOKEN` against `$WIKIFLOW_URL`:

| Tool | Request |
| --- | --- |
| `wikiflow_read_source {owner, repo, paths?}` | `GET /api/v1/repos/:owner/:repo/sources[?paths=a,b]` → `{sources:[{path,language,bytes}]}` (content added for `paths`) |
| `wikiflow_search {owner, repo, q}` | `GET /api/v1/repos/:owner/:repo/sources/search?q=` → `{results:[{path,line,snippet}]}` |
| `wikiflow_put_page {owner, repo, slug, runId, title, markdown, sources, agent}` | `PUT /api/v1/repos/:owner/:repo/pages/:slug` with body `{runId, title, markdown, sources, agent}` |

`runId` must name an existing wiki-flow run (404 if unknown, 409 if the run is complete). `WIKIFLOW_TOKEN` is the wiki-flow service token (`WIKIFLOW_API_TOKEN` on the wiki-flow side). `sources` is a JSON array of `{path, startLine?, endLine?}` (1-based lines, `endLine >= startLine`); other shapes or extra keys are rejected before the request; `agent` defaults to the calling OpenCode agent. If `WIKIFLOW_TOKEN` or `WIKIFLOW_URL` is missing, the tool fails with a message naming the variable. Non-2xx responses surface as `wiki-flow <status>: <error>`.

Both variables are passed to `opencode serve` by `serveChildEnv` (`server/providers.mjs`) and to the container by `docker-compose.yml` (`WIKIFLOW_URL`, `WIKIFLOW_TOKEN` from the host env).

### Wiki team

`FEATHERLESS_API_KEY=... ROSTER_API_TOKEN=rf_... npm run setup:wiki` (CORE must be running; the token needs write scope) registers the Featherless provider (`https://api.featherless.ai/v1`, key by `{env:FEATHERLESS_API_KEY}`), creates the `wiki-flow-docs` project, and staffs `@wiki` with `wiki-architect`, `wiki-scribe`, `wiki-diagrammer`, and `wiki-editor` on `featherless/<model>` (override with `WIKI_MODEL`). Re-running is safe: existing project/team return 409 and only missing specialists are hired.
