# Project knowledge connectors

Project memory is **deny-by-default and project-scoped**. Billing’s constitution and repo are not a global RAG dump. Workspace data is **not used for training**.

## What is indexed

CORE-local search reads a bounded tree under the repo workspace:

- Kinds: `git` (local path), `github` (remote pointer + optional local checkout path), `docs` (markdown tree, default `docs/`).
- Text files only (`.md`, `.txt`, `.ts`, `.tsx`, `.js`, `.mjs`, `.json`, `.yml`). Caps: 80 files, 12 hits, skip `node_modules` / `.git` / `dist`.
- Paths cannot walk outside the workspace.

Secrets stay in env (`MCP_FLOW_ADMIN_TOKEN`, `GITHUB_TOKEN`). Connector rows in `state.json` are pointers only.

## mcp-flow first

If mcp-flow is up (`MCP_FLOW_URL/health`), CORE tries `GET /v1/knowledge/search?project=&q=`. When that endpoint exists, hits are labeled `source: "mcp-flow"`. If it is down or 404, CORE searches the local tree (`source: "core"`).

## Prompts

Product and Eng.Build wakes already include project brief + constitution. Attached connectors add pointer lines (`Attached sources: …` and the search URL). Disconnecting a connector removes it from the next wake. Persona strings are not the spec.

Plugin: `roster_knowledge`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/projects/:id/connectors` | Attached sources |
| POST | `/api/v1/projects/:id/connectors` | `{ kind, path?, remote?, root? }` |
| DELETE | `/api/v1/projects/:id/connectors/:cid` | Disconnect |
| GET | `/api/v1/projects/:id/knowledge?q=&seatId=` | Snippet search. Seats off the project get 403. |
