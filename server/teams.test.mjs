import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "./seed.mjs";
import { attachSeatToTeam, createStaffedTeam, enrichTeam, teamWakeTarget } from "./teams.mjs";

test("enrichTeam reports seat count and models in use", () => {
  const state = emptyState();
  const eng = state.teams.find((t) => t.id === "eng");
  const out = enrichTeam(eng, state.seats);
  assert.ok(out.seatCount >= 4);
  assert.ok(out.models.includes("anthropic/claude-sonnet"));
  assert.equal(out.supervisorSeatId, "eng-supervisor");
  assert.equal(out.genericSeatId, "eng-generic");
});

test("createStaffedTeam adds Supervisor and Generic", () => {
  const state = emptyState();
  const { team, seats } = createStaffedTeam(state, { name: "platform", defaultModel: "openai/gpt-5" });
  assert.equal(team.id, "platform");
  assert.equal(seats.length, 2);
  assert.equal(seats[0].seatType, "supervisor");
  assert.equal(seats[1].seatType, "generic");
  assert.equal(team.seatCount, 2);
  assert.equal(teamWakeTarget("team:platform", state.teams), "platform-supervisor");
});

test("createStaffedTeam stores charter and specialists", () => {
  const state = emptyState();
  const { team, seats } = createStaffedTeam(state, {
    name: "platform",
    role: "Platform",
    description: "Shared infra",
    job: "Keep CI green",
    rules: "No prod deploys",
    defaultModel: "openai/gpt-5",
    fallbackModel: "xai/grok-4",
    modelStrategy: "round_robin",
    specialists: [{ name: "Platform.API", job: "Own the API", persona: "API implementer." }],
  });
  assert.equal(team.role, "Platform");
  assert.equal(team.job, "Keep CI green");
  assert.equal(team.modelStrategy, "round_robin");
  assert.ok(seats.some((s) => s.id === "platform-api"));
  assert.match(seats[0].instructions, /Team charter/);
});

test("attachSeatToTeam keeps seatIds unique", () => {
  const state = emptyState();
  attachSeatToTeam(state, "eng", "build");
  const before = state.teams.find((t) => t.id === "eng").seatIds.filter((id) => id === "build").length;
  attachSeatToTeam(state, "eng", "build");
  const after = state.teams.find((t) => t.id === "eng").seatIds.filter((id) => id === "build").length;
  assert.equal(before, 1);
  assert.equal(after, 1);
});
