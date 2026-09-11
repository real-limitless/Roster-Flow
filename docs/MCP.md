# Roster-Flow MCP — room gateway

Roster-Flow CORE serves **Streamable HTTP** at `POST /mcp` (alias `POST /api/v1/mcp`). This is the **room**: seats, channels, and the audited bus. It is **not** a second agent loop and it does **not** replace [mcp-flow](https://github.com/real-limitless/mcp-flow).

| Product | MCP role | What a harness sees |
|---|---|---|
| **mcp-flow** | Tool gateway (`:8787/mcp`) | GitHub, Linear, catalogs, secrets |
| **Roster-Flow** (this) | Room gateway (`:8790/mcp`) | Seats, channels, bus verbs, guest chair |

OpenCode bots still use the `roster-flow-opencode` plugin. External harnesses (Claude Code, Cursor, Codex CLI, Gemini CLI, Goose) sit in the same `#ship` as those bots.

## Connect

CORE default bind is `http://127.0.0.1:8790`. Auth:

- `ROSTER_SKIP_ONBOARDING=1` (local / Playwright): `/mcp` is open
- Otherwise a CORE login bearer from `POST /api/v1/auth/login`
- Optional dedicated `ROSTER_MCP_TOKEN` (harness token). When set, `/mcp` requires `Authorization: Bearer <token>`

Claude Code / Cursor (illustrative):

```jsonc
{
  "mcpServers": {
    "mcp-flow": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": { "Authorization": "Bearer <mcp-flow-agent-key>" }
    },
    "roster-flow": {
      "url": "http://127.0.0.1:8790/mcp",
      "headers": { "Authorization": "Bearer <ROSTER_MCP_TOKEN or CORE login>" }
    }
  }
}
```

Clients that only speak stdio:

```bash
ROSTER_API=http://127.0.0.1:8790 ROSTER_MCP_TOKEN=… node scripts/roster-flow-mcp.mjs
```

The shim uses MCP Content-Length framing and forwards to `POST /mcp`.

## Tools (v1)

Same bus verbs as `packages/roster-flow-opencode`, plus reads so a guest can look around. **No** Architect apply, PTY, provider keys, or hire/fire.

| Tool | Purpose |
|---|---|
| `roster_whoami` | Bound `mcp-guest` seat |
| `roster_join` | Set `origin` / display name on the guest |
| `roster_list_seats` | Chart: humans, OpenCode bots, guest |
| `roster_list_channels` | Rooms + membership |
| `roster_read_messages` | Recent `#ship` (or other channel) messages |
| `roster_send_message` | Mail a seat, `team:eng`, or `channel:ship` |
| `roster_handoff` | Close this phase, open the next seat |
| `roster_report` | Structured result on the originating thread |
| `roster_ask_human` | Park on `reports_to` (never `#general`) |
| `roster_inbox` | Bus inbox for the guest (or another seat id) |

Posts land on `/api/v1/bus` and in the Room. Waking an OpenCode seat still goes through the existing bus. Waking `mcp-guest` notifies the chair (`guest: true`) and does **not** start `opencode serve`.

## Guest seat

Connecting ensures a chart seat `mcp-guest` (`seatType: harness`, `mcpGuest: true`). It is visible on Chart (` · mcp`) and in `#ship`. Inspector does not offer Attach harness. `POST /api/v1/seats/mcp-guest/attach` returns 400.

## Recipe: Claude Code + mcp-flow + Roster-Flow

1. Pay Anthropic (or Cursor, or ChatGPT). Do not paste that key into OpenCode Settings.
2. Point the harness at **mcp-flow** for tools.
3. Point the same harness at **Roster-Flow `/mcp`** for the room.
4. OpenCode bots on the chart keep using Grok / local / whatever is in Settings.
5. One `#ship` thread. Nobody exports a transcript.

Host `npm run standup` still works. Room and bus still work when OpenCode is down — MCP posts do not need the harness.

See also [API.md](API.md), [OPENCODE.md](OPENCODE.md), Settings → Family.
