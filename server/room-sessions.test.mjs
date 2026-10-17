import assert from "node:assert/strict";
import test from "node:test";
import { bindSessionMeta, parseRosterTitle } from "./harness.mjs";
import {
  CONTEXT_MAX_MESSAGES,
  cleanupRoomSessions,
  deps,
  roomContext,
  roomSessionEntry,
  roomSessionTitle,
  sessionRoom,
  setRoomSession,
} from "./room-sessions.mjs";
import { getState, mutate } from "./store.mjs";

function msg(id, who, text, extra = {}) {
  return { id, channel: "ship", who, seatId: extra.seatId || who.toLowerCase(), text, time: "12:04", ...extra };
}

test("room session titles carry the seat and the room", () => {
  assert.equal(roomSessionTitle("build", "ship"), "roster:build:ship");
  assert.deepEqual(parseRosterTitle("roster:build:ship"), { seatId: "build", channelId: "ship" });
  assert.deepEqual(parseRosterTitle("roster:build"), { seatId: "build", channelId: null });
  assert.equal(parseRosterTitle("something else"), null);
  const state = { seats: [], sessions: { build: "ses_dm" }, sessionRooms: {}, roomSessions: {} };
  assert.equal(bindSessionMeta({ id: "ses_room", title: "roster:build:ship" }, "company", state).channel, "ship");
  assert.equal(bindSessionMeta({ id: "ses_dm", title: "roster:build" }, "company", state).channel, "dm-build");
});

test("sessionRoom finds room sessions and DM sessions", () => {
  const state = {
    sessions: { build: "ses_dm" },
    systemSessions: { channel: "ses_sys" },
    sessionRooms: {},
    roomSessions: { build: { ship: { sessionId: "ses_ship", harness: "company" } } },
  };
  assert.deepEqual(sessionRoom(state, "ses_ship"), { sessionId: "ses_ship", seatId: "build", channelId: "ship", kind: "room", harness: "company" });
  assert.deepEqual(sessionRoom(state, "ses_dm"), { sessionId: "ses_dm", seatId: "build", channelId: "dm-build", kind: "dm", harness: "company" });
  assert.equal(sessionRoom(state, "ses_sys").harness, "system");
  assert.equal(sessionRoom(state, "nope"), null);
});

test("roomContext sends what the seat has not seen, oldest first, without System lines, its own posts, or the trigger", () => {
  const state = {
    messages: [
      msg("m1", "Maya", "old news"),
      msg("m2", "Product", "plan is ready"),
      msg("m3", "System", "Waking Eng.Build…", { system: true, seatId: undefined }),
      msg("m4", "Eng.Build", "on it", { seatId: "build" }),
      msg("m5", "Maya", "looks good"),
      msg("m6", "You", "@build status?", { seatId: "you" }),
    ],
    roomSessions: { build: { ship: { sessionId: "s", cursor: "m1" } } },
  };
  const ctx = roomContext(state, "build", "ship", { exclude: "@build status?" });
  assert.deepEqual(ctx.lines, ["[12:04] Product: plan is ready", "[12:04] Maya: looks good"]);
  assert.equal(ctx.cursor, "m6");
  const fresh = roomContext(state, "review", "ship", { exclude: "@build status?" });
  assert.equal(fresh.lines.length, 4);
  assert.equal(fresh.lines[0], "[12:04] Maya: old news");
});

test("roomContext keeps the newest messages within the caps", () => {
  const many = Array.from({ length: 50 }, (_, i) => msg(`n${i}`, "Maya", `note ${i}`));
  const ctx = roomContext({ messages: many, roomSessions: {} }, "build", "ship");
  assert.equal(ctx.lines.length, CONTEXT_MAX_MESSAGES);
  assert.equal(ctx.lines.at(-1), "[12:04] Maya: note 49");
  const long = Array.from({ length: 30 }, (_, i) => msg(`l${i}`, "Maya", `${i} ${"x".repeat(2000)}`));
  const capped = roomContext({ messages: long, roomSessions: {} }, "build", "ship");
  assert.equal(capped.lines.length, 19);
  assert.ok(capped.lines.every((l) => l.length === "[12:04] Maya: ".length + 400));
  assert.match(capped.lines.at(-1), /^\[12:04\] Maya: 29 x/);
});

test("cleanupRoomSessions deletes room sessions idle for 14 days", async () => {
  const prev = { ...deps };
  const deleted = [];
  deps.deleteSession = async (id, kind) => {
    deleted.push([id, kind]);
  };
  const now = Date.now();
  setRoomSession("cleanup-a", "ship", { sessionId: "ses_old", harness: "company", lastWakeAt: new Date(now - 15 * 86400_000).toISOString() });
  setRoomSession("cleanup-a", "general", { sessionId: "ses_new", harness: "system", lastWakeAt: new Date(now - 86400_000).toISOString() });
  try {
    const removed = await cleanupRoomSessions({ now });
    assert.deepEqual(removed, [{ seatId: "cleanup-a", channelId: "ship" }]);
    assert.deepEqual(deleted, [["ses_old", "company"]]);
    assert.equal(roomSessionEntry(getState(), "cleanup-a", "ship"), null);
    assert.equal(roomSessionEntry(getState(), "cleanup-a", "general").sessionId, "ses_new");
  } finally {
    mutate((s) => {
      delete s.roomSessions["cleanup-a"];
    });
    Object.assign(deps, prev);
  }
});
