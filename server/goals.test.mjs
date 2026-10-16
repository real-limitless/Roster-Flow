import assert from "node:assert/strict";
import test from "node:test";
import { ancestryForSeat, goalPackLines } from "./goals.mjs";
import { deps, wakeSeat } from "./bus.mjs";
import { architectPrompt } from "./architect.mjs";
import { emptyState, migrateState } from "./seed.mjs";
import { mutate } from "./store.mjs";

test("seeded billing goal is linked and packed for Eng.Build", () => {
  const state = migrateState(emptyState());
  assert.ok(state.goals.some((g) => g.id === "ship-train"));
  assert.ok(state.projects.find((p) => p.id === "billing")?.goalIds.includes("ship-train"));
  const build = state.seats.find((s) => s.id === "build");
  const pack = ancestryForSeat(state, build);
  assert.equal(pack.primary?.id, "ship-train");
  const text = goalPackLines(state, { seat: build, runId: "run-9" }).join("\n");
  assert.match(text, /Ship the billing train/);
  assert.match(text, /Webhook idempotency/);
  assert.match(text, /Acceptance over opinions/);
  assert.match(text, /Run: run-9/);
});

test("architect prompt includes the same goal pack", () => {
  const state = migrateState(emptyState());
  const prompt = architectPrompt("staff mobile", [], state);
  assert.match(prompt, /Ship the billing train/);
  assert.match(prompt, /Constitution:/);
});

test("wakeSeat promptBody contains seeded billing goal text", async () => {
  const prompts = [];
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async ({ title }) => ({ id: `ses_${title}` });
  deps.promptSession = async (id, body) => {
    prompts.push({ id, agent: body.agent, text: body.parts?.[0]?.text });
  };
  mutate((s) => {
    const next = migrateState(emptyState());
    Object.assign(s, next);
    if (s.sessions) delete s.sessions.build;
  });
  try {
    const result = await wakeSeat("build", "ship the webhook", { from: "product", kind: "handoff", runId: "run-goal" });
    assert.ok(result.sessionId);
    assert.match(prompts[0].text, /Ship the billing train/);
    assert.match(prompts[0].text, /Webhook idempotency/);
    assert.match(prompts[0].text, /ship the webhook/);
    assert.match(prompts[0].text, /Run: run-goal/);
  } finally {
    Object.assign(deps, prev);
  }
});
