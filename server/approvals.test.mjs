import assert from "node:assert/strict";
import test from "node:test";
import { applyPlan, planFromTemplates } from "./architect.mjs";
import { createApproval, recordApproval, resolveApproval } from "./approvals.mjs";
import { deps, wakeSeat } from "./bus.mjs";
import { emptyState, migrateState } from "./seed.mjs";
import { killRun, pauseSeat, pauseTeam, resumeSeat } from "./seats.mjs";
import { mutate } from "./store.mjs";

test("pause blocks wake and resume restores it", async () => {
  const prompts = [];
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async ({ title }) => ({ id: `ses_${title}` });
  deps.promptSession = async (id, body) => {
    prompts.push(body.agent);
  };
  mutate((s) => {
    Object.assign(s, migrateState(emptyState()));
    if (s.sessions) delete s.sessions.build;
    pauseSeat(s, "build");
  });
  try {
    const blocked = await wakeSeat("build", "do not run", { from: "product" });
    assert.equal(blocked.paused, true);
    assert.equal(prompts.length, 0);
    mutate((s) => {
      resumeSeat(s, "build");
    });
    const woke = await wakeSeat("build", "now run", { from: "product" });
    assert.ok(woke.sessionId);
    assert.equal(prompts.length, 1);
  } finally {
    Object.assign(deps, prev);
    mutate((s) => {
      const b = (s.seats || []).find((x) => x.id === "build");
      if (b) b.status = "idle";
    });
  }
});

test("killed runId blocks wake", async () => {
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.promptSession = async () => {};
  mutate((s) => {
    Object.assign(s, migrateState(emptyState()));
    killRun(s, "run-dead");
  });
  try {
    const blocked = await wakeSeat("build", "killed", { from: "product", runId: "run-dead" });
    assert.equal(blocked.paused, true);
    assert.equal(blocked.reason, "run");
  } finally {
    Object.assign(deps, prev);
    mutate((s) => {
      s.pausedRunIds = (s.pausedRunIds || []).filter((id) => id !== "run-dead");
    });
  }
});

test("pending hire does not mutate seats until approve", () => {
  const state = migrateState(emptyState());
  const pending = createApproval(
    state,
    { kind: "hire", payload: { name: "Temp.Bot", job: "Temp worker.", team: "eng" } },
    "you",
  );
  assert.equal(pending.status, "pending");
  assert.ok(!state.seats.some((s) => s.id === "temp-bot"));
  const { seat } = resolveApproval(state, pending.id, { status: "approved", actor: "you" });
  assert.equal(seat.id, "temp-bot");
  assert.ok(state.seats.some((s) => s.id === "temp-bot"));
  assert.equal(state.approvals.find((a) => a.id === pending.id).status, "approved");
});

test("apply-from-pending strategy vs Chart Apply already-approved path", () => {
  const state = migrateState(emptyState());
  const plan = planFromTemplates("We’re starting a mobile app. Create a project and staff a team around it.", state);
  state.architectPlans = [plan, ...(state.architectPlans || [])];
  const pending = createApproval(state, { kind: "strategy", planId: plan.id }, "you");
  assert.ok(!state.projects.some((p) => p.id === "mobile"));
  resolveApproval(state, pending.id, { status: "approved" });
  assert.ok(state.projects.some((p) => p.id === "mobile"));

  const next = migrateState(emptyState());
  const immediate = planFromTemplates("We’re starting a mobile app. Create a project and staff a team around it.", next);
  recordApproval(next, { kind: "strategy", status: "approved", actor: "you", planId: immediate.id });
  applyPlan(next, immediate);
  assert.ok(next.projects.some((p) => p.id === "mobile"));
  assert.ok(next.approvals.some((a) => a.kind === "strategy" && a.status === "approved"));
});

test("pauseTeam pauses bot seats only", () => {
  const state = migrateState(emptyState());
  const { seats } = pauseTeam(state, "eng");
  assert.ok(seats.every((s) => s.kind === "bot" && s.status === "paused"));
  assert.equal(state.seats.find((s) => s.id === "jules")?.status, "idle");
});
