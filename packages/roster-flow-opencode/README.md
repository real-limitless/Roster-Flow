# roster-flow-opencode

OpenCode plugin for Roster-flow CORE. Patterned after Oh My OpenAgent (package + hooks + team tools) and Grok Bot (autonomous seats that message each other).

Install is workspace-local: `.opencode/opencode.json` lists `"plugin": ["roster-flow-opencode"]`. The CORE API sets `ROSTER_API` when it starts `opencode serve`.

Tools: `roster_list_seats`, `roster_send_message`, `roster_handoff`, `roster_report`, `roster_ask_human`.

`roster_list_seats` includes team membership, `seatType`, model, persona, and instructions. Mail to `team:<id>` is Supervisor mail. The system hook tells the model to stay in its persona.
