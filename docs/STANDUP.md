# Standup path — humans and Playwright agents

Goal: an AI agent can install, seed, open the site, and bug-test Room / Harness / Chart / Settings end to end.

Clone: this file is on the product tree. `git clone` of the GitHub URL should yield `npm run standup` once GitHub’s default branch is `DEVELOPMENT` (admin setting). If the clone is docs-only, `git checkout DEVELOPMENT`. Details: [INSTALLATION.md](../INSTALLATION.md), [CONTRIBUTING.md](../CONTRIBUTING.md).

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
| Product inside the container | `http://127.0.0.1:${ROSTER_API_PORT:-8790}` | Static UI + CORE on one port. Exposed on the compose network, not published on the host. |
| Room MCP | `http://127.0.0.1:${ROSTER_API_PORT:-8790}/mcp` | Streamable HTTP room gateway (not mcp-flow) |
| Web UI port | `ROSTER_WEB_PORT`, default `5175` | Exposed on the compose network, not published on the host. `ROSTER_PUBLIC_URL` follows this. 8787 is mcp-flow, not Roster. |
| Company OpenCode | inside the container (`127.0.0.1:14180`) | Product-bot sessions |
| System OpenCode | inside the container (`127.0.0.1:14181`) | Architect / Channel |

The image is production-ish: `vite build` plus `node server/index.mjs` serving `dist/`. OpenCode is installed in the image; CORE still starts in harness-offline mode if the binary is missing. State, auth sidecar, workspaces, harness logs, and `.opencode` live in the **`roster-data`** volume at `/data` (`ROSTER_DATA_DIR`). `compose down` / `up` keeps `/setup` completion.

Health from another container on the compose network (`roster-flow:8790`). Compose does not publish 8790 or 5175 on the host:

```bash
curl -s http://roster-flow:8790/api/v1/health
curl -s http://roster-flow:8790/setup
```

First run is `/setup` on that origin. Install checks should show CORE ready, a writable data dir, and OpenCode (or a clear optional/offline warn). Completing owner → login → welcome lands in `/app`. `GET /api/v1/setup/status` without a session returns booleans (`hasOwner`, `setupClosed`, and the checklist flags) and does not include the owner's email or name.

Family API port is **8790**. **8787 belongs to mcp-flow** and is not Roster's port. The web UI port in Compose is **5175**. Family health must not treat Roster’s own SPA or `/api/v1/health` as mcp-flow: a `/health` 200 only counts when it returns JSON that is not Roster CORE. Both ports are overridable:

```bash
ROSTER_API_PORT=8800 ROSTER_WEB_PORT=5180 docker compose up --build
```

`ROSTER_API` inside the container follows `ROSTER_API_PORT`. `ROSTER_PUBLIC_URL` follows `ROSTER_WEB_PORT` (`http://127.0.0.1:$ROSTER_WEB_PORT`). Compose `expose`s both ports on the compose network and does not publish them on the host. `npm run dev` still binds `ROSTER_WEB_PORT` (default 5175) on the machine, and `npm run api` binds `ROSTER_API_PORT` (default 8790). If that API port is already taken, CORE prints `ROSTER_API_PORT <port> is already in use` and exits.

### Compose environment

`docker-compose.yml` forwards these from the shell or `.env`. Empty means unset.

