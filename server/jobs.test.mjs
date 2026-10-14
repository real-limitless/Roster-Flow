import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { emptyOrgState, emptyState, migrateState } from "./seed.mjs";
import { teamWakeTarget } from "./teams.mjs";
import { bootCore } from "./test-helpers.mjs";
import {
  applyWake,
  cancelJob,
  createJob,
  deliverCallback,
  normalizeCallback,
  isWaitSatisfied,
  listJobs,
  parseSince,
  publishNewJob,
  reportJob,
  resolveJobTarget,
  settleJob,
  waitForJob,
} from "./jobs.mjs";

const caller = { userId: "usr-1", seatId: "you", name: "Ops", tokenId: "tok-1" };

function harness(state, wake) {
  const messages = [];
  const bus = [];
  const deps = {
    mutate(fn) {
      fn(state);
    },
    getState() {
      return state;
    },
    postMessage(channel, who, kind, text, extra = {}) {
      messages.push({ channel, who, kind, text, ...extra });
    },
    postBus(entry) {
      bus.push(entry);
      return entry;
    },
    wakeSeat: wake,
    async deliverCallback(job) {
      return { ok: true, status: 204, at: new Date().toISOString(), job };
    },
  };
  return { deps, messages, bus };
}

const loopback = { env: { ROSTER_CALLBACK_ALLOWLIST: "127.0.0.1" } };

test("createJob stores the brief, caller, file refs, and a run id", async () => {
  const state = emptyState();
  const job = await createJob(
    state,
    {
      target: "build",
      brief: "Make webhook idempotent",
      fileRefs: ["billing/webhook.ts", { path: "notes.md", name: "Notes" }],
      runId: "run-42",
      budget: { tokens: 1000, cost: 0.5 },
    },
    caller,
  );
  assert.equal(job.status, "queued");
  assert.equal(job.assignee, "build");
  assert.equal(job.caller.tokenId, "tok-1");
  assert.equal(job.runId, "run-42");
  assert.deepEqual(job.fileRefs, [
    { path: "billing/webhook.ts" },
    { path: "notes.md", name: "Notes" },
  ]);
  assert.deepEqual(job.budget, { tokens: 1000, cost: 0.5 });
  assert.equal(job.events[0].type, "submitted");
  assert.equal(state.jobs.length, 1);
});

test("team routing: supervisor is today's wake target, plus round-robin and a named specialist", async () => {
  const state = emptyState();
  assert.equal(teamWakeTarget("team:eng", state.teams), "eng-supervisor");
  const sup = resolveJobTarget(state, { target: "team:eng" });
  assert.equal(sup.assignee, "eng-supervisor");
  assert.equal(sup.routing, "supervisor");

  const named = resolveJobTarget(state, { target: "team:eng", routing: "specialist", specialist: "build" });
  assert.equal(named.assignee, "build");

  const seen = [];
  for (let i = 0; i < 4; i++) seen.push((await createJob(state, { target: "team:eng", routing: "round-robin", brief: `task ${i}` })).assignee);
  assert.deepEqual(seen, ["eng-generic", "build", "review", "eng-generic"]);
  assert.equal(teamWakeTarget("team:eng", state.teams), "eng-supervisor");
  assert.equal(state.teams.find((t) => t.id === "eng").jobRrIndex, 1);
});

test("routing rejects unknown modes, off-team specialists, and seat-level routing", async () => {
  const state = emptyState();
  assert.throws(() => resolveJobTarget(state, { target: "team:eng", routing: "fuse" }), (e) => e.status === 400);
  assert.throws(() => resolveJobTarget(state, { target: "team:eng", routing: "specialist" }), (e) => e.status === 400);
  assert.throws(() => resolveJobTarget(state, { target: "team:eng", routing: "specialist", specialist: "scout" }), (e) => e.status === 400);
  assert.throws(() => resolveJobTarget(state, { target: "team:eng", routing: "specialist", specialist: "jules" }), (e) => e.status === 400);
  assert.throws(
    () => resolveJobTarget(state, { target: "team:eng", routing: "specialist", specialist: "eng-supervisor" }),
    (e) => e.status === 400,
  );
  assert.throws(() => resolveJobTarget(state, { target: "team:missing", brief: "x" }), (e) => e.status === 404);
  await assert.rejects(createJob(state, { target: "build", routing: "supervisor", brief: "x" }), (e) => e.status === 400);
  await assert.rejects(createJob(state, { target: "nope", brief: "x" }), (e) => e.status === 404);
  await assert.rejects(createJob(state, { target: "build" }), (e) => e.status === 400);
  await assert.rejects(createJob(state, { target: "build", brief: "x", callbackUrl: "javascript:alert(1)" }), (e) => e.status === 400);
  await assert.rejects(createJob(state, { target: "build", brief: "x", fileRefs: Array.from({ length: 33 }, () => "a") }), (e) => e.status === 400);
});

