# Roster-flow

**Staff an org of OpenCode agents. Talk in a room, open the harness, or run the company from the org chart.**

Every bot is an OpenCode agent. Roster-flow does **not** reimplement the agent loop: it wraps `opencode serve` (Everflow pattern), maps org-chart seats onto those sessions, and gives humans a Slack-like room plus a living chart.

![Hero: staff an org of agents: talk in a room or open the harness](docs/images/campaign-hero.png)

[Campaign brief](docs/CAMPAIGN.md) · [Storyboard](docs/campaign/) · [Architecture](docs/ARCHITECTURE.md) · [Installation](INSTALLATION.md) · Apache-2.0

## Clone

This tree **is** the product branch. If `package.json` is here, you do not need `-b DEVELOPMENT`.

```bash
git clone https://github.com/real-limitless/roster-flow.git
cd roster-flow
# Only if the tree is docs-only (GitHub default may still be CORE until an admin switches it):
git checkout DEVELOPMENT
```

Repo admins: set **default branch = `DEVELOPMENT`** (Settings → General). This file cannot do that click. `CORE` stays docs/methodology.

## Visual tour

| | |
| :---: | :---: |
| **Why it exists** | **Room** |
| ![Why: agents and tools do not share a floor](docs/images/campaign-why.png) | ![Room: humans and bots in #ship](docs/images/chat-room.png) |
| **Harness** | **Chart** |
| ![Harness: OpenCode session on Eng.Build](docs/images/chat-harness.png) | ![Chart: reporting lines are the control plane](docs/images/chat-chart.png) |
| **Setup** | **Login** |
| ![Setup: installation, owner, harness, welcome](docs/images/setup-welcome.png) | ![Login: local owner](docs/images/login.png) |

Screenshots live in [`docs/images/`](docs/images/). Re-shoot from [`docs/campaign/`](docs/campaign/) with `./capture.sh`.

---

## Why this exists

Slack proved work happens in conversation. OpenCode proved the unit of AI labor is a harnessed agent. Those still live in different tabs.

![Channel compiles a sentence into a run you still own](docs/images/campaign-orchestration.png)

Typical cases:

- The channel should be the audit log. Product briefs, Eng ships, you confirm, DevOps deploys, QA signs
- Every bot is an OpenCode agent you chose to run, not a skin on a chatbot
- Room, harness, and chart are the same seats. ⌘. cycles the surface

## Install (Docker or Podman)

Official path: no host Node toolchain. Needs a container engine and this repo.

```bash
cp -n .env.example .env   # optional: add XAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY
docker compose up --build
# Podman: podman compose up --build
```

Compose exposes **5175** (`ROSTER_WEB_PORT`) and **8790** (`ROSTER_API_PORT`) on the compose network only. It does not publish them on the host. Reach Roster through the proxy, or from another container at `http://roster-flow:8790`. 8787 is mcp-flow. Host `npm run dev` / `npm run api` still bind 5175 and 8790 on the machine.

State lives in the `roster-data` volume (survives `compose down`). Provider keys stay in `.env` / the environment: they are not baked into the image. Room, chart, and bus work if OpenCode is offline; Architect needs the System harness.

## Public demo (no owner)

Seeded starter company — Room `#ship`, Chart, Harness (offline banner is OK). No account.

```bash
npm run demo
```

Then http://127.0.0.1:5175/app (or homepage **See #ship**). State reseeds on restart and every 30 minutes. `POST /api/v1/reset` is off so a hosted demo cannot be wiped from a browser.

## Stand up (host Node, humans and Playwright agents)

```bash
npm install
npx playwright install chromium
npm run standup
```

- Marketing: http://127.0.0.1:5175/
- First-run setup: http://127.0.0.1:5175/setup
- Workspace: http://127.0.0.1:5175/app
- Settings (providers / models / Account password): http://127.0.0.1:5175/app/settings
- CORE API: http://127.0.0.1:8790/api/v1/health

Full container and host paths, selectors, seed data, and Playwright: [docs/STANDUP.md](docs/STANDUP.md).

Forgotten owner password: stop CORE, then `npm run owner:reset` (does not delete the company). Settings → Account rotates the hash while signed in.

```bash
npm run test:e2e
```

## Docs on this branch (`DEVELOPMENT`)

This is the **product branch**: the runnable app, API, and tests. Concept and methodology live on [`CORE`](https://github.com/real-limitless/roster-flow/tree/CORE).

- [Product / architecture](docs/ARCHITECTURE.md)
- [Campaign README](docs/CAMPAIGN.md)
- [CORE API](docs/API.md)
- [BYO adapters](docs/ADAPTERS.md)
- [Room MCP](docs/MCP.md) — Claude Code / Cursor join `#ship`; mcp-flow stays the tool gateway
- [OpenCode wrapper + plugin](docs/OPENCODE.md)
- [Slack bridge](docs/SLACK.md)
- [Project knowledge](docs/KNOWLEDGE.md)
- [GitHub PR cards](docs/GITHUB.md)
- [Standup](docs/STANDUP.md)
- [Community / Discussions](docs/COMMUNITY.md)

The public room is [GitHub Discussions](https://github.com/real-limitless/Roster-Flow/discussions). Pin **How to standup on DEVELOPMENT** (copy in `docs/COMMUNITY.md`) after an admin enables Discussions. Office hours are not listed on `/changelog` until they exist.

| Branch | Contents |
|--------|----------|
| **CORE** | Consensus only: why it exists, surfaces, methodology |
| **DEVELOPMENT** (this branch) | Runnable workspace, CORE API, OpenCode wrapper |

Apache-2.0. Part of the Flow family with [mcp-flow](https://github.com/real-limitless/mcp-flow), [skill-flow](https://github.com/real-limitless/skill-flow), and [ansible-flow-mcp](https://github.com/real-limitless/ansible-flow-mcp).
