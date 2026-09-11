# Standup path — humans and Playwright agents

Goal: an AI agent can install, seed, open the site, and bug-test Room / Harness / Chart / Settings end to end.

## Container install (official)

Needs Docker Compose v2 or Podman Compose, plus a clone of this repo. No host Node or OpenCode CLI.

```bash
cp -n .env.example .env
# optional: put provider keys in .env (never commit it)
docker compose up --build
# Podman: podman compose up --build
```

| Process | URL | Role |
|---|---|---|
| Product (static UI + CORE) | http://127.0.0.1:5173 | Marketing, `/setup`, `/app`; `/api` on the same origin |
| CORE API (host / family port) | http://127.0.0.1:8790/api/v1/health | Same API published beside mcp-flow's 8787 |
| CORE API (same process) | http://127.0.0.1:5173/api/v1/health | Teams, bots, bus, setup/auth, harness wrapper |
| Company OpenCode | inside the container (`127.0.0.1:14180`) | Product-bot sessions |
| System OpenCode | inside the container (`127.0.0.1:14181`) | Architect / Channel |

The image is production-ish: `vite build` plus `node server/index.mjs` serving `dist/`. OpenCode is installed in the image; CORE still starts in harness-offline mode if the binary is missing. State, auth sidecar, workspaces, harness logs, and `.opencode` live in the **`roster-data`** volume at `/data` (`ROSTER_DATA_DIR`). `compose down` / `up` keeps `/setup` completion.

Health:

```bash
curl -s http://127.0.0.1:5173/api/v1/health
curl -s http://127.0.0.1:5173/setup
```

First run: http://127.0.0.1:5173/setup. Install checks should show CORE ready, a writable data dir, and OpenCode (or a clear optional/offline warn). Completing owner → login → welcome lands in `/app`.

If 5173 is busy: `ROSTER_HTTP_PORT=8080 docker compose up --build`. Family API port is 8790 (mcp-flow keeps 8787).

Optional bind mount instead of the named volume (Fedora/Podman SELinux: add `:Z`):

```yaml
# docker-compose.override.yml (gitignored)
services:
  roster-flow:
    volumes:
      - ./.roster-flow:/data:Z
```

Do not put secrets in the image or a committed Compose override. Host `npm run standup` below stays supported for development.

Production-like without a container engine (same CORE + `dist/` process the image runs):

```bash
npm install
npm run build
npm run start:static   # http://127.0.0.1:8790/setup
```

## Host prerequisites

