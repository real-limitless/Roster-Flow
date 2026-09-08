import assert from "node:assert/strict";
import test from "node:test";
import { emptyState, migrateFloorToChannel } from "./seed.mjs";
import { extractMentions, parseMentions, CONDUCTOR_ID } from "./mentions.mjs";

test("extractMentions finds unique tokens", () => {
  assert.deepEqual(extractMentions("hey @eng and @Build and @eng"), ["eng", "Build"]);
});

test("parseMentions resolves team, seat, and @channel", () => {
  const state = emptyState();
  const mentions = parseMentions("@channel please ask @eng and @Eng.Build", state);
  assert.deepEqual(
    mentions.map((m) => `${m.kind}:${m.id}`),
    [`channel:${CONDUCTOR_ID}`, "team:eng", "seat:build"],
  );
});

test("migrateFloorToChannel rewrites leftover Floor state", () => {
  const state = {
    seats: [{ id: "floor", name: "Floor", kind: "bot", role: "Conductor", job: "x", tools: [], deny: [], status: "idle" }],
    teams: [{ id: "ship", seatIds: ["floor", "product"] }],
    messages: [{ id: "m", who: "Floor", seatId: "floor", text: "hi" }],
    bus: [{ from: "floor", to: "product" }],
    sessions: { floor: "ses_old" },
    channels: [],
  };
  migrateFloorToChannel(state);
  assert.equal(state.seats[0].id, "channel");
  assert.equal(state.seats[0].name, "Channel");
  assert.deepEqual(state.teams[0].seatIds, ["channel", "product"]);
  assert.equal(state.messages[0].seatId, "channel");
  assert.equal(state.bus[0].from, "channel");
  assert.equal(state.sessions.channel, "ses_old");
});