test("report, needs_human, and cancel move status and record cost", async () => {
  const state = emptyState();
  const job = await createJob(state, { target: "build", brief: "ship it" }, caller);
  const parked = reportJob(state, job.id, { status: "needs_human", result: "Which idempotency key?" }, caller);
  assert.equal(parked.status, "needs_human");
  assert.equal(parked.finishedAt, null);
  const done = reportJob(state, job.id, { result: "PR opened", cost: 0.02, tokens: { input: 10, output: 4 } }, caller);
  assert.equal(done.status, "done");
  assert.equal(done.result, "PR opened");
  assert.equal(done.cost, 0.02);
  assert.deepEqual(done.tokens, { input: 10, output: 4 });
  assert.ok(done.finishedAt);
  assert.throws(() => reportJob(state, job.id, { result: "again" }), (e) => e.status === 409);

  const other = await createJob(state, { target: "qa", brief: "test it" });
  const cancelled = cancelJob(state, other.id, { reason: "caller stopped" }, caller);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.result, "caller stopped");
  assert.throws(() => cancelJob(state, other.id, {}, caller), (e) => e.status === 409);
  assert.equal(listJobs(state, { status: "done" }).length, 1);
  assert.equal(listJobs(state)[0].id, other.id);
});

test("wake marks running only when a session is prompted; offline stays queued", async () => {
  const state = emptyState();
  const job = await createJob(state, { target: "build", brief: "ship it" });
  const offline = applyWake(state, job.id, { offline: true, seat: "build" });
  assert.equal(offline.status, "queued");
  assert.equal(offline.wake.offline, true);
  const running = applyWake(state, job.id, { sessionId: "ses_1", seat: "build" });
  assert.equal(running.status, "running");
  assert.ok(running.startedAt);
  const human = await createJob(state, { target: "jules", brief: "look at this" });
  const parked = applyWake(state, human.id, { human: true, seat: "jules" });
  assert.equal(parked.status, "needs_human");
});

test("publish wakes the resolved seat and posts the job in the room", async () => {
  const state = emptyState();
  const seen = [];
  const { deps, messages, bus } = harness(state, async (to, text, meta) => {
    seen.push({ to, text, meta });
    return { offline: true, seat: to };
  });
  const { job } = await publishNewJob({ target: "team:eng", brief: "Route this", fileRefs: [{ path: "a.ts" }] }, caller, deps);
  assert.equal(job.assignee, "eng-supervisor");
  assert.equal(job.status, "queued");
  assert.equal(seen[0].to, "eng-supervisor");
  assert.equal(seen[0].meta.via, "team:eng");
  assert.match(seen[0].text, new RegExp(job.id));
  assert.match(seen[0].text, /roster_report/);
  assert.equal(messages[0].channel, "ship");
  assert.match(messages[0].text, /Route this/);
  assert.equal(messages[0].files[0].path, "a.ts");
  assert.equal(bus[0].kind, "job");
  assert.equal(bus[0].to, "eng-supervisor");
  assert.equal(bus[0].jobId, job.id);
  assert.equal(bus[0].wake, false);
});

test("settleJob announces, callbacks, and wait returns on a terminal status", async () => {
  const state = emptyState();
  const { deps, messages, bus } = harness(state, async () => ({ offline: true }));
  const hits = [];
  deps.deliverCallback = async (job) => {
    hits.push(job.status);
    return { ok: true, status: 204 };
  };
  const { job } = await publishNewJob(
    { target: "build", brief: "ship it", callbackUrl: "http://127.0.0.1:9/hook" },
    caller,
    deps,
    loopback,
  );
  const done = await settleJob(job.id, "complete", { result: "shipped", cost: "0.1", tokens: "3" }, caller, deps);
  assert.equal(done.status, "done");
  assert.equal(done.cost, 0.1);
  assert.deepEqual(done.tokens, { total: 3 });
  assert.equal(done.callback.ok, true);
  assert.deepEqual(hits, ["done"]);
  assert.equal(messages.at(-1).text.includes("shipped"), true);
  assert.equal(bus.at(-1).kind, "job_complete");

  const quiet = await createJob(state, { target: "qa", brief: "quietly", callbackUrl: "http://127.0.0.1:9/hook" }, caller, loopback);
  const before = messages.length;
  const parked = await settleJob(quiet.id, "complete", { status: "needs_human", result: "approve?", announce: false }, caller, deps);
  assert.equal(parked.status, "needs_human");
  assert.equal(messages.length, before);
  assert.equal(hits.at(-1), "needs_human");

  const waiting = waitForJob(done.id, { timeout: 1000 }, deps, async () => {
    throw new Error("already terminal");
  });
  const out = await waiting;
  assert.equal(out.timedOut, false);
  assert.equal(out.job.status, "done");

  const queued = await createJob(state, { target: "docs", brief: "later" });
  const timed = await waitForJob(queued.id, { timeout: 0 }, deps, async () => {
    throw new Error("timeout 0 does not sleep");
  });
  assert.equal(timed.timedOut, true);
  assert.equal(isWaitSatisfied(queued, { since: queued.updatedAt }), false);
  assert.throws(() => parseSince("nope"), (e) => e.status === 400);
});

