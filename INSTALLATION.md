# Installation

Source: private kit TheFLOW. Family ritual: clone the product branch, then Compose.

`CORE` has no application source. Check out `DEVELOPMENT`.

## Product branch

```bash
git clone -b DEVELOPMENT https://github.com/real-limitless/roster-flow.git
cd roster-flow
```

If the clone defaulted to `CORE`:

```bash
git checkout DEVELOPMENT
```

You should see `package.json`, `src/`, `server/`, and `packages/`. If you only see markdown, you are still on `CORE`.

## Run (supported)

```bash
cp .env.example .env
docker compose up -d --build
```

| Process | URL | Role |
| --- | --- | --- |
| API | http://127.0.0.1:8790 | Teams, bots, bus, harness wrapper |
| UI | http://127.0.0.1:5173 | Marketing, `/setup`, `/app` |

mcp-flow uses 8787. Roster API does not.

## Contributor path (host Node)

Host Node is not the supported run path. For local UI work the product branch may still document `npm run standup`. Prefer Compose.

Optional: OpenCode CLI on `PATH`, or `OPENCODE_BIN`. Provider keys as needed. Without OpenCode the room and chart still run.

First run: open http://127.0.0.1:5173/setup.

Playwright and local demo agents should set `ROSTER_SKIP_ONBOARDING=1` so `/app` stays open.

Full agent path: [docs/STANDUP.md on DEVELOPMENT](https://github.com/real-limitless/roster-flow/blob/DEVELOPMENT/docs/STANDUP.md).
