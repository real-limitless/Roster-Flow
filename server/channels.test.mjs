import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "./seed.mjs";
import { createChannel, patchChannel, resolveMembers } from "./channels.mjs";
import { CONDUCTOR_ID } from "./mentions.mjs";

test("createChannel persists membership and always includes conductor", () => {
  const state = emptyState();
  const ch = createChannel(state, { name: "war-room", teamIds: ["eng"], seatIds: ["you"] });
  assert.equal(ch.id, "war-room");
  assert.equal(ch.name, "#war-room");
  assert.ok(ch.seatIds.includes(CONDUCTOR_ID));
  assert.ok(ch.seatIds.includes("you"));
  assert.deepEqual(ch.teamIds, ["eng"]);
});

test("patchChannel add/remove teams and seats", () => {
  const state = emptyState();
  const ch = state.channels.find((c) => c.id === "general");
  patchChannel(state, "general", { addTeam: "eng", addSeat: "product" });
  assert.ok(ch.teamIds.includes("eng"));
  assert.ok(ch.seatIds.includes("product"));
  patchChannel(state, "general", { removeTeam: "eng", removeSeat: "product" });
  assert.ok(!ch.teamIds.includes("eng"));
  assert.ok(!ch.seatIds.includes("product"));
});

test("resolveMembers unions seats and team rosters", () => {
  const state = emptyState();
  const members = resolveMembers({ id: "x", teamIds: ["eng"], seatIds: ["you"] }, state);
  const ids = members.map((s) => s.id);
  assert.ok(ids.includes("you"));
  assert.ok(ids.includes("build"));
  assert.ok(ids.includes(CONDUCTOR_ID));
});
