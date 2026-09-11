import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "./seed.mjs";
import { mutate, getState } from "./store.mjs";
import {
  deps,
  handleSlackAction,
  handleSlackEvent,
  mirrorToSlack,
  roomForSlackChannel,
  slackChannelForRoom,
  slackStatus,
  verifySlackRequest,
} from "./slack.mjs";

function resetLive() {
  mutate((s) => {
    Object.assign(s, emptyState());
  });
}

test("room map is env-only and has no token", () => {
  const prev = deps.env;
  deps.env = { SLACK_BOT_TOKEN: "xoxb-secret", SLACK_CHANNEL_SHIP: "C-SHIP", SLACK_ROOM_MAP: "incidents:C-INC" };
  try {
    assert.equal(slackChannelForRoom("ship"), "C-SHIP");
    assert.equal(roomForSlackChannel("C-INC"), "incidents");
    const status = slackStatus();
    assert.equal(status.connected, true);
    assert.equal(status.env, "SLACK_BOT_TOKEN");
    assert.ok(!JSON.stringify(status).includes("xoxb-secret"));
  } finally {
    deps.env = prev;
  }
});

test("inbound Slack human message lands in #ship and can mention @eng", async () => {
  resetLive();
  const prev = deps.env;
  deps.env = { SLACK_CHANNEL_SHIP: "C-SHIP", ROSTER_SLACK_SKIP_VERIFY: "1" };
  try {
    const before = getState().messages.length;
    const out = await handleSlackEvent({
      type: "event_callback",
      event: { type: "message", channel: "C-SHIP", user: "U1", text: "please ask @eng to ship the webhook", ts: "1.1" },
    });
    assert.equal(out.ok, true);
    assert.equal(out.room, "ship");
    const added = getState().messages.slice(before);
    assert.ok(added.some((m) => m.who === "Slack" && /@eng/.test(m.text) && m.slack?.inbound));
    assert.ok(out.wakes >= 1 || (out.mentions && out.mentions.length));
  } finally {
    deps.env = prev;
  }
});

test("ask_human mirrors to Slack with confirm/deny and actions post bus", async () => {
  resetLive();
  const prevEnv = deps.env;
  const prevFetch = deps.fetchFn;
  const posts = [];
  deps.env = { SLACK_BOT_TOKEN: "xoxb-test", SLACK_CHANNEL_SHIP: "C-SHIP" };
  deps.fetchFn = async (url, init = {}) => {
    posts.push({ url: String(url), body: JSON.parse(init.body || "{}") });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, ts: "2.2" }) };
  };
  try {
    const { postMessage } = await import("./chat.mjs");
    const msg = postMessage("ship", "Product", "bot", "Confirm deploy?", { seatId: "product" });
    const mirrored = await mirrorToSlack(msg, { kind: "ask_human" });
    assert.equal(mirrored.ok, true);
    assert.ok(posts[0].url.endsWith("/chat.postMessage"));
    assert.ok(!JSON.stringify(posts[0]).includes("xoxb-test"));
    const buttons = posts[0].body.blocks.find((b) => b.type === "actions").elements.map((e) => e.action_id);
    assert.deepEqual(buttons, ["slack.confirm", "slack.deny"]);

    const action = await handleSlackAction({
      actions: [{ action_id: "slack.confirm", value: msg.id }],
    });
    assert.equal(action.ok, true);
    assert.ok(getState().bus.some((e) => e.kind === "block_actions" && e.text.includes("slack.confirm")));
  } finally {
    deps.env = prevEnv;
    deps.fetchFn = prevFetch;
  }
});

test("verifySlackRequest honors skip flag and rejects a bad signature", () => {
  const prev = deps.env;
  deps.env = { SLACK_SIGNING_SECRET: "topsecret", ROSTER_SLACK_SKIP_VERIFY: "1" };
  try {
    assert.equal(verifySlackRequest("{}", "1", "v0=nope"), true);
  } finally {
    deps.env = prev;
  }
  deps.env = { SLACK_SIGNING_SECRET: "topsecret" };
  try {
    assert.equal(verifySlackRequest("{}", String(Math.floor(Date.now() / 1000)), "v0=deadbeef"), false);
  } finally {
    deps.env = prev;
  }
});