- Node 20+ (Node 22 is fine)
- npm
- Optional: [OpenCode CLI](https://opencode.ai) on `PATH`, or `OPENCODE_BIN=/path/to/opencode`
- Optional provider keys in the environment (`XAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …)

First run: open http://127.0.0.1:5173/setup (install → owner → login → harness → welcome). Playwright and local demo agents should set `ROSTER_SKIP_ONBOARDING=1` so `/app` stays open and the starter company still seeds.

## Host install

```bash
cd roster-flow
npm install
cp -n .env.example .env
npx playwright install chromium   # first time only
```

## Run (one command)

```bash
npm run standup
```

This starts:

| Process | URL | Role |
|---|---|---|
| CORE API | http://127.0.0.1:8790 | Teams, bots, bus, harness wrapper |
| Vite | http://127.0.0.1:5173 | Marketing + `/setup` + `/app` workspace |

Or separately:

```bash
npm run api          # :8790
npm run dev          # :5173, proxies /api → :8790
```

Health check:

```bash
curl -s http://127.0.0.1:8790/api/v1/health
curl -s http://127.0.0.1:5173/app
```

## URLs an agent should use

| URL | What to test |
|---|---|
| http://127.0.0.1:5173/ | Marketing home |
| http://127.0.0.1:5173/setup | First-run wizard (skipped when `ROSTER_SKIP_ONBOARDING=1`) |
| http://127.0.0.1:5173/login | Owner sign-in after setup |
| http://127.0.0.1:5173/app | Live workspace (Room default) |
| http://127.0.0.1:5173/app?mode=chart | Org chart |
| http://127.0.0.1:5173/app/settings | Providers / models |
| http://127.0.0.1:5173/org | Marketing org page + mock |
| http://127.0.0.1:5173/access | Access form |

## Auth

Local owner after `/setup`. Playwright sets `ROSTER_SKIP_ONBOARDING=1`; then `Authorization: Bearer roster-demo` is still accepted. Do not invent other tokens.

## Seed / demo data

On first API boot **with skip** (or after the welcome step picks **starter company**), `server/seed.mjs` writes `.roster-flow/state.json` from the same starter company as `src/data.ts`. Welcome can also pick an **empty org** (You + Channel + Architect, `#general` only). Existing data dirs without an `onboarding` field migrate as already complete. The starter roster:

- Channels: `#ship`, `#incidents`, `#eng-agents`, `#general`
- Seats: You, Maya, Jules, Priya, Channel, Architect, Product, Eng Supervisor + Eng Generic, Eng.Build, Eng.Review, DevOps, QA, Services Supervisor + Generic, Scout, Docs, Sec, Scribe
- Staffed teams: `@eng` and `@services` (Supervisor + Generic). `ship` is a run roster.
- Seed messages in `#ship` and `#incidents`

Reset (starter company, skip wizard):

```bash
rm -rf .roster-flow/state.json
ROSTER_SKIP_ONBOARDING=1 npm run api
```

## Stable selectors (use these, not CSS soup)

| `data-testid` | Where |
|---|---|
| `team-eng` `team-inspector` `team-seat-count` | Teams rail + title-modal inspector |
| `hire-form` `hire-persona` `seat-model` | Specialist hire + seat model |
| `workspace-shell` | `/app` root |
| `mode-room` `mode-harness` `mode-chart` | Triple-mode toggle |
| `channel-ship` | `#ship` in the rail |
| `composer` | Room composer textarea |
| `send-message` | Send |
| `composer-attach` `composer-skill` `composer-file` `composer-mic` | Slack-style compose tools |
| `composer-picker` | Skill / file picker popover |
| `picker-item-{id}` | Picker row (`deploy`, `billing-webhook-ts`) |
| `message-{id}` | Thread row, e.g. `message-m2` |
| `chip-skill-{id}` `chip-file-{slug}` | Chips on a sent message |
| `open-block-kit` | Opens `/app/blocks` builder |
| `org-chart` | Chart canvas |
| `architect-dock` `architect-plan` `architect-source` | Chart Architect |
| `org-connectors` | SVG overlay (paths should hit seats) |
| `seat-{id}` | Seat button, e.g. `seat-build` |
| `conversation-header` `conversation-title` `conversation-members` `conversation-search` | Slack-style room chrome (Search opens modal) |
| `workspace-search` | Top-bar search icon button |
| `search-projects` `search-teams` `search-seats` | Rail search icon buttons |
| `search-modal` `search-modal-input` | Workspace-wide search dialog |
| `search-scope-current` `search-scope-chip` | Scope to this conversation |
| `search-recent-{n}` | Recent query row |
| `search-result-{kind}-{id}` | Result row (`room`, `seat`, `team`, `project`, `message`) |
| `room-tab-messages` `room-tab-files` | Room tabs |
| `conversation-modal` | Title-click About modal |
| `roster-{id}` | Roster rail row (opens DM) |
| `toggle-inspector` | Show / hide seat panel |
| `seat-inspector` | Right person inspector |
| `attach-harness` | Inspector attach |
| `harness-term` `harness-xterm` | Live OpenCode TUI (xterm) |
| `settings-providers` | Settings form |
| `provider-id` `provider-save` | Add provider |
| `family-card-slack` `family-slack-status` `chip-slack-{id}` | Slack transport |
| `access-form` | `/access` |
| `setup-page` `setup-step-install` `setup-step-first-user` `setup-step-login` `setup-step-harness` `setup-step-welcome` | `/setup` wizard |
| `setup-name` `setup-email` `setup-password` `setup-create-owner` | First user |
| `setup-login-email` `setup-login-password` `setup-login-submit` | First login |
| `setup-skip-harness` `setup-template-empty` `setup-enter-workspace` | Harness skip + welcome |
| `login-page` | `/login` |

## Playwright

```bash
# API + Vite are started by webServer in playwright.config.ts
# The API always starts with ROSTER_SKIP_ONBOARDING=1 (does not reuse a leftover :8790).
npm run test:e2e
```

Smoke covers: home render, workspace room send, skill/file chips, click message to open seat inspector, Block Kit seed + builder, org chart connectors present, settings provider save, Architect staff-a-project apply, layoff apply. `tests/e2e/onboarding.spec.ts` walks `/setup` against an isolated API (no skip).

Headed (watch the agent):

```bash
npm run test:e2e -- --headed
```

## OpenCode (optional)

```bash
export OPENCODE_BIN=$(command -v opencode)
curl -s -X POST http://127.0.0.1:8790/api/v1/harness/ensure -H 'content-type: application/json' -d '{"forceRestart":false}'
curl -s -X POST http://127.0.0.1:8790/api/v1/harness/ensure -H 'content-type: application/json' -d '{"kind":"system"}'
```

If the CLI is missing, health returns `"harness":"offline"` and the room still works. Chart Architect needs the **System** harness (`systemHarness`); without OpenCode it errors instead of mocking a plan. Playwright sets `ROSTER_ARCHITECT_MODE=template` so CI does not need the CLI.

## Slack (optional transport)

`#ship` can map to a Slack channel. Tokens stay in env. Local path without a public URL:

```bash
export SLACK_CHANNEL_SHIP=C-SHIP
export ROSTER_SLACK_SKIP_VERIFY=1
curl -s -X POST http://127.0.0.1:8790/api/v1/slack/events \
  -H 'content-type: application/json' \
  -d '{"type":"event_callback","event":{"type":"message","channel":"C-SHIP","text":"@channel hello from Slack","user":"U1"}}'
```

Socket Mode: `SLACK_APP_TOKEN=xapp-… npm run slack`. Full notes: [docs/SLACK.md](SLACK.md).

Two-bot proof (needs a provider key in env or Settings):

```bash
npm run prove:two-bot
```

This posts `product → build` with `wake: true`. Exit 2 means no key; exit 1 is a real failure.

Plugin + bus unit tests:

```bash
npm run test:unit
```

## Agent bug-test checklist

1. `/` — hero, Room \| Harness \| Chart mock toggles.
2. `/app` — send a message in `#ship`; it appears. Attach a skill and a workspace file; chips land on the message.
3. Click a Channel or Product message — right Seat inspector shows that seat. Click Project/Team in the rail — Room header switches; inspector stays closed until a person is clicked. Title click opens the About modal.
4. Click **Block Kit** — builder preview + JSON. Seed Channel message in `#ship` shows rich blocks.
5. Mode **Chart** — connectors stay in the gutter between rows (they should not cut through sibling boxes). Drag empty canvas to pan; scroll to zoom; the view must stay put until Reset layout. Seats still click to select. Resize to ~390px; lines still meet seats.
6. Click `seat-build` — inspector shows tools; **Attach harness** flips mode.
7. `/app/settings` — add a custom provider; GET `/api/v1/providers` shows it.
8. `/access` — submit form, success copy.
9. Hunt regressions: `/product`, `/org`, `/harness` still render the mock chart/room.
