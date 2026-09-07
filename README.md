# Roster-flow

**Staff an org of OpenCode agents. Talk in a room, open the harness, or run the company from the org chart.**

Every bot is an OpenCode agent. Roster-flow does **not** reimplement the agent loop — it wraps `opencode serve` (Everflow pattern), maps org-chart seats onto those sessions, and gives humans a Slack-like room plus a living chart.

![Hero: staff an org of agents — talk in a room or open the harness](docs/images/campaign-hero.png)

[Campaign brief](docs/CAMPAIGN.md) · [Storyboard](docs/campaign/) · [Architecture](docs/ARCHITECTURE.md) · Apache-2.0

## Visual tour

| | |
| :---: | :---: |
| **Why it exists** | **Room** |
| ![Why: agents and tools do not share a floor](docs/images/campaign-why.png) | ![Room: humans and bots in #ship](docs/images/chat-room.png) |
| **Harness** | **Chart** |
| ![Harness: OpenCode session on Eng.Build](docs/images/chat-harness.png) | ![Chart: reporting lines are the control plane](docs/images/chat-chart.png) |

Screenshots live in [`docs/images/`](docs/images/). Re-shoot from [`docs/campaign/`](docs/campaign/) with `./capture.sh`.

---

## Why this exists

Slack proved work happens in conversation. OpenCode proved the unit of AI labor is a harnessed agent. Those still live in different tabs.

![Floor compiles a sentence into a run you still own](docs/images/campaign-orchestration.png)

**You need this when:**

- The channel should be the audit log — Product briefs, Eng ships, you confirm, DevOps deploys, QA signs
- Every bot is an OpenCode agent you chose to run, not a skin on a chatbot
- Room, harness, and chart are the same seats — ⌘. cycles the surface

## Stand up (humans and Playwright agents)

```bash
npm install
npx playwright install chromium
npm run standup
```

- Marketing: http://127.0.0.1:5173/
- Workspace: http://127.0.0.1:5173/app
- Settings (providers / models): http://127.0.0.1:5173/app/settings
- CORE API: http://127.0.0.1:8787/api/v1/health

Full agent path, selectors, seed data, and Playwright: [docs/STANDUP.md](docs/STANDUP.md).

```bash
npm run test:e2e
```

## Docs on this branch (`system/core`)

- [Product / architecture](docs/ARCHITECTURE.md)
- [Campaign README](docs/CAMPAIGN.md)
- [CORE API](docs/API.md)
- [OpenCode wrapper + plugin](docs/OPENCODE.md)

Apache-2.0. Part of the Flow family with [mcp-flow](https://github.com/real-limitless/mcp-flow), [skill-flow](https://github.com/real-limitless/skill-flow), and [ansible-flow-mcp](https://github.com/real-limitless/ansible-flow-mcp).
