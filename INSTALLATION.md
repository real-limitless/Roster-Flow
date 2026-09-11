# Installation

This file lives on the **product** tree. If you can see `package.json`, `src/`, `server/`, and `docker-compose.yml`, you already have it — do not assume you must pass `-b DEVELOPMENT`.

## Clone (works if GitHub default is CORE *or* DEVELOPMENT)

GitHub’s **default branch should be `DEVELOPMENT`**. That is a repo-admin click (Settings → General → Default branch). This PR cannot flip it.

```bash
git clone https://github.com/real-limitless/roster-flow.git
cd roster-flow
```

Then:

| What you see | What to do |
|---|---|
| `package.json` + `docker-compose.yml` | You are on the product tree. Continue below. |
| Markdown only (`BRANCHES.md`, `site/`, no `src/`) | You landed on `CORE`. Run `git checkout DEVELOPMENT`. |

`git clone -b DEVELOPMENT …` still works either way. Do not write docs that treat `CORE` as a permanent GitHub default.

`CORE` stays the methodology branch. Do not delete it.

## Run (supported)

```bash
cp -n .env.example .env
docker compose up --build
```

Then open http://127.0.0.1:5173/setup.

| Process | URL | Role |
|---|---|---|
| Product (UI + `/api`) | http://127.0.0.1:5173 | Marketing, `/setup`, `/app` |
| CORE API (host publish) | http://127.0.0.1:8790/api/v1/health | Same API next to mcp-flow’s 8787 |

mcp-flow uses **8787** on the host. Roster publishes **8790**. Inside the container CORE listens on 8787.

## Contributor path (host Node)

```bash
npm install
npm run standup
```

Full agent path: [docs/STANDUP.md](docs/STANDUP.md).
