import assert from "node:assert/strict";
import test from "node:test";
import { listInbox, markInboxRead } from "./inbox.mjs";
import { emptyState, migrateState } from "./seed.mjs";

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
