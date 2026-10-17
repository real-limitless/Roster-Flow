import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBudgetSideEffects,
  applyTurnUsage,
  budgetRemaining,
  budgetWarn,
  currentBudgetPeriod,
  listUsage,
  meterChildSession,
  meterWake,
  nextUtcMidnight,
  roomSpentToday,
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

test("applyTurnUsage replaces the wake estimate with OpenCode's tokens and moves spend by the difference", () => {
  const state = migrateState(emptyState());
  const seat = state.seats.find((s) => s.id === "build");
  seat.spent = 0;
  seat.tokenBudget = 0;
  meterWake(state, { seatId: "build", runId: "run-real", inputTokens: 500, outputTokens: 200, channelId: "ship", threadId: "msg-1" });
  assert.equal(seat.spent, 700);
  const row = state.usage.find((r) => r.runId === "run-real");
  assert.equal(row.channelId, "ship");
  assert.equal(row.threadId, "msg-1");
  const usage = { input: 1200, output: 300, reasoning: 50, cacheRead: 4000, cacheWrite: 10, cost: 0.0123, messages: 2 };
  const out = applyTurnUsage(state, { seatId: "build", runId: "run-real", usage });
  assert.equal(out.row.tokens, 1550);
  assert.equal(out.row.cacheReadTokens, 4000);
  assert.equal(out.row.usdEstimate, 0.0123);
  assert.equal(out.row.metered, "opencode");
  assert.equal(seat.spent, 1550);
  applyTurnUsage(state, { seatId: "build", runId: "run-real", usage: { ...usage, output: 400 } });
  assert.equal(seat.spent, 1650);
  assert.equal(applyTurnUsage(state, { seatId: "build", runId: "run-missing", usage }), null);
  const csv = usageCsv(state.usage.filter((r) => r.runId === "run-real"));
  const [header, line] = csv.trim().split("\n");
  assert.ok(header.split(",").includes("channelId"));
  assert.equal(line.split(",")[header.split(",").indexOf("channelId")], "ship");
});

test("roomSpentToday sums the room's usage rows for the current UTC day", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const state = {
    usage: [
      { channelId: "ship", tokens: 100, time: "2026-10-16T01:00:00.000Z" },
      { channelId: "ship", tokens: 50, time: "2026-10-16T23:00:00.000Z" },
      { channelId: "ship", tokens: 999, time: "2026-10-15T23:59:00.000Z" },
      { channelId: "general", tokens: 7, time: "2026-10-16T02:00:00.000Z" },
    ],
  };
  assert.equal(roomSpentToday(state, "ship", now), 150);
  assert.equal(nextUtcMidnight(now), "2026-10-17T00:00:00.000Z");
});

test("meterChildSession books a subagent session against the seat it ran as, once per child", () => {
  const state = migrateState(emptyState());
  const build = state.seats.find((s) => s.id === "build");
  build.spent = 0;
  build.tokenBudget = 0;
  const usage = { input: 800, output: 150, reasoning: 50, cacheRead: 0, cacheWrite: 0, cost: 0.002, messages: 1 };
  const out = meterChildSession(state, { seatId: "build", runId: "run-p:ses_child", usage, channelId: "team-eng", threadId: "msg-9", parentSeatId: "eng-supervisor" });
  assert.equal(out.row.source, "task");
  assert.equal(out.row.tokens, 1000);
  assert.equal(out.row.parentSeatId, "eng-supervisor");
  assert.equal(out.row.channelId, "team-eng");
  assert.equal(out.row.threadId, "msg-9");
  assert.equal(build.spent, 1000);
  meterChildSession(state, { seatId: "build", runId: "run-p:ses_child", usage: { ...usage, output: 350 } });
  assert.equal(state.usage.filter((r) => r.runId === "run-p:ses_child").length, 1);
  assert.equal(build.spent, 1200);
  assert.equal(meterChildSession(state, { seatId: "build", runId: null, usage }), null);
  assert.equal(meterChildSession(state, { seatId: "you", runId: "run-p:ses_h", usage }), null);
});
