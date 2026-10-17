import assert from "node:assert/strict";
import test from "node:test";
import { emptyState, migrateState } from "./seed.mjs";
import { createChannel, dropStaleLead, patchChannel, resolveMembers, responderCandidates } from "./channels.mjs";
import { fireSeat } from "./seats.mjs";
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

test("responderCandidates orders lead, team supervisors, bots reporting to humans, other bots, then the conductor", () => {
  const state = emptyState();
  const general = state.channels.find((c) => c.id === "general");
  assert.deepEqual(responderCandidates(general, state), [CONDUCTOR_ID]);
  const ship = state.channels.find((c) => c.id === "ship");
  assert.deepEqual(responderCandidates(ship, state), ["product", "devops", "build", "review", "qa", CONDUCTOR_ID]);
  assert.ok(!responderCandidates(ship, state).includes("mcp-guest"));
  const incidents = state.channels.find((c) => c.id === "incidents");
  const order = responderCandidates(incidents, state);
  assert.deepEqual(order.slice(0, 2), ["eng-supervisor", "services-supervisor"]);
  assert.equal(order.at(-1), CONDUCTOR_ID);
  patchChannel(state, "ship", { leadSeatId: "qa" });
  assert.equal(responderCandidates(ship, state)[0], "qa");
});

test("patchChannel validates leadSeatId and leaves the room untouched on a bad lead", () => {
  const state = emptyState();
  assert.throws(() => patchChannel(state, "general", { leadSeatId: "maya" }), /bot member/);
  assert.throws(() => patchChannel(state, "general", { addSeat: "qa", leadSeatId: "build" }), /bot member/);
  const general = state.channels.find((c) => c.id === "general");
  assert.ok(!general.seatIds.includes("qa"));
  patchChannel(state, "general", { addSeat: "qa", leadSeatId: "qa" });
  assert.equal(general.leadSeatId, "qa");
  patchChannel(state, "general", { removeSeat: "qa" });
  assert.equal(general.leadSeatId, null);
  patchChannel(state, "general", { addSeat: "qa", leadSeatId: "qa" });
  patchChannel(state, "general", { leadSeatId: null });
  assert.equal(general.leadSeatId, null);
});

test("firing a lead clears it from every room", () => {
  const state = emptyState();
  patchChannel(state, "ship", { leadSeatId: "qa" });
  fireSeat(state, "qa");
  assert.equal(state.channels.find((c) => c.id === "ship").leadSeatId, null);
});

test("dropStaleLead clears a lead that is not a bot member", () => {
  const state = emptyState();
  const ch = { id: "x", seatIds: ["you"], teamIds: [], leadSeatId: "build" };
  assert.equal(dropStaleLead(ch, state).leadSeatId, null);
});

test("migrateState keeps a channel lead across a reload", () => {
  const state = emptyState();
  patchChannel(state, "ship", { leadSeatId: "qa" });
  const reloaded = migrateState(JSON.parse(JSON.stringify(state)));
  assert.equal(reloaded.channels.find((c) => c.id === "ship").leadSeatId, "qa");
});
