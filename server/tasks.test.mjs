import assert from "node:assert/strict";
import test from "node:test";
import { claimTask, completeTask, createTask, listTasks } from "./tasks.mjs";
import { emptyState, migrateState } from "./seed.mjs";

test("seeded billing tasks exist and Eng.Build is blocked until Product completes", () => {
  const state = migrateState(emptyState());
  const brief = listTasks(state).find((t) => t.id === "task-product-brief");
  const impl = listTasks(state).find((t) => t.id === "task-eng-implement");
  assert.ok(brief);
  assert.ok(impl);
  assert.deepEqual(impl.dependOn, ["task-product-brief"]);
  assert.throws(() => claimTask(state, "task-eng-implement", "build"), (err) => err.status === 409 && /blocked/.test(err.message));
  completeTask(state, "task-product-brief", "product");
  const claimed = claimTask(state, "task-eng-implement", "build");
  assert.equal(claimed.claimedBy, "build");
  assert.equal(claimed.status, "claimed");
});

test("two claim attempts: exactly one wins", () => {
  const state = migrateState(emptyState());
  completeTask(state, "task-product-brief", "product");
  const first = claimTask(state, "task-eng-implement", "build");
  assert.equal(first.claimedBy, "build");
  assert.throws(() => claimTask(state, "task-eng-implement", "review"), (err) => err.status === 409 && /already claimed/.test(err.message));
  assert.equal(listTasks(state).find((t) => t.id === "task-eng-implement").claimedBy, "build");
});

test("createTask records depend_on alias", () => {
  const state = migrateState(emptyState());
  const t = createTask(state, { title: "QA sign", projectId: "billing", depend_on: "task-eng-implement" });
  assert.deepEqual(t.dependOn, ["task-eng-implement"]);
});
