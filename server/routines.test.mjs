import assert from "node:assert/strict";
import test from "node:test";
import { createRoutine, runRoutineNow, tickRoutines } from "./routines.mjs";
import { pauseSeat } from "./seats.mjs";
import { emptyState, migrateState } from "./seed.mjs";

test("tick coalesces with a mention in the same minute", () => {
  const state = migrateState(emptyState());
  const rec = createRoutine(state, {
    title: "Standup ping",
    seatId: "product",
    intervalMinutes: 1,
    prompt: "Post standup.",
  });
  const now = Date.parse("2026-09-10T12:00:30Z");
  state.bus = [
    {
      id: "bus-mention",
      from: "you",
      to: "product",
      kind: "send_message",
      text: "@product hello",
      time: "2026-09-10T12:00:10.000Z",
    },
  ];
  const due = tickRoutines(state, now);
  assert.equal(due.length, 1);
  assert.equal(due[0].coalesced, true);
  assert.equal(due[0].id, rec.id);
  assert.equal(state.routineRuns[0].coalesced, true);
});

test("tick skips when the seat is paused", () => {
  const state = migrateState(emptyState());
  createRoutine(state, { title: "Paused ping", seatId: "product", intervalMinutes: 1, prompt: "Ping." });
  pauseSeat(state, "product");
  const due = tickRoutines(state, Date.now());
  assert.equal(due.length, 0);
  assert.equal(state.routines[0].lastError, "paused");
});

test("create and run reject deploy when the seat denies deploy", () => {
  const state = migrateState(emptyState());
  assert.throws(
    () =>
      createRoutine(state, {
        title: "Ship prod",
        seatId: "build",
        prompt: "Deploy to production.",
        impliesDeploy: true,
      }),
    (err) => err.status === 400,
  );
  const rec = createRoutine(state, {
    title: "Nightly brief",
    seatId: "product",
    intervalMinutes: 30,
    prompt: "Write the brief.",
  });
  rec.impliesDeploy = true;
  rec.prompt = "Deploy the train.";
  const product = state.seats.find((s) => s.id === "product");
  product.deny = ["deploy"];
  assert.throws(() => runRoutineNow(state, rec.id), (err) => err.status === 400);
});

test("manual run appends a routineRuns row", () => {
  const state = migrateState(emptyState());
  const rec = createRoutine(state, {
    title: "Manual ping",
    seatId: "product",
    intervalMinutes: 60,
    prompt: "Check the train.",
  });
  const out = runRoutineNow(state, rec.id, Date.parse("2026-09-10T13:00:00Z"));
  assert.equal(out.seatId, "product");
  assert.equal(state.routineRuns.length, 1);
  assert.equal(state.routines[0].lastRunAt, "2026-09-10T13:00:00.000Z");
});
