import assert from "node:assert/strict";
import test from "node:test";
import { emptyState, migrateState } from "./seed.mjs";
import {
  channelsForSeat,
  createChannel,
  dropStaleLead,
  ensureTeamRooms,
  patchChannel,
  publicChannel,
  resolveMembers,
  responderCandidates,
  roomLimits,
  roomResponder,
} from "./channels.mjs";
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

test("patchChannel sets respond and limits, and rejects unknown modes and bad limits", () => {
  const state = emptyState();
  const ch = patchChannel(state, "ship", { respond: "quiet", limits: { implicitPerMinute: 2 } });
  assert.equal(ch.respond, "quiet");
  assert.deepEqual(ch.limits, { implicitPerMinute: 2 });
  assert.equal(roomLimits(ch).implicitPerMinute, 2);
  assert.throws(() => patchChannel(state, "ship", { respond: "team" }), /respond must be one of lead, conductor, quiet/);
  assert.throws(() => patchChannel(state, "ship", { limits: { implicitPerMinute: 0 } }), /whole number/);
  assert.equal(state.channels.find((c) => c.id === "ship").respond, "quiet");
  patchChannel(state, "ship", { limits: { implicitPerMinute: null } });
  assert.deepEqual(state.channels.find((c) => c.id === "ship").limits, {});
  assert.equal(roomLimits(state.channels.find((c) => c.id === "ship")).implicitPerMinute, 4);
});

test("roomResponder follows the mode and publicChannel reports it", () => {
  const state = emptyState();
  const ship = state.channels.find((c) => c.id === "ship");
  assert.equal(roomResponder(ship, state), "product");
  ship.leadSeatId = "build";
  assert.equal(publicChannel(ship, state).responderSeatId, "build");
  ship.respond = "conductor";
  assert.equal(roomResponder(ship, state), CONDUCTOR_ID);
  ship.respond = "quiet";
  assert.equal(publicChannel(ship, state).responderSeatId, null);
  assert.equal(publicChannel(state.channels.find((c) => c.id === "general"), state).respond, "lead");
});

test("channelsForSeat lists direct and team rooms with lead and responder flags", () => {
  const state = migrateState(emptyState());
  state.channels.find((c) => c.id === "ship").leadSeatId = "build";
  const rooms = channelsForSeat(state, "build");
  const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(byId).sort(), ["eng-agents", "incidents", "ship", "team-eng"]);
  assert.equal(byId.ship.direct, true);
  assert.equal(byId.ship.lead, true);
  assert.equal(byId.ship.responder, true);
  assert.deepEqual(byId["eng-agents"].viaTeams, ["eng"]);
  assert.equal(byId["eng-agents"].direct, false);
  assert.equal(byId["team-eng"].responder, false);
  assert.equal(channelsForSeat(state, CONDUCTOR_ID).length, state.channels.length);
  assert.deepEqual(channelsForSeat(state, "nobody"), []);
});

test("staffed teams get a home room led by the supervisor, once", () => {
  const state = migrateState(emptyState());
  const eng = state.channels.find((c) => c.id === "team-eng");
  assert.deepEqual(eng.teamIds, ["eng"]);
  assert.equal(eng.leadSeatId, "eng-supervisor");
  assert.equal(eng.respond, "lead");
  assert.ok(state.channels.some((c) => c.id === "team-services"));
  assert.ok(!state.channels.some((c) => c.id === "team-ship"));
  eng.leadSeatId = null;
  const again = migrateState(state);
  assert.equal(again.channels.filter((c) => c.id === "team-eng").length, 1);
  assert.equal(again.channels.find((c) => c.id === "team-eng").leadSeatId, null);
});

test("a team room the client drafted before modes existed gets the supervisor as lead", () => {
  const state = emptyState();
  state.channels.push({ id: "team-eng", name: "@eng", topic: "", teamIds: [], seatIds: ["you"] });
  ensureTeamRooms(state);
  const eng = state.channels.find((c) => c.id === "team-eng");
  assert.deepEqual(eng.teamIds, ["eng"]);
  assert.equal(eng.leadSeatId, "eng-supervisor");
  assert.equal(eng.respond, "lead");
});
