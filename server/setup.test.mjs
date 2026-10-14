import assert from "node:assert/strict";
import test from "node:test";
import { addFirstUser } from "./auth.mjs";
import { setupClosed } from "./bootstrap.mjs";
import { applyOrgTemplate, completeSetup, markHarnessStep, markInstallSeen, publicState, setupStatus, startOver } from "./setup.mjs";
import { emptyOrgState, migrateState, pendingState, starterState } from "./seed.mjs";
import { bootCore } from "./test-helpers.mjs";

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

test("startOver wipes the company only for the owner", async () => {
  const open = await startOver(pendingState(), { confirm: true });
  assert.equal(setupClosed(open), false);
  assert.equal(open.onboarding.complete, false);

  const state = pendingState();
  await addFirstUser(state, { name: "Chen", email: "chen@example.com", password: "password1" });
  const done = completeSetup(state, { template: "starter", ownerName: "Chen" });
  assert.equal(setupClosed(done), true);
  await assert.rejects(
    () => startOver(done, { email: "wrong@example.com", confirm: true, password: "password1" }),
    (err) => err.status === 403,
  );
  await assert.rejects(() => startOver(done, { email: "chen@example.com", confirm: true }), (err) => err.status === 401);
  await assert.rejects(
    () => startOver(done, { email: "chen@example.com", confirm: true, password: "not-the-password" }),
    (err) => err.status === 401,
  );
  const wiped = await startOver(done, { email: "chen@example.com", confirm: true, password: "password1" });
  assert.equal(wiped.onboarding.complete, false);
  assert.equal(setupClosed(wiped), false);
  assert.equal((wiped.users || []).length, 0);
  assert.equal(wiped.seats.length, 0);

  const bySession = await startOver(done, { email: "chen@example.com", confirm: true, user: done.users[0] });
  assert.equal(setupClosed(bySession), false);
});

async function postJson(base, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test("start-over rejects unauthenticated and wrong-password requests and accepts the owner password", async () => {
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_BOOTSTRAP_TOKEN: "",
  });
  const wipe = { email: "ops@example.com", confirm: true };
  try {
    const anon = await postJson(core.base, "/api/v1/setup/start-over", wipe);
    assert.equal(anon.status, 401);
    let status = await (await fetch(`${core.base}/api/v1/setup/status`)).json();
    assert.equal(status.hasUser, true);
    const takeover = await postJson(core.base, "/api/v1/setup/first-user", {
      name: "Intruder",
      email: "intruder@example.com",
      password: "password1",
    });
    assert.equal(takeover.status, 409);

    const forged = await postJson(core.base, "/api/v1/setup/start-over", wipe, { authorization: "Bearer not-a-session" });
    assert.equal(forged.status, 401);
    status = await (await fetch(`${core.base}/api/v1/setup/status`)).json();
    assert.equal(status.hasUser, true);

    const wrong = await postJson(core.base, "/api/v1/setup/start-over", { ...wipe, password: "wrongpass" });
    assert.equal(wrong.status, 401);
    status = await (await fetch(`${core.base}/api/v1/setup/status`)).json();
    assert.equal(status.hasUser, true);

    const ok = await postJson(core.base, "/api/v1/setup/start-over", { ...wipe, password: "password1" });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.hasUser, false);
    assert.equal(ok.data.complete, false);
    const reopened = await postJson(core.base, "/api/v1/setup/first-user", {
      name: "Ops",
      email: "ops@example.com",
      password: "password1",
    });
    assert.equal(reopened.status, 201);
  } finally {
    await core.stop();
  }
});

test("start-over accepts a valid owner session", async () => {
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_BOOTSTRAP_TOKEN: "",
  });
  try {
    const login = await postJson(core.base, "/api/v1/auth/login", { email: "ops@example.com", password: "password1" });
    assert.equal(login.status, 200);
    const ok = await postJson(
      core.base,
      "/api/v1/setup/start-over",
      { email: "ops@example.com", confirm: true },
      { authorization: `Bearer ${login.data.token}` },
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.data.hasUser, false);
    const status = await (await fetch(`${core.base}/api/v1/setup/status`)).json();
    assert.equal(status.hasUser, false);
  } finally {
    await core.stop();
  }
});

test("start-over rejects a non-admin API token", async () => {
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_BOOTSTRAP_TOKEN: "",
  });
  try {
    const login = await postJson(core.base, "/api/v1/auth/login", { email: "ops@example.com", password: "password1" });
    assert.equal(login.status, 200);
    const created = await postJson(
      core.base,
      "/api/v1/tokens",
      { name: "reader", scopes: ["read"] },
      { authorization: `Bearer ${login.data.token}` },
    );
    assert.equal(created.status, 201);
    const denied = await postJson(
      core.base,
      "/api/v1/setup/start-over",
      { email: "ops@example.com", confirm: true },
      { authorization: `Bearer ${created.data.token}` },
    );
    assert.equal(denied.status, 403);
    const status = await (await fetch(`${core.base}/api/v1/setup/status`)).json();
    assert.equal(status.hasUser, true);
  } finally {
    await core.stop();
  }
});

test("start-over requires ROSTER_BOOTSTRAP_TOKEN when it is set", async () => {
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_BOOTSTRAP_TOKEN: "s3cret",
  });
  const wipe = { email: "ops@example.com", confirm: true, password: "password1" };
  try {
    const denied = await postJson(core.base, "/api/v1/setup/start-over", wipe);
    assert.equal(denied.status, 401);
    let status = await (await fetch(`${core.base}/api/v1/setup/status`)).json();
    assert.equal(status.hasUser, true);

    const login = await postJson(core.base, "/api/v1/auth/login", { email: "ops@example.com", password: "password1" });
    const sessionDenied = await postJson(
      core.base,
      "/api/v1/setup/start-over",
      { email: "ops@example.com", confirm: true },
      { authorization: `Bearer ${login.data.token}` },
    );
    assert.equal(sessionDenied.status, 401);
    status = await (await fetch(`${core.base}/api/v1/setup/status`)).json();
    assert.equal(status.hasUser, true);

    const ok = await postJson(core.base, "/api/v1/setup/start-over", wipe, { "x-roster-bootstrap-token": "s3cret" });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.hasUser, false);
  } finally {
    await core.stop();
  }
});
