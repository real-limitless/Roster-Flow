# Slack bridge

Slack is a **transport** for `#ship`. OpenCode stays the harness. Roster-flow does not reimplement Slack.

## Secrets

Set on the API process (never `state.json`):

```
SLACK_BOT_TOKEN=xoxb-…
SLACK_SIGNING_SECRET=…
SLACK_APP_TOKEN=xapp-…          # Socket Mode only
SLACK_CHANNEL_SHIP=C0123456789
SLACK_ROOM_MAP=ship:C0123456789,incidents:C0ABCDEF
```

`GET /api/v1/slack` / Family → Slack show `{ connected, env, shipChannel }` without the token.

## Inbound

`POST /api/v1/slack/events` — Slack Events API (url_verification + message). Verifies `X-Slack-Signature` unless `ROSTER_SLACK_SKIP_VERIFY=1`.

A human message in the mapped Slack channel becomes a Room message (`who: Slack`, `via Slack` chip) and can wake `@channel` / `@eng` the same way as typing in `/app`.

Bot messages are ignored so CORE does not echo itself.

## Outbound

`ask_human` and `report` on `POST /api/v1/bus/send` `chat.postMessage` into the mapped Slack channel. ask_human includes Confirm / Deny buttons.

`POST /api/v1/slack/actions` (interactive payload) maps those buttons onto the bus (`block_actions`) the same way Room Block Kit does.

## Local standup

Events API without a public URL:

```bash
export SLACK_CHANNEL_SHIP=C-SHIP
export ROSTER_SLACK_SKIP_VERIFY=1
curl -s -X POST http://127.0.0.1:8790/api/v1/slack/events \
  -H 'content-type: application/json' \
  -d '{"type":"event_callback","event":{"type":"message","channel":"C-SHIP","text":"@channel hello from Slack","user":"U1"}}'
```

Socket Mode (needs a Slack app with Socket Mode + `SLACK_APP_TOKEN`):

```bash
npm run slack
```

That opens `apps.connections.open` and forwards envelopes to CORE. Signing can stay on; skip-verify is only for curl/Playwright.
