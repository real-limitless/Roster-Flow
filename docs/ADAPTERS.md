# BYO-agent adapters

Roster-Flow’s default bot is an OpenCode agent (`opencode serve` + `roster-flow-opencode`). That is the loop we wrap. **Adapters are transports on the same org chart**, not a second runtime.

| `adapter` | Wake | Attach / PTY |
|---|---|---|
| `opencode` (default) | Existing `wakeSeat` → OpenCode session | Unchanged |
| `webhook` | POST JSON payload to `adapterUrl` | No |
| `claude-code` | Notify (POST if `adapterUrl` is set) | No |
| `codex` | Same notify | No |

Webhook payload includes `callbacks.report` and `callbacks.handoff` so the remote harness can post `roster_report` back into `#ship` without becoming CORE.

Secrets: optional `adapterSecret` (bearer on the wake POST and on callbacks). Never returned from `GET /api/v1/seats`.

Hire UI and Architect `hire` ops accept `adapter`. Starter-company seats omit the field and stay OpenCode.

See [API.md](API.md).
