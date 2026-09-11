# GitHub PR and issue cards

Optional GitHub sidecar for `#ship`. Eng.Build’s job is still “own a worktree, ship the PR.” The worktree stays on disk; Roster-flow does not clone into a sandbox.

## Auth

Set a PAT or GitHub App **installation token** on the API process:

```
GITHUB_TOKEN=ghp_…
# or
GH_TOKEN=…
# optional override (Playwright mock):
ROSTER_GITHUB_API=https://api.github.com
```

The token is read from the environment at request time. It is never written to `state.json`, never returned by `GET /api/v1/state`, and never stored on the message card.

`GET /api/v1/github` and Family → GitHub show only `{ connected, env, api }`. Disconnecting (unset the token, or GitHub 401/unreachable) does not delete historical cards. They become **stale links**: title and URL remain, the room still loads, merge is refused.

## Report → Room card

`roster_report` (plugin) and `POST /api/v1/bus/send` accept `prUrl` and `branch`. A GitHub URL in `text` is enough (`https://github.com/owner/repo/pull/N`, `/issues/N`, or `owner/repo#N`).

CORE snapshots the pull or issue (title, state, checks) and stores a `github` object on the message. Room renders a card with Refresh and, for open pulls, Merge.

## Human-gated merge

Merge posts `POST /api/v1/block-actions` with `actionId: "github.merge"`. That path does **not** wake OpenCode.

Allowed: You, or any other **human** seat whose `deny` does not include `deploy`. Jules and Priya in the starter company cannot merge. Bots cannot click-merge.

## Refresh

- On first open of a card: `GET /api/v1/messages/:id/github`
- On demand: Room **Refresh** → `github.refresh` block-action

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/github` | Connected flag (no token) |
| GET | `/api/v1/messages/:id/github` | Refresh checks and return the card |
| POST | `/api/v1/block-actions` | `github.refresh` / `github.merge` — no harness wake |
