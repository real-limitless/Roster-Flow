/** Slack transport for #ship. Secrets stay in env — never state.json. */

import { createHmac, timingSafeEqual } from "node:crypto";
import { postMessage, routeChannelMessage } from "./chat.mjs";
import { postBus } from "./bus.mjs";
import { getState } from "./store.mjs";

export const deps = {
  fetchFn: (...args) => fetch(...args),
  env: process.env,
};

export function slackBotToken() {
  const env = deps.env || process.env;
  return String(env.SLACK_BOT_TOKEN || "").trim();
}

export function slackSigningSecret() {
  const env = deps.env || process.env;
  return String(env.SLACK_SIGNING_SECRET || "").trim();
}

export function slackAppToken() {
  const env = deps.env || process.env;
  return String(env.SLACK_APP_TOKEN || "").trim();
}

export function slackApiBase() {
  const env = deps.env || process.env;
  return String(env.ROSTER_SLACK_API || "https://slack.com/api").replace(/\/+$/, "");
}

export function slackSkipVerify() {
  const env = deps.env || process.env;
  const v = String(env.ROSTER_SLACK_SKIP_VERIFY || "").trim();
  return v === "1" || /^true$/i.test(v);
}

export function slackRoomMap() {
  const env = deps.env || process.env;
  const map = {};
  const ship = String(env.SLACK_CHANNEL_SHIP || "").trim();
  if (ship) map.ship = ship;
  const raw = String(env.SLACK_ROOM_MAP || "").trim();
  for (const part of raw.split(",")) {
    const [room, channel] = part.split(":").map((s) => String(s || "").trim());
    if (room && channel) map[room.replace(/^#/, "")] = channel;
  }
  return map;
}

export function slackChannelForRoom(roomId) {
  const map = slackRoomMap();
  return map[String(roomId || "").replace(/^#/, "")] || null;
}

export function roomForSlackChannel(slackChannel) {
  const id = String(slackChannel || "");
  const map = slackRoomMap();
  for (const [room, channel] of Object.entries(map)) {
    if (channel === id) return room;
  }
  return null;
}

export function slackStatus() {
  const token = slackBotToken();
  const env = deps.env || process.env;
  return {
    connected: Boolean(token),
    env: token ? "SLACK_BOT_TOKEN" : null,
    api: slackApiBase(),
    shipChannel: slackChannelForRoom("ship"),
    signingSecret: Boolean(slackSigningSecret()),
    appToken: Boolean(slackAppToken()),
    skipVerify: slackSkipVerify(),
    socket: Boolean(String(env.SLACK_APP_TOKEN || "").trim()),
  };
}

export function verifySlackRequest(rawBody, timestamp, signature) {
  if (slackSkipVerify()) return true;
  const secret = slackSigningSecret();
  if (!secret) return false;
  const ts = String(timestamp || "");
  const sig = String(signature || "");
  if (!ts || !sig.startsWith("v0=")) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;
  const digest = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${rawBody}`).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(sig));
  } catch {
    return false;
  }
}

function askHumanBlocks(text, messageId) {
  return [
    { type: "header", text: { type: "plain_text", text: "ask_human" } },
    { type: "section", text: { type: "mrkdwn", text: String(text || "") } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Confirm" },
          action_id: "slack.confirm",
          value: messageId,
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Deny" },
          action_id: "slack.deny",
          value: messageId,
          style: "danger",
        },
      ],
    },
  ];
}

export async function slackApi(method, body) {
  const token = slackBotToken();
  if (!token) {
    const err = new Error("slack disconnected");
    err.status = 409;
    throw err;
  }
  const res = await deps.fetchFn(`${slackApiBase()}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = typeof res.text === "function" ? await res.text() : "";
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { ok: false, error: text };
  }
  return { ok: Boolean(res.ok) && data?.ok !== false, status: res.status || 0, data };
}

export async function mirrorToSlack(msg, { kind } = {}) {
  if (!msg || msg.slack?.inbound) return { skipped: true, reason: "inbound" };
  if (!slackBotToken()) return { skipped: true, reason: "disconnected" };
  const verb = String(kind || "");
  if (verb !== "ask_human" && verb !== "ask-human" && verb !== "report") return { skipped: true, reason: "kind" };
  const channel = slackChannelForRoom(msg.channel || "ship");
  if (!channel) return { skipped: true, reason: "unmapped" };
  const blocks =
    verb === "ask_human" || verb === "ask-human" ? askHumanBlocks(msg.text, msg.id) : msg.blocks || undefined;
  const posted = await slackApi("chat.postMessage", {
    channel,
    text: msg.text || "Roster-flow",
    blocks,
  });
  return { ok: posted.ok, slack: posted.data, kind: verb };
}

export async function handleSlackEvent(body = {}) {
  if (body.type === "url_verification") return { challenge: body.challenge };
  const event = body.event || {};
  if (event.bot_id || event.subtype === "bot_message") return { ignored: true, reason: "bot" };
  if (event.type !== "message" || event.hidden) return { ignored: true, reason: "type" };
  const room = roomForSlackChannel(event.channel);
  if (!room) return { ignored: true, reason: "unmapped" };
  const text = String(event.text || "").trim();
  if (!text) return { ignored: true, reason: "empty" };
  const msg = postMessage(room, "Slack", "human", text, {
    seatId: "you",
    slack: { inbound: true, channel: event.channel, ts: event.ts, user: event.user },
  });
  const routed = text
    ? await routeChannelMessage({ channelId: room, text, from: "you" })
    : { mentions: [], wakes: [], notify: [] };
  return { ok: true, room, message: msg, mentions: routed.mentions, wakes: routed.wakes };
}

export async function handleSlackAction(payload = {}) {
  const action = (payload.actions && payload.actions[0]) || {};
  const actionId = String(action.action_id || "");
  const messageId = String(action.value || payload.message?.metadata?.messageId || "");
  const msg = (getState().messages || []).find((m) => m.id === messageId);
  if (!actionId) {
    const err = new Error("action_id required");
    err.status = 400;
    throw err;
  }
  const userId = "you";
  const entry = postBus({
    from: userId,
    to: msg?.seatId || "channel",
    kind: "block_actions",
    text: `slack ${actionId}`,
    channel: msg?.channel || "ship",
    actionId,
    value: action.value,
    messageId,
    wake: true,
  });
  return { ok: true, actionId, messageId, bus: entry, mapped: Boolean(msg) };
}
