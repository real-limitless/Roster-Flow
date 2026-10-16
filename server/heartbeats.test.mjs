import assert from "node:assert/strict";
import test from "node:test";
import { applyBudgetSideEffects } from "./budget.mjs";
import { tickHeartbeats, heartbeatPrompt, heartbeatSkipReason, unansweredMentions } from "./heartbeats.mjs";
import { pauseSeat } from "./seats.mjs";
import { emptyState, migrateState } from "./seed.mjs";

function withInbox(state, to = "product") {
  state.bus = [
    {
      id: "bus-hb",
      from: "you",
      to,
      kind: "send_message",
      text: "please look at this",
      time: "2026-09-11T12:00:00.000Z",
    },
  ];
  state.inboxCursors = {};
}

test("heartbeat is off by default", () => {
  const state = migrateState(emptyState());
  const product = state.seats.find((s) => s.id === "product");
  withInbox(state);
  assert.equal(heartbeatSkipReason(state, product), "off");
  assert.equal(tickHeartbeats(state, Date.now()).length, 0);
});

test("unread inbox wakes a seat with heartbeatMinutes", () => {
  const state = migrateState(emptyState());
  const product = state.seats.find((s) => s.id === "product");
  product.heartbeatMinutes = 15;
  withInbox(state);
  const due = tickHeartbeats(state, Date.parse("2026-09-11T12:01:00Z"));
  assert.equal(due.length, 1);
  assert.equal(due[0].seatId, "product");
  assert.equal(due[0].coalesced, false);
  assert.match(due[0].prompt, /Do not deploy/);
});

test("heartbeat coalesces with a wake in the same minute", () => {
  const state = migrateState(emptyState());
  const product = state.seats.find((s) => s.id === "product");
  product.heartbeatMinutes = 15;
  withInbox(state);
  state.bus[0].time = "2026-09-11T12:00:10.000Z";
  const due = tickHeartbeats(state, Date.parse("2026-09-11T12:00:30Z"));
  assert.equal(due.length, 1);
  assert.equal(due[0].coalesced, true);
});

test("heartbeat skips paused and over-budget seats", () => {
  const state = migrateState(emptyState());
  const product = state.seats.find((s) => s.id === "product");
  product.heartbeatMinutes = 15;
  withInbox(state);
  pauseSeat(state, "product");
  assert.equal(tickHeartbeats(state, Date.now()).length, 0);
  product.status = "idle";
  product.pauseReason = undefined;
  product.tokenBudget = 10;
  product.spent = 10;
  applyBudgetSideEffects(product);
  assert.equal(heartbeatSkipReason(state, product), "paused");
  assert.equal(tickHeartbeats(state, Date.now()).length, 0);
});

test("deploy-tool seats stay event-driven", () => {
  const state = migrateState(emptyState());
  const devops = state.seats.find((s) => s.id === "devops");
  devops.heartbeatMinutes = 5;
  withInbox(state, "devops");
  assert.equal(heartbeatSkipReason(state, devops), "deploy seat");
  assert.equal(tickHeartbeats(state, Date.now()).length, 0);
});

test("patch heartbeatMinutes 0 disables in one click", () => {
  const state = migrateState(emptyState());
  const product = state.seats.find((s) => s.id === "product");
  product.heartbeatMinutes = 15;
  withInbox(state);
  product.heartbeatMinutes = 0;
  assert.equal(tickHeartbeats(state, Date.now()).length, 0);
});

test("an @mention the seat never answered counts as heartbeat work", () => {
  const state = migrateState(emptyState());
  state.bus = [];
  state.tasks = [];
  state.inboxCursors = {};
  const product = state.seats.find((s) => s.id === "product");
  product.heartbeatMinutes = 5;
  product.heartbeatLastAt = null;
  const msg = (id, seatId, text, extra = {}) => ({ id, channel: "ship", who: seatId, kind: "human", seatId, text, time: "12:00", ...extra });
  state.messages = [msg("h1", "maya", "@product can you check the brief?")];
  assert.deepEqual(unansweredMentions(state, "product"), [{ channelId: "ship", messageId: "h1" }]);
  assert.match(heartbeatPrompt(product, state), /Unanswered mentions: 1 \(in #ship\)/);
  assert.equal(tickHeartbeats(state, Date.now()).map((d) => d.seatId).includes("product"), true);

  state.messages.push(msg("h2", "product", "Checked, looks good.", { kind: "bot" }));
  assert.deepEqual(unansweredMentions(state, "product"), []);
  state.messages.push(msg("h3", "maya", "@product one more"), msg("h4", "system", "@product x", { system: true }));
  state.roomSessions = { product: { ship: { sessionId: "s", cursor: "h3" } } };
  assert.deepEqual(unansweredMentions(state, "product"), []);
});