test("migrateState keeps a jobs array", () => {
  const state = emptyState();
  delete state.jobs;
  const next = migrateState(state);
  assert.ok(Array.isArray(next.jobs));
});

test("deliverCallback posts the job snapshot and records a transport failure", async () => {
  const state = emptyState();
  const job = await createJob(state, { target: "build", brief: "ship it", callbackUrl: "http://127.0.0.1/hook" }, caller, loopback);
  const calls = [];
  const ok = await deliverCallback(job, async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), redirect: init.redirect });
    return { ok: true, status: 204 };
  }, loopback);
  assert.equal(ok.ok, true);
  assert.equal(calls[0].body.event, "job.status");
  assert.equal(calls[0].body.job.id, job.id);
  assert.equal(calls[0].redirect, "manual");
  const bad = await deliverCallback(job, async () => {
    throw new Error("down");
  }, loopback);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /down/);
});

test("jobs HTTP API authorizes with scoped tokens, waits, and callbacks", async () => {
  const ADMIN = "rf_jobs_admin_token_0123456789abcd";
  const hookHits = [];
  const hook = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hookHits.push(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((resolve) => hook.listen(0, "127.0.0.1", resolve));
  const hookPort = hook.address().port;
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_OWNER_TEMPLATE: "starter",
    ROSTER_API_TOKEN: ADMIN,
    ROSTER_CALLBACK_ALLOWLIST: "127.0.0.1",
  });
  const auth = (token) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
  try {
    assert.equal((await fetch(`${core.base}/api/v1/jobs`)).status, 401);
    const minted = await fetch(`${core.base}/api/v1/tokens`, {
      method: "POST",
      headers: auth(ADMIN),
      body: JSON.stringify({ name: "readonly", scopes: ["read"] }),
    });
    assert.equal(minted.status, 201);
    const { token: readOnly } = await minted.json();
    const denied = await fetch(`${core.base}/api/v1/jobs`, {
      method: "POST",
      headers: auth(readOnly),
      body: JSON.stringify({ target: "build", brief: "nope" }),
    });
    assert.equal(denied.status, 403);

    const created = await fetch(`${core.base}/api/v1/jobs`, {
      method: "POST",
      headers: auth(ADMIN),
      body: JSON.stringify({
        target: "team:eng",
        routing: "specialist",
        specialist: "build",
        brief: "Implement the webhook",
        fileRefs: [{ path: "billing/webhook.ts", name: "webhook.ts" }],
        callbackUrl: `http://127.0.0.1:${hookPort}/hook`,
        budget: { tokens: 500 },
      }),
    });
    assert.equal(created.status, 201);
    const job = await created.json();
    assert.equal(job.assignee, "build");
    assert.equal(job.routing, "specialist");
    assert.equal(job.status, "queued");
    assert.equal(job.caller.tokenId.startsWith("tok-"), true);
    assert.equal(job.budget.tokens, 500);
    assert.equal(job.wake.offline, true);

    const room = await (await fetch(`${core.base}/api/v1/channels/ship/messages`, { headers: auth(readOnly) })).json();
    assert.ok(room.some((m) => m.jobId === job.id && m.text.includes("Implement the webhook")));
    const bus = await (await fetch(`${core.base}/api/v1/bus`, { headers: auth(readOnly) })).json();
    assert.ok(bus.some((b) => b.jobId === job.id && b.to === "build" && b.kind === "job"));

    const early = await fetch(`${core.base}/api/v1/jobs/${job.id}/wait?timeout=200`, { headers: auth(readOnly) });
    const earlyBody = await early.json();
    assert.equal(early.status, 200);
    assert.equal(earlyBody.timedOut, true);
    assert.equal(earlyBody.job.status, "queued");

    const pending = fetch(`${core.base}/api/v1/jobs/${job.id}/wait?timeout=8000`, { headers: auth(readOnly) });
    await new Promise((r) => setTimeout(r, 200));
    const finished = await fetch(`${core.base}/api/v1/jobs/${job.id}/complete`, {
      method: "POST",
      headers: auth(ADMIN),
      body: JSON.stringify({ result: "PR opened", cost: 0.01, tokens: { input: 2, output: 1 } }),
    });
    assert.equal(finished.status, 200);
    const done = await finished.json();
    assert.equal(done.status, "done");
    assert.equal(done.callback.ok, true);
    assert.equal(hookHits.length, 1);
    assert.equal(hookHits[0].event, "job.status");
    assert.equal(hookHits[0].job.status, "done");
    const waited = await (await pending).json();
    assert.equal(waited.timedOut, false);
    assert.equal(waited.job.status, "done");

    const again = await fetch(`${core.base}/api/v1/jobs/${job.id}/complete`, {
      method: "POST",
      headers: auth(ADMIN),
      body: JSON.stringify({ result: "nope" }),
    });
    assert.equal(again.status, 409);

    const second = await (
      await fetch(`${core.base}/api/v1/jobs`, {
        method: "POST",
        headers: auth(ADMIN),
        body: JSON.stringify({ target: "team:eng", brief: "Supervisor dispatch" }),
      })
    ).json();
    assert.equal(second.assignee, "eng-supervisor");
    assert.equal(second.routing, "supervisor");
    const third = await (
      await fetch(`${core.base}/api/v1/jobs`, {
        method: "POST",
        headers: auth(ADMIN),
        body: JSON.stringify({ target: "team:eng", routing: "round_robin", brief: "next worker" }),
      })
    ).json();
    assert.equal(third.assignee, "eng-generic");
    const cancelled = await (
      await fetch(`${core.base}/api/v1/jobs/${third.id}/cancel`, {
        method: "POST",
        headers: auth(ADMIN),
        body: JSON.stringify({ reason: "stop" }),
      })
    ).json();
    assert.equal(cancelled.status, "cancelled");

    const listed = await (await fetch(`${core.base}/api/v1/jobs?status=cancelled`, { headers: auth(readOnly) })).json();
    assert.ok(listed.some((j) => j.id === third.id));
    const state = await (await fetch(`${core.base}/api/v1/state`, { headers: auth(readOnly) })).json();
    assert.ok(Array.isArray(state.jobs));
    assert.equal(state.apiTokens, undefined);
  } finally {
    await core.stop();
    await new Promise((resolve) => hook.close(resolve));
  }
});

