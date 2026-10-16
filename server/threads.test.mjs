import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { emptyState } from "./seed.mjs";
import { PAIR_LIMIT, cycleSafe, noteBotWake, planBotMentions, resetThreads, startThread, threadStats } from "./threads.mjs";

beforeEach(() => resetThreads());

function ship(state, patch = {}) {
  Object.assign(state.channels.find((c) => c.id === "ship"), patch);
  return state;
}

test("startThread opens hop 0 with the room's hop limit", () => {
  const state = ship(emptyState(), { limits: { maxHops: 2 } });
  const t = startThread("msg-1", "you", state.channels.find((c) => c.id === "ship"));
  assert.deepEqual(t, { threadId: "msg-1", rootMessageId: "msg-1", hop: 0, from: "you", maxHops: 2 });
  assert.match(startThread(null, "you", null).threadId, /^thr-/);
});

test("a bot @mention of a room member wakes it one hop further", () => {
  const state = emptyState();
  const thread = startThread("root-a", "you", null);
  const plan = planBotMentions({ state, channelId: "ship", fromSeatId: "product", text: "@build can you look?", thread });
  assert.equal(plan.wakes.length, 1);
  assert.equal(plan.wakes[0].to, "build");
  assert.equal(plan.wakes[0].reason, "mention-seat");
  assert.deepEqual(plan.wakes[0].meta.thread, { threadId: "root-a", rootMessageId: "root-a", hop: 1, from: "product", maxHops: 4 });
  assert.deepEqual(plan.stops, []);
});

test("bots cannot wake themselves or use @channel and @here", () => {
  const state = emptyState();
  const thread = startThread("root-b", "you", null);
  const plan = planBotMentions({ state, channelId: "ship", fromSeatId: "product", text: "@product @channel @here hi", thread });
  assert.deepEqual(plan.wakes, []);
  assert.equal(plan.ignored.length, 2);
});

test("humans and non-members are notified, not woken", () => {
  const state = emptyState();
  const thread = startThread("root-c", "you", null);
  const plan = planBotMentions({ state, channelId: "ship", fromSeatId: "product", text: "@maya @scout ping", thread });
  assert.deepEqual(plan.wakes, []);
  assert.deepEqual(plan.notify.sort(), ["maya", "scout"]);
  assert.deepEqual(plan.stops, ["Scout is not in this room, so they were notified instead of woken."]);
});

test("past maxHops the mention notifies and posts one stop line", () => {
  const state = ship(emptyState(), { limits: { maxHops: 2 } });
  const thread = { threadId: "root-d", hop: 2, from: "build", maxHops: 2 };
  const plan = planBotMentions({ state, channelId: "ship", fromSeatId: "product", text: "@build @review again", thread });
  assert.deepEqual(plan.wakes, []);
  assert.deepEqual(plan.notify, ["build", "review"]);
  assert.deepEqual(plan.stops, ["Stopped: thread reached 2 hops."]);
});

test("the thread bot-wake budget caps wakes across the whole thread", () => {
  const state = ship(emptyState(), { limits: { maxBotWakesPerThread: 2 } });
  noteBotWake("root-e", "product", "review");
  assert.equal(threadStats("root-e").botWakes, 1);
  const thread = { threadId: "root-e", hop: 1 };
  const plan = planBotMentions({ state, channelId: "ship", fromSeatId: "review", text: "@build @qa @devops", thread });
  assert.deepEqual(plan.wakes.map((w) => w.to), ["build"]);
  assert.deepEqual(plan.notify, ["qa", "devops"]);
  assert.deepEqual(plan.stops, ["Stopped: thread reached 2 bot wakes."]);
});

test("two seats waking each other stop after PAIR_LIMIT wakes", () => {
  const state = ship(emptyState(), { limits: { maxHops: 100, maxBotWakesPerThread: 100 } });
  for (let i = 0; i < PAIR_LIMIT; i++) noteBotWake("root-f", i % 2 ? "build" : "product", i % 2 ? "product" : "build");
  assert.equal(cycleSafe("root-f", "product", "build"), false);
  assert.equal(cycleSafe("root-f", "product", "review"), true);
  assert.equal(cycleSafe("root-f", "build", "build"), false);
  const plan = planBotMentions({ state, channelId: "ship", fromSeatId: "product", text: "@build", thread: { threadId: "root-f", hop: 3 } });
  assert.deepEqual(plan.wakes, []);
  assert.deepEqual(plan.stops, ["Stopped: Product and Eng.Build keep waking each other in this thread."]);
});
