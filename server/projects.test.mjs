import assert from "node:assert/strict";
import test from "node:test";
import { emptyState, migrateState } from "./seed.mjs";
import { createProject } from "./projects.mjs";
import { fireSeat } from "./seats.mjs";
import { applyPlan, chatArchitect, parsePlanJson, planFromTemplates } from "./architect.mjs";

test("migrateState attaches billing project and Architect", () => {
  const stale = emptyState();
  delete stale.projects;
  delete stale.organizations;
  stale.architectPlans = undefined;
  stale.seats = stale.seats.filter((s) => s.id !== "architect");
  for (const seat of stale.seats) delete seat.projectId;
  for (const team of stale.teams) delete team.projectId;
  const next = migrateState(stale);
  assert.ok(next.projects.some((p) => p.id === "billing"));
  assert.equal(next.seats.find((s) => s.id === "product")?.projectId, "billing");
  assert.equal(next.teams.find((t) => t.id === "eng")?.projectId, "billing");
  assert.ok(next.seats.some((s) => s.id === "architect" && s.system));
  assert.equal(next.projects.find((p) => p.id === "billing")?.pmSeatId, "product");
});

test("createProject plus fireSeat reparents orphans", () => {
  const state = emptyState();
  const project = createProject(state, { name: "atlas", brief: "Second product" });
  assert.equal(project.id, "atlas");
  assert.equal(state.projects.filter((p) => p.id === "atlas").length, 1);
  const supervisor = state.seats.find((s) => s.id === "eng-supervisor");
  assert.equal(supervisor.reportsTo, "jules");
  const result = fireSeat(state, "jules");
  assert.equal(result.reparentedTo, "maya");
  assert.ok(!state.seats.some((s) => s.id === "jules"));
  assert.equal(state.seats.find((s) => s.id === "eng-supervisor")?.reportsTo, "maya");
  assert.ok(!state.teams.find((t) => t.id === "eng").seatIds.includes("jules"));
});

test("offline mobile plan creates project PM and team", () => {
  const state = emptyState();
  const plan = planFromTemplates("We’re starting a mobile app. Create a project and staff a team around it.", state);
  assert.ok(plan.ops.some((o) => o.op === "create_project"));
  assert.ok(plan.ops.some((o) => o.op === "hire" && o.asPm));
  assert.ok(plan.ops.some((o) => o.op === "create_team"));
  const { created } = applyPlan(state, plan);
  assert.ok(state.projects.some((p) => p.id === "mobile"));
  assert.ok(created.seats.some((s) => s.projectId === "mobile"));
  assert.ok(state.teams.some((t) => t.projectId === "mobile"));
  assert.ok(state.projects.find((p) => p.id === "mobile")?.pmSeatId);
});

test("offline layoff names Docs and Scout", () => {
  const state = emptyState();
  const plan = planFromTemplates("Who can we lay off if we pause Docs and Scout?", state);
  const fires = plan.ops.filter((o) => o.op === "fire").map((o) => o.seatId);
  assert.ok(fires.includes("docs"));
  assert.ok(fires.includes("scout"));
  applyPlan(state, plan);
  assert.ok(!state.seats.some((s) => s.id === "scout"));
  assert.ok(!state.seats.some((s) => s.id === "docs"));
});

test("chatArchitect template mode skips live wake", async () => {
  const prev = process.env.ROSTER_ARCHITECT_MODE;
  process.env.ROSTER_ARCHITECT_MODE = "template";
  try {
    const state = emptyState();
    let called = false;
    const out = await chatArchitect(state, { message: "We’re starting a mobile app. Create a project and staff a team around it." }, {
      wakeSeat: async () => {
        called = true;
        return { sessionId: "x" };
      },
      pullAssistant: async () => [{ text: "not json" }],
    });
    assert.equal(called, false);
    assert.equal(out.source, "template");
    assert.ok(out.plan.ops.some((o) => o.op === "create_project"));
  } finally {
    if (prev === undefined) delete process.env.ROSTER_ARCHITECT_MODE;
    else process.env.ROSTER_ARCHITECT_MODE = prev;
  }
});

test("parsePlanJson reads fenced object", () => {
  const plan = parsePlanJson('here\n```json\n{"summary":"x","ops":[{"op":"fire","seatId":"scout"}]}\n```');
  assert.equal(plan.summary, "x");
  assert.equal(plan.ops[0].seatId, "scout");
});