test("empty org posts an omitted channel to #general", async () => {
  const state = emptyOrgState();
  const job = await createJob(state, { target: "you", brief: "x" });
  assert.equal(job.channel, "general");
  await assert.rejects(createJob(state, { target: "you", brief: "x", channel: "ship" }), (e) => e.status === 404);
});

test("callbackUrl rejects private, loopback, link-local, and metadata addresses", async () => {
  const blocked = [
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1/hook",
    "http://10.1.2.3/hook",
    "http://192.168.1.9/hook",
    "http://172.16.0.4/hook",
    "http://[::1]/hook",
    "http://[fe80::1]/hook",
    "http://[fc00::1]/hook",
  ];
  for (const callbackUrl of blocked) {
    await assert.rejects(normalizeCallback(callbackUrl), (e) => e.status === 400 && /blocked/.test(e.message));
  }
  const lookup = async () => [{ address: "169.254.169.254", family: 4 }];
  await assert.rejects(normalizeCallback("https://metadata.google.internal/computeMetadata/v1/", { lookup }), (e) => e.status === 400);
  const mixed = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.8", family: 4 },
  ];
  await assert.rejects(normalizeCallback("https://hooks.example/cb", { lookup: mixed }), (e) => e.status === 400);
  await assert.rejects(normalizeCallback("https://missing.example/cb", { lookup: async () => { throw new Error("ENOTFOUND"); } }), (e) => e.status === 400);
  const pub = await normalizeCallback("https://hooks.example/cb", { lookup: async () => [{ address: "93.184.216.34", family: 4 }] });
  assert.equal(pub, "https://hooks.example/cb");
  const allowed = await normalizeCallback("http://169.254.169.254/hook", { env: { ROSTER_CALLBACK_ALLOWLIST: "169.254.169.254" } });
  assert.match(allowed, /^http:\/\/169\.254\.169\.254\/hook$/);
});

test("empty org HTTP job defaults to #general and blocks metadata callbacks", async () => {
  const token = "rf_empty_org_token_0123456789abcd";
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_OWNER_TEMPLATE: "empty",
    ROSTER_API_TOKEN: token,
    OPENCODE_BIN: "/nonexistent/opencode",
  });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  try {
    const created = await fetch(`${core.base}/api/v1/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ target: "you", brief: "x" }),
    });
    assert.equal(created.status, 201);
    const job = await created.json();
    assert.equal(job.channel, "general");
    const blocked = await fetch(`${core.base}/api/v1/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ target: "you", brief: "x", callbackUrl: "http://169.254.169.254/latest/meta-data" }),
    });
    assert.equal(blocked.status, 400);
    const body = await blocked.json();
    assert.match(body.error, /blocked/);
  } finally {
    await core.stop();
  }
});