| Variable | Compose default | Purpose |
|---|---|---|
| `ROSTER_API_PORT` | `8790` | Port CORE listens on. Exposed on the compose network (not published on the host) and used by the healthcheck. |
| `ROSTER_WEB_PORT` | `5175` | Web UI port. Exposed the same way. Drives `ROSTER_PUBLIC_URL`. |
| `ROSTER_BOOTSTRAP_TOKEN` | unset | When set, `POST /api/v1/setup/first-user` requires it. |
| `ROSTER_OWNER_EMAIL` | unset | Seed the owner on first boot. |
| `ROSTER_OWNER_PASSWORD` | unset | Plaintext password for that owner. |
| `ROSTER_OWNER_PASSWORD_HASH` | unset | `scrypt$<salt>$<hash>` from `scripts/create-owner.mjs --hash`. Use this or the plaintext password. |
| `ROSTER_OWNER_NAME` | email local-part | Display name. |
| `ROSTER_OWNER_TEMPLATE` | `empty` | `empty` or `starter`. |
| `ROSTER_API_TOKEN` | unset | Register this `rf_…` token once an owner exists. |
| `ROSTER_API_TOKEN_SCOPES` | all scopes | Comma-separated `read`, `write`, `admin`. |
| `ROSTER_API_TOKEN_NAME` | `bootstrap` | Label stored on the token. |
| `ROSTER_CALLBACK_ALLOWLIST` | unset | Job `callbackUrl` hosts allowed to resolve to private or loopback addresses. Prefer `host:port`. Comma-separated, exact and case-insensitive, ASCII (punycode) only. IPv6 literals are normalized. An entry containing `*` is ignored (CORE warns at startup). Never opens link-local, metadata, or `0.0.0.0/8`. See [API.md](API.md#jobs). |
| `ROSTER_CALLBACK_SECRET` | generated | HMAC key for job callback signatures. At least 32 bytes. Each instance needs its own value. Unset: CORE generates one and an owner or admin can read it at `GET /api/v1/jobs/callback-secret`. Set: that value is used and rotate is disabled. |
| `ROSTER_CALLBACK_GRACE_MS` | `600000` | How long the previous callback secret is still accepted after rotate (10 minutes). Values above 24 hours are clamped to 24 hours. CORE always signs with the new secret. A second rotate drops the secret from before the first rotate immediately. |
| `ROSTER_CALLBACK_DNS_TIMEOUT_MS` | `5000` | DNS lookup timeout for a job `callbackUrl`. Maximum 30000; larger values are clamped. Hostnames are resolved at delivery. IP literals are rejected at create. A lookup timeout is stored as `dns_failed` and counts toward the `host:port` cooldown. |
| `ROSTER_HARNESS_AUTOSTART` | `auto` | `auto` (start serves once an owner exists and a provider is configured), `1` (start once an owner exists, provider or not), or `0` (never). See [Harness autostart](#harness-autostart). |
| `ROSTER_PROVIDER_ID` | unset | Provider id to seed, for example `featherless`. |
| `ROSTER_PROVIDER_NAME` | the id | Display name. |
| `ROSTER_PROVIDER_NPM` | unset | Optional provider package. |
| `ROSTER_PROVIDER_BASE_URL` | unset | OpenAI-compatible base URL. |
| `ROSTER_PROVIDER_API_KEY_ENV` | unset | **Name** of the env var that holds the key. The key is not written into config. |
| `ROSTER_PROVIDER_MODELS` | unset | Comma-separated model ids. |
| `ROSTER_FALLBACK_MODELS` | placeholder list | Comma-separated `provider/model` pairs for the connected-model fallback. First match wins and the value replaces the default list. Blank keeps `example-provider-dev/example-model`, `example-provider-dev/example-auto`, `example-provider/example-small`, then `standardcompute/StandardComputeRouter` and `xai/grok-4`. |
| `ROSTER_DEV_AGENT_MODEL` | `example-provider-dev/example-model` | Model for checked-in dev agents whose config says `{env:ROSTER_DEV_AGENT_MODEL}`. The serve sets this placeholder when the variable is blank so OpenCode does not substitute an empty model. |
| `OPENCODE_CONFIG` | empty | Optional operator OpenCode config. The whole file is deep-merged into both harness configs (`username`, `mcp`, plugins, and other keys). Roster provider blocks win on a conflicting id. Plugin lists are a union and always include `roster-flow-opencode`. The serve loads the roster file, not this path. |
| `FEATHERLESS_API_KEY` | unset | Key for the `featherless` provider that `roster-setup` writes as `{env:FEATHERLESS_API_KEY}`. Passed through to both OpenCode serves. |

`ROSTER_OWNER_*`, `ROSTER_BOOTSTRAP_TOKEN`, and `ROSTER_API_TOKEN` / `ROSTER_API_TOKEN_SCOPES` are applied on boot. See [Headless bootstrap](#headless-bootstrap-no-setup-screen) below.

### Dokploy

```bash
docker compose -f docker-compose.dokploy.yml up --build
```

The file joins the external network `dokploy-network` and registers aliases `roster-flow` and `roster`. It exposes 8790 and 5175 and does not publish them on the host. wiki-flow should call Roster at `http://roster-flow:8790` (or whatever `ROSTER_API_PORT` is). `ROSTER_PUBLIC_URL` defaults to `http://127.0.0.1:8790` on this file because CORE serves the UI on the API port; override it with the public hostname.

`roster-setup` is a one-shot that runs `scripts/setup-wiki-team.mjs` after CORE is healthy. It uses `ROSTER_API_TOKEN` (needs `write`) against `http://roster-flow:$ROSTER_API_PORT`. Set the same token on the app service so boot registers it, and set `ROSTER_OWNER_*` so an owner exists before the one-shot runs. If `ROSTER_API_TOKEN` is unset, the one-shot skips. `WIKI_MODEL` and `WIKI_PROJECT_ID` are optional (`deepseek-ai/DeepSeek-V4.1-Flash`, `wiki-flow-docs`). The provider models list always includes that model plus Qwen2.5-Coder-32B. Its provider write lands in `/data/opencode/opencode.json`; CORE restarts any running OpenCode serve so the provider is live, and `GET /api/v1/health` lists it under `loadedProviders`.

Optional bind mount instead of the named volume (Fedora/Podman SELinux: add `:Z`):

```yaml
# docker-compose.override.yml (gitignored)
services:
  roster-flow:
    volumes:
      - ./.roster-flow:/data:Z
```

### Data volume ownership

CORE and the OpenCode servers it starts run as the image's `node` user. Volumes created by older images, a root `docker exec`, or a host bind mount can leave root-owned entries anywhere under `/data`, and CORE then fails with `EACCES`. Two examples:

- `EACCES: permission denied, open '/data/opencode/opencode.json'` when `roster-setup` registers a provider.
- `EACCES` on `mkdir /data/home/.local` when `opencode serve` creates its XDG dirs.

The container starts as root, and on every start `docker/entrypoint.sh` repairs ownership before it drops to `node`:

- It creates `/data/home` (`HOME`), `/data/system`, `/data/workspace` (`ROSTER_WORKSPACE`), and `/data/opencode` (`ROSTER_OPENCODE_DIR`) if they're missing.
- It walks all of `/data` recursively and chowns only entries whose uid or gid is not `node`'s. That includes `/data` itself, every existing subfolder (for example `home/.local`, `workspace/*/.git`, and `lost+found`), and every file. Starts where everything is already owned by `node` change nothing. They still pay for one stat walk of `/data`.
- It never follows symlinks below `/data`. A symlink is chowned as a link (`chown -h`) and its target is left alone. If one of the four directories is a symlink that resolves outside `/data`, it is neither created nor repaired. The exception is `ROSTER_DATA_DIR` itself: if it is a symlink, it is resolved, and its target directory and everything under it are repaired as `/data`.
- It doesn't walk into other mounts inside `/data` (from `/proc/self/mountinfo`, with `find -xdev` as a fallback). A host bind mount at, say, `/data/workspace/repo` is not chowned, not even its mount point, and isn't checked. The exception is when `/data/home`, `/data/system`, `/data/workspace`, or `/data/opencode` is itself a separate mount. Each of those is walked and repaired as its own tree.
- As `node`, it creates the remaining directories (`system/.opencode/agents`, `opencode/agents`, and `home/.local/{share,state}`, `home/.config`, `home/.cache` for OpenCode). It then checks that those directories are readable and writable. It also checks the config and state files CORE rewrites in place. Anywhere under `/data`, it flags directories it can't read or enter, files it can't read, and entries it can't write that it doesn't own. Only after that check passes does it start `node server/index.mjs`.

If the container is started without root (a `user:` override in Compose or Dokploy), the entrypoint can't repair anything. It only runs the check. If anything fails the check, it exits 1 and lists each path with its owner and mode (at most 25). An unreadable subfolder is one of the reported paths; it doesn't make the script exit silently., and CORE never starts and never hits `EACCES`. The fix is to drop the override, or to `chown -R` the volume to the container uid once from the host. If the check still fails after a root repair (a read-only mount, NFS `root_squash`, or a symlink out of `/data`), the entrypoint exits 1 and says so.

Neither Compose file sets `user:`, so both run the entrypoint as root. `roster-setup` doesn't mount `/data`. It writes through CORE's API, so CORE's entrypoint covers it. If CORE still answers with `EACCES` or `EPERM`, `scripts/setup-wiki-team.mjs` exits 1 and points at this section.

The entrypoint passes any arguments through as the command to run, so one-off commands get the same repair and privilege drop: `docker compose run --rm roster-flow node scripts/create-token.mjs …`. `docker/entrypoint.test.mjs` covers the behavior. Its root cases run only when the test runs as root, for example `sudo node --test docker/entrypoint.test.mjs`.

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

First run: open http://127.0.0.1:5175/setup (install → owner → login → harness → welcome). Playwright and local demo agents should set `ENVIRONMENT=local` and `ROSTER_SKIP_ONBOARDING=1` so `/app` stays open and the starter company still seeds. The skip and the demo token are ignored unless `NODE_ENV` or `ENVIRONMENT` is `local`.

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
# public seeded demo (no owner): npm run demo
```

`npm run standup` starts:

| Process | URL | Role |
|---|---|---|
| CORE API | http://127.0.0.1:8790 | Teams, bots, bus, harness wrapper |
| Vite | http://127.0.0.1:5175 | Marketing + `/setup` + `/app` workspace |

`npm run demo` is the same processes with `ROSTER_SKIP_ONBOARDING=1` + `ROSTER_DEMO=1`. It seeds the starter company, shows a Demo chip in `/app`, reseeds on restart and every 30 minutes, and returns **403** on `POST /api/v1/reset`. Homepage **See #ship** goes to `/app` with no owner.

Owner + keys + OpenCode still uses `npm run standup` then `/setup`.

Or separately:

```bash
npm run api          # :8790
npm run dev          # :5175, proxies /api → :8790
```

Health check:

```bash
curl -s http://127.0.0.1:8790/api/v1/health
curl -s http://127.0.0.1:5175/app
```

## URLs an agent should use

| URL | What to test |
|---|---|
| http://127.0.0.1:5175/ | Marketing home |
| http://127.0.0.1:5175/setup | First-run wizard (skipped when `ROSTER_SKIP_ONBOARDING=1`) |
| http://127.0.0.1:5175/login | Owner sign-in after setup |
| http://127.0.0.1:5175/app | Live workspace (Room default) |
| http://127.0.0.1:5175/app?mode=chart | Org chart |
| http://127.0.0.1:5175/app/settings | Providers / models |
| http://127.0.0.1:5175/org | Marketing org page + mock |
| http://127.0.0.1:5175/access | Access form |

## Auth

Local owner after `/setup`. Playwright sets `ROSTER_SKIP_ONBOARDING=1`; then `Authorization: Bearer roster-demo` is still accepted. Do not invent other tokens.

Change password: Settings → Account (`POST /api/v1/auth/password`). Other sessions are revoked; the browser that submitted keeps its token.

Forgot the password and `/login` is unreachable: **stop CORE**, then:

```bash
npm run owner:reset
# non-interactive: npm run owner:reset -- --password 'new-password-here'
```

That rewrites the scrypt hash and drops sessions. Seats and runs stay. Do not delete `.roster-flow/state.json` to recover.

`.roster-flow/state.json` holds the callback secret, session tokens, and password hashes. CORE writes it with mode `0600` and sets that mode on an existing file at load. `.roster-flow/auth.json` (provider API keys) is written and tightened the same way.

## Headless bootstrap (no setup screen)

For unattended deploys, set the owner in env and CORE creates it on first boot, finishes onboarding (empty org by default), and closes `/setup`:

```
ROSTER_OWNER_EMAIL=ops@example.com
ROSTER_OWNER_PASSWORD=...            # or ROSTER_OWNER_PASSWORD_HASH=scrypt$<salt>$<hash>
ROSTER_OWNER_NAME=Ops                # optional
ROSTER_OWNER_TEMPLATE=empty          # or starter
```

Generate a hash so the plaintext never sits in env: `ROSTER_OWNER_PASSWORD=... node scripts/create-owner.mjs --hash`.
CLI alternative (writes to `ROSTER_DATA_DIR`, run before CORE starts): `ROSTER_OWNER_PASSWORD=... node scripts/create-owner.mjs --email ops@example.com`.

If you keep the interactive flow on a reachable host, set `ROSTER_BOOTSTRAP_TOKEN`. `POST /api/v1/setup/first-user` then requires it (header `x-roster-bootstrap-token`, or the Bootstrap token field on `/setup`). Once an owner exists, `first-user` returns 409 regardless. `POST /api/v1/setup/start-over` can reopen setup after that, but only with a valid owner session or the owner's password, and the same bootstrap token when it is set. Missing or wrong proof is 401, including a wrong email from an anonymous caller. A mismatched owner email is 403 only after the session or password has authenticated.

### API tokens for automation

Scripts should use a scoped API token instead of a login session. Create one in **Settings → API tokens**, with `POST /api/v1/tokens` (admin scope), or headlessly:

- `ROSTER_API_TOKEN=rf_<at least 21 more chars>` in env registers that token (all scopes; narrow with `ROSTER_API_TOKEN_SCOPES=read,write`) on boot once an owner exists. Set it alongside `ROSTER_OWNER_*` for a fully unattended deploy.
- `node scripts/create-token.mjs --name ci --scopes read,write [--days 90]` prints a new token once.

Revoked or expired tokens get 401; a token without the needed scope gets 403. `scripts/setup-wiki-team.mjs` requires `ROSTER_API_TOKEN`.

### Harness autostart

When an owner exists (seeded from `ROSTER_OWNER_*` or created in `/setup`) and a provider is configured, CORE starts company and system `opencode serve` on boot. `GET /api/v1/health` then reports `harness: "up"`, `systemHarness.harness: "up"`, and `ready: true` with no clicks. A missing binary leaves the API up and `harness: "offline"`.

Seed a provider from env (the named key var must also be present, for example `FEATHERLESS_API_KEY`):

```
ROSTER_PROVIDER_ID=featherless
ROSTER_PROVIDER_NAME=Featherless
ROSTER_PROVIDER_BASE_URL=https://api.featherless.ai/v1
ROSTER_PROVIDER_API_KEY_ENV=FEATHERLESS_API_KEY
ROSTER_PROVIDER_MODELS=model-a,model-b
```

`ROSTER_HARNESS_AUTOSTART=0` (or the older `ROSTER_DISABLE_HARNESS_AUTOSTART=1`) skips the serve start; `ROSTER_HARNESS_AUTOSTART=1` starts it without the provider check. The provider seed still runs. `auto` also starts when a provider key is already in the environment (`XAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `FEATHERLESS_API_KEY`, or the variable named by `ROSTER_PROVIDER_API_KEY_ENV`) or a model is already written in `opencode.json`. `GET /api/v1/health` then reports `harnessReady: true` once the company serve answers and at least one company seat can run. A single seat whose provider is missing is listed on `seats` with `ready: false` and does not clear `harnessReady`.

## Seed / demo data

On first API boot **with skip** (or after the welcome step picks **starter company**), `server/seed.mjs` writes `.roster-flow/state.json` from the same starter company as `src/data.ts`. Welcome can also pick an **empty org** (You + Channel + Architect, `#general` only). Existing data dirs without an `onboarding` field migrate as already complete. The starter roster:

- Channels: `#ship`, `#incidents`, `#eng-agents`, `#general`
- Seats: You, Maya, Jules, Priya, Channel, Architect, Product, Eng Supervisor + Eng Generic, Eng.Build, Eng.Review, DevOps, QA, Services Supervisor + Generic, Scout, Docs, Sec, Scribe
- Staffed teams: `@eng` and `@services` (Supervisor + Generic). `ship` is a run roster.
- Seed messages in `#ship` and `#incidents`

Reset (starter company, skip wizard):

```bash
rm -rf .roster-flow/state.json
ENVIRONMENT=local ROSTER_SKIP_ONBOARDING=1 npm run api
```

## Stable selectors (use these, not CSS soup)

| `data-testid` | Where |
|---|---|
| `team-eng` `team-inspector` `team-seat-count` | Teams rail + title-modal inspector |
| `hire-form` `hire-persona` `seat-model` | Specialist hire + seat model |
| `workspace-shell` | `/app` root |
| `demo-banner` | Public demo chip (resets on restart / interval) |
| `cta-see-ship` `cta-see-ship-footer` | Homepage See #ship |
| `mode-room` `mode-harness` `mode-chart` | Triple-mode toggle |
| `channel-ship` | `#ship` in the rail |
| `composer` | Room composer textarea |
| `ship-coach` `ship-coach-insert` `ship-coach-send` `ship-coach-dismiss` `ship-coach-chart` | First-run ship-train coach (dismiss forever) |
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
| `settings-nav-account` `settings-account` `account-form` `account-current` `account-next` `account-confirm` `account-submit` `account-recover` | Settings → Account |
| `login-recover` | `/login` owner:reset hint |
| `family-card-slack` `family-slack-status` `chip-slack-{id}` | Slack transport |
| `project-inspector` `project-constitution-field` | Project About modal |
| `knowledge-attach` `knowledge-search` `knowledge-hit` `knowledge-disconnect-{id}` | Project knowledge connectors |
| `family-card-github` `family-github-status` | Family GitHub sidecar (env token, not state.json) |
| `github-card-{id}` `github-link-{id}` `github-checks-{id}` `github-refresh` `github-merge` | Room PR/issue card in `#ship` |
| `access-form` | `/access` |
| `community-discussions` | Marketing footer Discussions link |
| `office-hours-empty` | `/changelog` until office hours exist |
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
