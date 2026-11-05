import assert from "node:assert/strict";
import test from "node:test";
import { listInbox, markInboxRead } from "./inbox.mjs";
import { emptyState, migrateState } from "./seed.mjs";
import { claimTask, completeTask, createTask } from "./tasks.mjs";

function withMail(state, rows) {
  state.bus = rows.map((row, i) => ({
    id: `bus-${i + 1}`,
    from: row.from || "product",
    to: row.to,
    kind: row.kind || "send_message",
    text: row.text || "hello",
    time: new Date().toISOString(),
  }));
  return state;
}

test("build sees mail to build, team:eng (supervisor), and #ship", () => {
  const state = withMail(migrateState(emptyState()), [
    { to: "build", text: "implement webhook" },
    { to: "team:eng", text: "route this" },
    { to: "channel:ship", text: "train update" },
    { to: "#ship", text: "hash ship" },
    { to: "qa", text: "not yours" },
  ]);
  const build = listInbox(state, "build");
  const sup = listInbox(state, "eng-supervisor");
  assert.ok(build.items.some((i) => i.to === "build"));
  assert.ok(build.items.some((i) => i.to === "channel:ship"));
  assert.ok(build.items.some((i) => i.to === "#ship"));
  assert.ok(!build.items.some((i) => i.to === "team:eng"));
  assert.ok(sup.items.some((i) => i.to === "team:eng"));
  assert.equal(build.unread, 3);
});

test("mark-read drops unread after the cursor", () => {
  const state = withMail(migrateState(emptyState()), [
    { to: "build", text: "one" },
    { to: "build", text: "two" },
    { to: "channel:ship", text: "room" },
  ]);
  const before = listInbox(state, "build");
  assert.ok(before.unread >= 2);
  const last = before.items[before.items.length - 1].id;
  const after = markInboxRead(state, "build", last);
  assert.equal(after.unread, 0);
  assert.equal(after.cursor, last);
});

test("ask_human to manager lands in that inbox", () => {
  const state = withMail(migrateState(emptyState()), [
    { from: "product", to: "maya", kind: "ask_human", text: "approve brief?" },
  ]);
  const maya = listInbox(state, "maya");
  assert.equal(maya.items.length, 1);
  assert.equal(maya.items[0].kind, "ask_human");
});

test("ask_human parks on the sender's manager even when addressed elsewhere", () => {
  const state = withMail(migrateState(emptyState()), [
    { from: "product", to: "qa", kind: "ask_human", text: "ship this?" },
  ]);
  const maya = listInbox(state, "maya");
  const build = listInbox(state, "build");
  assert.equal(maya.items.filter((i) => i.kind === "ask_human").length, 1);
  assert.equal(build.items.length, 0);
  assert.equal(listInbox(state, "qa").items.length, 1);
});

test("channel mail follows room membership, including via team", () => {
  const state = withMail(migrateState(emptyState()), [
    { to: "channel:eng-agents", text: "eng room" },
    { to: "channel:incidents", text: "incident" },
    { to: "#general", text: "lobby" },
  ]);
  const sup = listInbox(state, "eng-supervisor");
  const product = listInbox(state, "product");
  const docs = listInbox(state, "docs");
  const qa = listInbox(state, "qa");
  assert.ok(sup.items.some((i) => i.to === "channel:eng-agents"));
  assert.ok(!product.items.some((i) => i.to === "channel:eng-agents"));
  assert.ok(docs.items.some((i) => i.to === "channel:incidents"));
  assert.ok(!qa.items.some((i) => i.to === "channel:incidents"));
  assert.ok(!qa.items.some((i) => i.to === "#general"));
  assert.ok(listInbox(state, "you").items.some((i) => i.to === "#general"));
});

test("a later read leaves earlier ids marked read and keeps mail after the cursor", () => {
  const state = withMail(migrateState(emptyState()), [
    { to: "build", text: "one" },
    { to: "build", text: "two" },
    { to: "qa", text: "side" },
  ]);
  const first = listInbox(state, "build");
  const cursor = first.items.find((i) => i.text === "one").id;
  markInboxRead(state, "build", cursor);
  const again = listInbox(state, "build");
  assert.equal(again.items.find((i) => i.text === "one").unread, false);
  assert.equal(again.items.find((i) => i.text === "two").unread, true);
  assert.equal(again.unread, 1);
  assert.equal(again.cursor, cursor);
  assert.equal(listInbox(state, "qa").cursor, null);
  assert.equal(listInbox(state, "qa").items.find((i) => i.text === "side").unread, true);
});

test("inbox lists open assigned and claimed tasks and drops done ones", () => {
  const state = migrateState(emptyState());
  state.bus = [];
  const build = listInbox(state, "build");
  assert.ok(build.tasks.some((t) => t.id === "task-eng-implement" && t.owed === "assigned" && t.status === "pending"));
  assert.ok(!build.tasks.some((t) => t.id === "task-product-brief"));
  const product = listInbox(state, "product");
  assert.ok(product.tasks.some((t) => t.id === "task-product-brief" && t.owed === "assigned"));
  assert.equal(product.unread, 0);

  completeTask(state, "task-product-brief", "product");
  assert.ok(!listInbox(state, "product").tasks.some((t) => t.id === "task-product-brief"));

  claimTask(state, "task-eng-implement", "build");
  const held = listInbox(state, "build").tasks.find((t) => t.id === "task-eng-implement");
  assert.equal(held.owed, "claimed");
  assert.equal(held.claimedBy, "build");
  assert.equal(state.tasks.find((t) => t.id === "task-eng-implement").owed, undefined);

  completeTask(state, "task-eng-implement", "build");
  assert.ok(!listInbox(state, "build").tasks.some((t) => t.id === "task-eng-implement"));
});

test("a claim lock is owed by the claimant and still assigned to the owner", () => {
  const state = migrateState(emptyState());
  state.bus = [];
  state.tasks = [];
  createTask(state, { id: "task-shared", title: "Shared", ownerSeatId: "product" });
  claimTask(state, "task-shared", "build");
  assert.equal(listInbox(state, "build").tasks.find((t) => t.id === "task-shared").owed, "claimed");
  assert.equal(listInbox(state, "product").tasks.find((t) => t.id === "task-shared").owed, "assigned");
  assert.equal(listInbox(state, "qa").tasks.length, 0);
});

test("unknown seat has no inbox", () => {
  assert.equal(listInbox(migrateState(emptyState()), "nope"), null);
  assert.equal(markInboxRead(migrateState(emptyState()), "nope", "bus-1"), null);
});
