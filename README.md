# Roster-flow

Staff an org of OpenCode agents. Talk in a room, open the harness, or run the company from the org chart.

Every bot is an OpenCode agent. Roster-flow does **not** reimplement the agent loop — it wraps `opencode serve` (Everflow pattern), maps org-chart seats onto those sessions, and gives humans a Slack-like room plus a living chart.

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
