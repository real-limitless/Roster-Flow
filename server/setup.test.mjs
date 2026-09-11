import assert from "node:assert/strict";
import test from "node:test";
import { addFirstUser } from "./auth.mjs";
import { applyOrgTemplate, completeSetup, markHarnessStep, markInstallSeen, publicState, setupStatus, startOver } from "./setup.mjs";
import { emptyOrgState, migrateState, pendingState, starterState } from "./seed.mjs";

test("migrate-as-complete when onboarding is missing", () => {
  const stale = starterState();
  delete stale.onboarding;
  const next = migrateState(stale);
  assert.equal(next.onboarding.complete, true);
  assert.equal(next.onboarding.template, "starter");
});

test("pending migrate does not inject the billing project", () => {
  const next = migrateState(pendingState());
  assert.equal(next.onboarding.complete, false);
  assert.ok(!next.projects.some((p) => p.id === "billing"));
  assert.equal(next.seats.length, 0);
});

test("empty org migrate does not inject billing", () => {
  const next = migrateState(emptyOrgState("Ada"));
  assert.equal(next.onboarding.template, "empty");
  assert.ok(!next.projects.some((p) => p.id === "billing"));
  assert.ok(next.seats.some((s) => s.id === "you" && s.name === "Ada"));
  assert.ok(next.seats.some((s) => s.id === "channel"));
  assert.ok(next.seats.some((s) => s.id === "architect"));
  assert.equal(next.teams.length, 0);
  assert.ok(next.channels.some((c) => c.id === "general"));
});

test("setupStatus walks install → first_user → login → harness → welcome", async () => {
  const state = pendingState();
  assert.equal(setupStatus(state).step, "install");
  markInstallSeen(state);
  assert.equal(setupStatus(state).step, "first_user");
  const user = await addFirstUser(state, { name: "Chen", email: "chen@example.com", password: "password1" });
  assert.equal(setupStatus(state).step, "login");
  assert.equal(setupStatus(state, { user }).step, "harness");
  markHarnessStep(state, { skipped: true });
  assert.equal(setupStatus(state, { user }).step, "welcome");
  assert.equal(state.onboarding.harnessSkipped, true);
});

test("completeSetup applies starter or empty and strips secrets from publicState", async () => {
  const starter = pendingState();
  await addFirstUser(starter, { name: "Chen", email: "chen@example.com", password: "password1" });
  markInstallSeen(starter);
  markHarnessStep(starter, { skipped: true });
  const staffed = completeSetup(starter, { template: "starter", ownerName: "Chen" });
  assert.equal(staffed.onboarding.complete, true);
  assert.equal(staffed.onboarding.template, "starter");
  assert.equal(staffed.seats.find((s) => s.id === "you")?.name, "Chen");
  assert.ok(staffed.projects.some((p) => p.id === "billing"));
  const pub = publicState(staffed);
  assert.equal(pub.users, undefined);
  assert.equal(pub.authSessions, undefined);
  assert.ok(pub.seats.some((s) => s.id === "channel"));

  const empty = pendingState();
  await addFirstUser(empty, { name: "Chen", email: "chen@example.com", password: "password1" });
  const bare = applyOrgTemplate(empty, "empty", "Chen");
  assert.equal(bare.onboarding.template, "empty");
  assert.ok(!bare.projects.some((p) => p.id === "billing"));
  assert.ok(bare.messages.some((m) => m.channel === "general"));
});

test("completeSetup is 409 after it already finished", async () => {
  const state = pendingState();
  await addFirstUser(state, { name: "Chen", email: "chen@example.com", password: "password1" });
  const done = completeSetup(state, { template: "empty", ownerName: "Chen" });
  assert.throws(() => completeSetup(done, { template: "starter", ownerName: "Chen" }), (err) => err.status === 409);
});

test("startOver wipes the company when the owner email matches", async () => {
  const state = pendingState();
  await addFirstUser(state, { name: "Chen", email: "chen@example.com", password: "password1" });
  const done = completeSetup(state, { template: "starter", ownerName: "Chen" });
  assert.throws(() => startOver(done, { email: "wrong@example.com", confirm: true }), (err) => err.status === 403);
  const wiped = startOver(done, { email: "chen@example.com", confirm: true });
  assert.equal(wiped.onboarding.complete, false);
  assert.equal((wiped.users || []).length, 0);
  assert.equal(wiped.seats.length, 0);
});
