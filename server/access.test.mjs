import assert from "node:assert/strict";
import test from "node:test";
import { createAccessRequest, listAccessRequests } from "./access.mjs";
import { emptyState, migrateState } from "./seed.mjs";

test("createAccessRequest persists name email company and upserts the same email", () => {
  const state = migrateState(emptyState());
  assert.deepEqual(state.accessRequests, []);
  const first = createAccessRequest(state, {
    name: "Ada",
    email: "ada@example.com",
    company: "Helix",
    role: "Eng",
    size: "11-50",
    replace: "Slack + plugins",
    note: "Need the room",
  });
  assert.equal(first.updated, false);
  assert.ok(first.id.startsWith("access-"));
  assert.equal(first.email, "ada@example.com");
  assert.equal(listAccessRequests(state).length, 1);

  const again = createAccessRequest(state, {
    name: "Ada Lovelace",
    email: "Ada@example.com",
    company: "Helix Labs",
    note: "Updated",
  });
  assert.equal(again.updated, true);
  assert.equal(again.id, first.id);
  assert.equal(listAccessRequests(state).length, 1);
  assert.equal(listAccessRequests(state)[0].name, "Ada Lovelace");
  assert.equal(listAccessRequests(state)[0].company, "Helix Labs");
  assert.equal(listAccessRequests(state)[0].note, "Updated");
});

test("createAccessRequest rejects a missing company", () => {
  const state = migrateState(emptyState());
  assert.throws(() => createAccessRequest(state, { name: "Ada", email: "ada@example.com" }), (err) => err.status === 400);
});
