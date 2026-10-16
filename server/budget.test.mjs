import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBudgetSideEffects,
  budgetRemaining,
  budgetWarn,
  currentBudgetPeriod,
  listUsage,
  meterWake,
  publicUsageRow,
  rolloverSeatBudget,
  seatOverBudget,
  summarizeUsage,
  usageCsv,
} from "./budget.mjs";
import { deps, wakeSeat } from "./bus.mjs";
import { hireSeat, resumeSeat, wakeBlocked } from "./seats.mjs";
import { emptyState, migrateState } from "./seed.mjs";
import { mutate } from "./store.mjs";

test("hire persists tokenBudget and spent survives migrate", () => {
  const state = migrateState(emptyState());
  const seat = hireSeat(state, { name: "Meter.Bot", team: "eng", tokenBudget: 5000, job: "Metered." });
  assert.equal(seat.tokenBudget, 5000);
  assert.equal(seat.spent, 0);
  const again = migrateState(state);
  const live = again.seats.find((s) => s.id === "meter-bot");
  assert.equal(live.tokenBudget, 5000);
  assert.equal(live.spent, 0);
});

test("meterWake pauses at cap via existing paused status", () => {
  const state = migrateState(emptyState());
  const build = state.seats.find((s) => s.id === "build");
  build.tokenBudget = 10;
  build.spent = 0;
  const out = meterWake(state, { seatId: "build", inputTokens: 8, outputTokens: 4, model: "xai/grok-4", runId: "ship-train" });
  assert.equal(out.over, true);
  assert.equal(build.status, "paused");
  assert.equal(build.pauseReason, "budget");
  assert.equal(build.spent, 12);
  assert.equal(budgetRemaining(build), 0);
  const blocked = wakeBlocked(state, build, { runId: "ship-train" });
  assert.equal(blocked.reason, "budget");
});

test("wakeSeat does not prompt when over tokenBudget", async () => {
  const prompts = [];
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async ({ title }) => ({ id: `ses_${title}` });
  deps.promptSession = async (id, body) => {
    prompts.push(body.agent);
  };
  mutate((s) => {
    Object.assign(s, migrateState(emptyState()));
    const build = s.seats.find((x) => x.id === "build");
    build.tokenBudget = 50;
    build.spent = 50;
    build.status = "idle";
    build.pauseReason = undefined;
    if (s.sessions) delete s.sessions.build;
  });
  try {
    const blocked = await wakeSeat("build", "do not run", { from: "product" });
    assert.equal(blocked.paused, true);
    assert.equal(blocked.reason, "budget");
    assert.equal(prompts.length, 0);
  } finally {
    Object.assign(deps, prev);
    mutate((s) => {
      const b = (s.seats || []).find((x) => x.id === "build");
      if (b) {
        b.status = "idle";
        b.spent = 0;
        b.tokenBudget = undefined;
        b.pauseReason = undefined;
      }
    });
  }
});

test("successful wake meters tokens then blocks the next wake at cap", async () => {
  const prompts = [];
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async ({ title }) => ({ id: `ses_${title}` });
  deps.promptSession = async (id, body) => {
    prompts.push(body.agent);
  };
  mutate((s) => {
    Object.assign(s, migrateState(emptyState()));
    const build = s.seats.find((x) => x.id === "build");
    build.tokenBudget = 20;
    build.spent = 0;
    build.status = "idle";
    build.pauseReason = undefined;
    s.usage = [];
    if (s.sessions) delete s.sessions.build;
  });
  try {
    const woke = await wakeSeat("build", "tiny", { from: "product", runId: "r1" });
    assert.ok(woke.sessionId);
    assert.equal(prompts.length, 1);
    const after = mutate((s) => {
      const b = s.seats.find((x) => x.id === "build");
      assert.ok(b.spent > 0);
      assert.ok((s.usage || []).some((u) => u.seatId === "build" && u.runId === "r1"));
    });
    const live = after.seats.find((s) => s.id === "build");
    if (!seatOverBudget(live)) {
      live.spent = live.tokenBudget;
      applyBudgetSideEffects(live);
    }
    const blocked = await wakeSeat("build", "second", { from: "product" });
    assert.equal(blocked.paused, true);
    assert.equal(blocked.reason, "budget");
    assert.equal(prompts.length, 1);
  } finally {
    Object.assign(deps, prev);
    mutate((s) => {
      const b = (s.seats || []).find((x) => x.id === "build");
      if (b) {
        b.status = "idle";
        b.spent = 0;
        b.tokenBudget = undefined;
        b.pauseReason = undefined;
      }
      s.usage = [];
    });
  }
});

test("resume refuses until tokenBudget is raised", () => {
  const state = migrateState(emptyState());
  const build = state.seats.find((s) => s.id === "build");
  build.tokenBudget = 10;
  build.spent = 10;
  applyBudgetSideEffects(build);
  assert.equal(build.pauseReason, "budget");
  assert.throws(() => resumeSeat(state, "build"), /raise tokenBudget/);
  build.tokenBudget = 1000;
  applyBudgetSideEffects(build);
  assert.equal(build.status, "idle");
  const resumed = resumeSeat(state, "build");
  assert.equal(resumed.status, "idle");
});

test("month rollover resets spent and lifts a budget pause", () => {
  const seat = {
    id: "build",
    kind: "bot",
    tokenBudget: 10,
    spent: 10,
    status: "paused",
    pauseReason: "budget",
    budgetPeriod: "2020-01",
  };
  rolloverSeatBudget(seat, new Date("2026-09-11T00:00:00Z"));
  assert.equal(seat.spent, 0);
  assert.equal(seat.status, "idle");
  assert.equal(seat.budgetPeriod, currentBudgetPeriod(new Date("2026-09-11T00:00:00Z")));
});

test("budgetWarn at 80 percent and usage never includes keys", () => {
  const seat = { kind: "bot", tokenBudget: 100, spent: 80 };
  assert.equal(budgetWarn(seat), true);
  assert.equal(seatOverBudget(seat), false);
  const row = publicUsageRow({ seatId: "build", apiKey: "sk-secret", token: "tok", tokens: 3 });
  assert.equal(row.apiKey, undefined);
  assert.equal(row.token, undefined);
  assert.equal(row.tokens, 3);
  const state = { usage: [{ seatId: "build", projectId: "billing", teamId: "eng", tokens: 1, apiKey: "nope" }] };
  const billing = listUsage(state, { projectId: "billing" });
  assert.equal(billing.length, 1);
  assert.equal(listUsage(state, { projectId: "other" }).length, 0);
  assert.ok(!("apiKey" in billing[0]));
});

test("usage csv omits keys and summarizeUsage totals tokens", () => {
  const rows = [
    { time: "t", seatId: "channel", tokens: 10, usdEstimate: 0.01, hours: 0.1, apiKey: "nope" },
    { time: "t2", seatId: "build", projectId: "billing", teamId: "eng", tokens: 20, usdEstimate: 0.02, hours: 0.2 },
  ];
  const csv = usageCsv(rows);
  assert.match(csv, /seatId/);
  assert.doesNotMatch(csv, /sk-secret|apiKey/);
  const sum = summarizeUsage(rows);
  assert.equal(sum.wakes, 2);
  assert.equal(sum.tokens, 30);
});
