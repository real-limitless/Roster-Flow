# roster-flow-opencode

OpenCode plugin for Roster-flow CORE. Patterned after Oh My OpenAgent (package + hooks + team tools) and Grok Bot (autonomous seats that message each other).

Install is workspace-local: `.opencode/opencode.json` lists `"plugin": ["roster-flow-opencode"]`. The CORE API sets `ROSTER_API` when it starts `opencode serve`.

Tools: `roster_list_seats`, `roster_send_message`, `roster_handoff`, `roster_report`, `roster_ask_human`. `roster_send_message` and `roster_report` accept optional Roster Block Kit `blocks` JSON. `roster_report` also accepts optional `prUrl` and `branch` for GitHub cards in `#ship`, and `jobId` (and optional `status`, `cost`, `tokens`) to complete a CORE job. `roster_ask_human` accepts `jobId` to park that job as `needs_human`.

`roster_list_seats` includes team membership, `seatType`, model, persona, and instructions. Mail to `team:<id>` is Supervisor mail. A job addressed to a team carries its own routing mode. The system hook tells the model to stay in its persona. When `ROSTER_API_TOKEN` is set on the OpenCode serve, tool calls send it as a bearer token.
