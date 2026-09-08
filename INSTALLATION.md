# Install Roster-flow

`CORE` has no application source. Check out **`DEVELOPMENT`**, then stand the workspace up.

## Product branch

```bash
git clone -b DEVELOPMENT https://github.com/real-limitless/roster-flow.git
cd roster-flow
```

If the clone defaulted to `CORE`, switch:

```bash
git checkout DEVELOPMENT
```

You should see `package.json`, `src/`, `server/`, and `packages/`. If you only see markdown, you are still on `CORE`.

## Host needs

- Node 20+ (Node 22 is fine)
- npm
- Optional: [OpenCode CLI](https://opencode.ai) on `PATH`, or `OPENCODE_BIN=/path/to/opencode`
- Optional provider keys (`XAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …)

Without OpenCode the room and chart still run. Architect chat needs a real harness.

## Stand up

```bash
npm install
npx playwright install chromium   # first time only
npm run standup
```

| Process | URL | Role |
|---------|-----|------|
| API | http://127.0.0.1:8787 | Teams, bots, bus, harness wrapper |
| Vite | http://127.0.0.1:5173 | Marketing + `/setup` + `/app` |

First run: open http://127.0.0.1:5173/setup (install → owner → login → harness → welcome).

Playwright and local demo agents should set `ROSTER_SKIP_ONBOARDING=1` so `/app` stays open.

Full agent path, seed data, and selectors: [docs/STANDUP.md on DEVELOPMENT](https://github.com/real-limitless/roster-flow/blob/DEVELOPMENT/docs/STANDUP.md).
