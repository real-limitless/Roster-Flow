#!/usr/bin/env node
/** Slack Socket Mode → CORE /api/v1/slack/events. Secrets stay in env. */

const appToken = String(process.env.SLACK_APP_TOKEN || "").trim();
const apiBase = String(process.env.ROSTER_SLACK_API || "https://slack.com/api").replace(/\/+$/, "");
const core = String(process.env.ROSTER_API || "http://127.0.0.1:8790").replace(/\/+$/, "");

if (!appToken) {
  console.log(`Slack Socket Mode is optional.

Local Events API (no public URL):

  ROSTER_SLACK_SKIP_VERIFY=1
  curl -s -X POST ${core}/api/v1/slack/events \\
    -H 'content-type: application/json' \\
    -d '{"type":"event_callback","event":{"type":"message","channel":"C-SHIP","text":"@channel hello from Slack","user":"U1"}}'

Socket Mode (needs SLACK_APP_TOKEN=xapp-…):

  npm run slack
`);
  process.exit(0);
}

const opened = await fetch(`${apiBase}/apps.connections.open`, {
  method: "POST",
  headers: { Authorization: `Bearer ${appToken}`, "content-type": "application/json" },
});
const data = await opened.json();
if (!data.ok || !data.url) {
  console.error("apps.connections.open failed", data);
  process.exit(1);
}

const ws = new WebSocket(data.url);
ws.addEventListener("open", () => console.log("slack socket connected →", core));
ws.addEventListener("message", async (ev) => {
  let frame;
  try {
    frame = JSON.parse(String(ev.data));
  } catch {
    return;
  }
  if (frame.envelope_id) {
    ws.send(JSON.stringify({ envelope_id: frame.envelope_id }));
  }
  if (frame.type === "hello") return;
  const payload = frame.payload || frame;
  try {
    await fetch(`${core}/api/v1/slack/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("forward failed", err);
  }
});
ws.addEventListener("close", () => process.exit(0));
