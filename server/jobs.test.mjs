import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import diagnostics from "node:diagnostics_channel";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { emptyOrgState, emptyState, migrateState } from "./seed.mjs";
import { publicState } from "./setup.mjs";
import { teamWakeTarget } from "./teams.mjs";
import { bootCore } from "./test-helpers.mjs";
import {
  CALLBACK_HEADERS,
  CALLBACK_SECRET_MIN_BYTES,
  DEFAULT_CALLBACK_DNS_TIMEOUT_MS,
  DEFAULT_CALLBACK_GRACE_MS,
  MAX_CALLBACK_DNS_TIMEOUT_MS,
  MAX_CALLBACK_GRACE_MS,
  applyWake,
  assertCallbackSecret,
  callbackAddressBlocked,
  callbackAllowlist,
  callbackDnsTimeoutMs,
  callbackGraceMs,
  callbackSecretInfo,
  callbackAllowlistWarnings,
  cancelJob,
  createJob,
  deliverCallback,
  ensureCallbackSecret,
  flushCallbacks,
  getJob,
  normalizeCallback,
  isWaitSatisfied,
  listJobs,
  parseSince,
  pinnedLookup,
  publicJob,
  publishNewJob,
  reportJob,
  resolveJobTarget,
  rotateCallbackSecret,
  settleJob,
  signCallback,
  verifyCallback,
  waitForJob,
} from "./jobs.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function hookServer(status = 204) {
  const hits = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hits.push({ headers: req.headers, raw: Buffer.concat(chunks).toString(), url: req.url });
      res.writeHead(status);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    hits,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

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
  assert.equal(done.callback, null);
  await flushCallbacks();
  assert.equal(getJob(state, done.id).callback.ok, true);
  assert.deepEqual(hits, ["done"]);
  assert.equal(messages.at(-1).text.includes("shipped"), true);
  assert.equal(bus.at(-1).kind, "job_complete");

  const quiet = await createJob(state, { target: "qa", brief: "quietly", callbackUrl: "http://127.0.0.1:9/hook" }, caller, loopback);
  const before = messages.length;
  const parked = await settleJob(quiet.id, "complete", { status: "needs_human", result: "approve?", announce: false }, caller, deps);
  assert.equal(parked.status, "needs_human");
  assert.equal(parked.callback, null);
  await flushCallbacks();
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

test("deliverCallback posts a signed snapshot and records a transport failure", async () => {
  const hook = await hookServer();
  const secret = "rfcb_test_secret";
  const state = emptyState();
  try {
    const job = await createJob(state, { target: "build", brief: "ship it", callbackUrl: `http://127.0.0.1:${hook.port}/hook?x=1` }, caller, loopback);
    const ok = await deliverCallback(job, { ...loopback, secret });
    assert.equal(ok.ok, true);
    assert.equal(ok.status, 204);
    const [hit] = hook.hits;
    assert.equal(hit.url, "/hook?x=1");
    const body = JSON.parse(hit.raw);
    assert.equal(body.event, "job.status");
    assert.equal(body.job.id, job.id);
    assert.equal(hit.headers[CALLBACK_HEADERS.jobId], job.id);
    assert.match(hit.headers[CALLBACK_HEADERS.timestamp], /^\d+$/);
    assert.equal(
      hit.headers[CALLBACK_HEADERS.signature],
      signCallback(secret, hit.headers[CALLBACK_HEADERS.timestamp], job.id, hit.raw),
    );
    assert.equal(verifyCallback(secret, hit.headers, hit.raw), true);
    assert.equal(verifyCallback("wrong", hit.headers, hit.raw), false);
    assert.equal(verifyCallback(secret, hit.headers, hit.raw.replace("ship it", "ship that")), false);
    assert.equal(verifyCallback(secret, { ...hit.headers, [CALLBACK_HEADERS.jobId]: "job-other" }, hit.raw), false);
    assert.equal(verifyCallback(secret, hit.headers, hit.raw, { now: Date.now() + 600_000 }), false);

    const unsigned = await deliverCallback(job, loopback);
    assert.equal(unsigned.ok, false);
    assert.equal(unsigned.error, "signing_secret");
    assert.equal(hook.hits.length, 1);
  } finally {
    await hook.close();
  }
  const job = await createJob(state, { target: "build", brief: "x", callbackUrl: `http://127.0.0.1:${hook.port}/hook` }, caller, loopback);
  const bad = await deliverCallback(job, { ...loopback, secret });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "connect_failed");
  assert.doesNotMatch(bad.error, /127\.0\.0\.1/);
});

test("deliverCallback does not follow redirects", async () => {
  const hook = await hookServer(302);
  try {
    const job = await createJob(emptyState(), { target: "build", brief: "x", callbackUrl: `http://127.0.0.1:${hook.port}/hook` }, caller, loopback);
    const out = await deliverCallback(job, { ...loopback, secret: "s" });
    assert.equal(out.ok, false);
    assert.equal(out.status, 302);
    assert.equal(out.error, "http_302");
  } finally {
    await hook.close();
  }
});

test("delivery pins the checked address: a DNS answer that flips to 127.0.0.1 is never dialed", async () => {
  const hook = await hookServer();
  const answers = ["93.184.216.34", "127.0.0.1"];
  let lookups = 0;
  const lookup = async () => [{ address: answers[Math.min(lookups++, answers.length - 1)], family: 4 }];
  const dialed = [];
  const onSocket = ({ socket }) => socket.on("lookup", (err, address) => dialed.push(address));
  diagnostics.subscribe("net.client.socket", onSocket);
  try {
    const job = { id: "job-rebind", status: "done", callbackUrl: `http://rebind.roster.test:${hook.port}/hook`, events: [] };
    const out = await deliverCallback(job, { lookup, env: {}, secret: "s", timeoutMs: 400 });
    assert.equal(out.ok, false);
    assert.equal(lookups, 1, "the host is resolved once per delivery");
    assert.ok(dialed.length >= 1);
    assert.ok(dialed.every((address) => address === "93.184.216.34"), `dialed ${dialed.join(", ")}`);
    assert.equal(hook.hits.length, 0, "loopback hook must not be reached");

    lookups = 1;
    const second = await deliverCallback(job, { lookup, env: {}, secret: "s", timeoutMs: 400 });
    assert.match(second.error, /blocked/, "a rebound answer seen at check time is rejected");
    assert.equal(hook.hits.length, 0);
  } finally {
    diagnostics.unsubscribe("net.client.socket", onSocket);
    await hook.close();
  }
});

test("pinnedLookup answers only with checked addresses", async () => {
  const pinned = pinnedLookup([
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ]);
  const call = (opts) => new Promise((resolve) => pinned("evil.test", opts, (err, address, family) => resolve({ err, address, family })));
  assert.deepEqual(await call({}), { err: null, address: "93.184.216.34", family: 4 });
  assert.equal((await call({ family: 6 })).address, "2606:2800:220:1:248:1893:25c8:1946");
  const all = await call({ all: true });
  assert.deepEqual(all.address.map((a) => a.address), ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
  const v4only = pinnedLookup([{ address: "93.184.216.34", family: 4 }]);
  const none = await new Promise((resolve) => v4only("evil.test", { family: 6 }, (err) => resolve(err)));
  assert.equal(none.code, "ENOTFOUND");
});

test("pinned delivery keeps the original hostname in Host and TLS SNI", async () => {
  const hook = await hookServer();
  const lookup = async () => [{ address: "127.0.0.1", family: 4 }];
  const env = { ROSTER_CALLBACK_ALLOWLIST: "hooks.roster.test" };
  try {
    const job = { id: "job-host", status: "done", callbackUrl: `http://hooks.roster.test:${hook.port}/hook`, events: [] };
    const out = await deliverCallback(job, { lookup, env, secret: "s" });
    assert.equal(out.ok, true);
    assert.equal(hook.hits[0].headers.host, `hooks.roster.test:${hook.port}`);
  } finally {
    await hook.close();
  }

  let hello = Buffer.alloc(0);
  const tls = createTcpServer((socket) => {
    socket.on("data", (chunk) => {
      hello = Buffer.concat([hello, chunk]);
      socket.destroy();
    });
  });
  await new Promise((resolve) => tls.listen(0, "127.0.0.1", resolve));
  try {
    const job = { id: "job-sni", status: "done", callbackUrl: `https://hooks.roster.test:${tls.address().port}/hook`, events: [] };
    const out = await deliverCallback(job, { lookup, env, secret: "s", timeoutMs: 2000 });
    assert.equal(out.ok, false);
    assert.equal(hello[0], 0x16, "TLS handshake record");
    assert.ok(hello.includes(Buffer.from("hooks.roster.test")), "ClientHello carries the hostname as SNI");
  } finally {
    await new Promise((resolve) => tls.close(resolve));
  }
});

test("jobs HTTP API authorizes with scoped tokens, waits, and callbacks", async () => {
  const ADMIN = "rf_jobs_admin_token_0123456789abcd";
  const hookHits = [];
  const hookRaw = [];
  const hook = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      hookRaw.push({ headers: req.headers, raw });
      hookHits.push(JSON.parse(raw || "{}"));
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
    assert.equal(done.callback, null);
    let recorded = null;
    for (let i = 0; i < 50 && !recorded?.callback; i++) {
      if (hookHits.length) {
        recorded = await (await fetch(`${core.base}/api/v1/jobs/${job.id}`, { headers: auth(readOnly) })).json();
      }
      if (!recorded?.callback) await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(recorded.callback.ok, true);
    assert.equal(hookHits.length, 1);
    assert.equal(hookHits[0].event, "job.status");
    assert.equal(hookHits[0].job.status, "done");
    assert.equal(hookRaw[0].headers[CALLBACK_HEADERS.jobId], job.id);

    const secretPath = `${core.base}/api/v1/jobs/callback-secret`;
    assert.equal((await fetch(secretPath, { headers: auth(readOnly) })).status, 403);
    const info = await (await fetch(secretPath, { headers: auth(ADMIN) })).json();
    assert.equal(info.algorithm, "HMAC-SHA256");
    assert.equal(info.source, "state");
    assert.equal(verifyCallback(info.secret, hookRaw[0].headers, hookRaw[0].raw), true);
    assert.equal((await fetch(`${secretPath}/rotate`, { method: "POST", headers: auth(readOnly) })).status, 403);
    const rotated = await (await fetch(`${secretPath}/rotate`, { method: "POST", headers: auth(ADMIN) })).json();
    assert.notEqual(rotated.secret, info.secret);
    assert.equal(verifyCallback(rotated.secret, hookRaw[0].headers, hookRaw[0].raw), false);

    const withCreds = await fetch(`${core.base}/api/v1/jobs`, {
      method: "POST",
      headers: auth(ADMIN),
      body: JSON.stringify({ target: "build", brief: "x", callbackUrl: `http://user:pass@127.0.0.1:${hookPort}/hook` }),
    });
    assert.equal(withCreds.status, 400);
    assert.match((await withCreds.json()).error, /credentials/);
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
    assert.equal(state.callbackSecret, undefined);
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
});

test("callbackUrl blocks documentation, benchmarking, multicast, reserved, and IPv6 embedding ranges", () => {
  const blocked = [
    "192.0.0.8",
    "192.0.2.10",
    "198.18.0.1",
    "198.19.255.254",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "100.64.0.1",
    "64:ff9b::808:808",
    "64:ff9b::7f00:1",
    "64:ff9b:1::1",
    "2002:808:808::1",
    "2002:7f00:1::",
    "::8.8.8.8",
    "::7f00:1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001:db8::1",
    "fec0::1",
    "100::1",
    "100::ffff:ffff:ffff:ffff",
    "2001:2::1",
    "2001:10::1",
    "2001:1f::1",
    "192.88.99.1",
    "192.88.99.255",
    "ff02::1",
    "ff05::1:3",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::",
    "::1",
    "not-an-ip",
  ];
  for (const address of blocked) assert.equal(callbackAddressBlocked(address), true, address);
  const open = ["93.184.216.34", "8.8.8.8", "192.88.100.1", "198.20.0.1", "223.255.255.255", "100:0:0:1::", "2001:20::1", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:8.8.8.8"];
  for (const address of open) assert.equal(callbackAddressBlocked(address), false, address);
});

test("ROSTER_CALLBACK_ALLOWLIST never opens link-local or metadata addresses", async () => {
  const never = [
    "0.0.0.0",
    "0.1.2.3",
    "0.255.255.255",
    "::ffff:0.1.2.3",
    "64:ff9b::1",
    "169.254.169.254",
    "169.254.170.2",
    "169.254.1.1",
    "100.100.100.200",
    "168.63.129.16",
    "fe80::1",
    "fe80::1%eth0",
    "fd00:ec2::254",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1:a9fe:a9:fe00::",
    "2002:a9fe:a9fe::1",
    "2001:0:a9fe:a9fe::5601:5601",
    "2001:0:4136:e378:8000:63bf:5601:5601",
  ];
  for (const address of never) assert.equal(callbackAddressBlocked(address, { allowlisted: true }), true, address);
  assert.equal(callbackAddressBlocked("127.0.0.1", { allowlisted: true }), false);
  assert.equal(callbackAddressBlocked("10.0.0.8", { allowlisted: true }), false);

  const env = { ROSTER_CALLBACK_ALLOWLIST: "169.254.169.254,metadata.google.internal,[fe80::1],[fd00:ec2::254]" };
  await assert.rejects(normalizeCallback("http://169.254.169.254/hook", { env }), (e) => e.status === 400 && /blocked/.test(e.message));
  await assert.rejects(normalizeCallback("http://[fe80::1]/hook", { env }), (e) => e.status === 400);
  await assert.rejects(normalizeCallback("http://[fd00:ec2::254]/latest", { env }), (e) => e.status === 400);
  await assert.rejects(
    normalizeCallback("http://metadata.google.internal/computeMetadata/v1/", { env, lookup: async () => [{ address: "169.254.169.254", family: 4 }] }),
    (e) => e.status === 400,
  );
  const rebound = { env: { ROSTER_CALLBACK_ALLOWLIST: "hooks.internal" }, lookup: async () => [{ address: "::ffff:169.254.169.254", family: 6 }] };
  await assert.rejects(normalizeCallback("http://hooks.internal/cb", rebound), (e) => e.status === 400);
});

test("ROSTER_CALLBACK_ALLOWLIST supports host:port with exact, case-insensitive, ASCII-only matching", async () => {
  assert.deepEqual(callbackAllowlist({ ROSTER_CALLBACK_ALLOWLIST: " Hooks.Internal:8443 , relay.internal., [::1]:9000, ::1, bücher.example, bad:port:1, x:0, [2001:0db8:0000:0000:0000:0000:0000:0001], ::ffff:127.0.0.1" }), [
    { host: "hooks.internal", port: 8443 },
    { host: "relay.internal", port: null },
    { host: "::1", port: 9000 },
    { host: "::1", port: null },
    { host: "2001:db8::1", port: null },
    { host: "::ffff:7f00:1", port: null },
  ]);
  const warnings = callbackAllowlistWarnings({ ROSTER_CALLBACK_ALLOWLIST: "*.hooks.example, hooks.internal:443" });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\*\.hooks\.example/);
  assert.match(warnings[0], /never matches/);
  assert.deepEqual(callbackAllowlist({ ROSTER_CALLBACK_ALLOWLIST: "*.corp.test:8443, http://*.corp.test:8443/, hooks.internal" }), [
    { host: "hooks.internal", port: null },
  ]);
  await assert.rejects(
    normalizeCallback("http://*.corp.test:8443/cb", {
      env: { ROSTER_CALLBACK_ALLOWLIST: "*.corp.test:8443" },
      lookup: async () => [{ address: "10.1.1.1", family: 4 }],
    }),
    (e) => e.status === 400 && /blocked/.test(e.message),
  );
  const lookup = async () => [{ address: "10.0.0.5", family: 4 }];
  const env = { ROSTER_CALLBACK_ALLOWLIST: "Hooks.Internal:8443,relay.internal,xn--bcher-kva.internal,bücher.example" };
  assert.equal(await normalizeCallback("https://HOOKS.internal:8443/cb", { env, lookup }), "https://hooks.internal:8443/cb");
  await assert.rejects(normalizeCallback("https://hooks.internal:9443/cb", { env, lookup }), (e) => e.status === 400);
  await assert.rejects(normalizeCallback("https://hooks.internal/cb", { env, lookup }), (e) => e.status === 400);
  assert.equal(await normalizeCallback("https://relay.internal:7000/cb", { env, lookup }), "https://relay.internal:7000/cb");
  assert.equal(await normalizeCallback("http://relay.internal/cb", { env, lookup }), "http://relay.internal/cb");
  await assert.rejects(normalizeCallback("https://a.relay.internal/cb", { env, lookup }), (e) => e.status === 400);
  assert.match(await normalizeCallback("https://bücher.internal/cb", { env, lookup }), /^https:\/\/xn--bcher-kva\.internal\/cb$/);
  await assert.rejects(normalizeCallback("https://bücher.example/cb", { env, lookup }), (e) => e.status === 400);
  const http80 = { ROSTER_CALLBACK_ALLOWLIST: "hooks.internal:80" };
  assert.ok(await normalizeCallback("http://hooks.internal/cb", { env: http80, lookup }));
  await assert.rejects(normalizeCallback("https://hooks.internal/cb", { env: http80, lookup }), (e) => e.status === 400);
  const v6 = { ROSTER_CALLBACK_ALLOWLIST: "[::1]:9000" };
  assert.ok(await normalizeCallback("http://[::1]:9000/cb", { env: v6 }));
  await assert.rejects(normalizeCallback("http://[::1]:9001/cb", { env: v6 }), (e) => e.status === 400);
});

test("callbackUrl with user:pass@ credentials is rejected, and publicJob never returns them", async () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  for (const callbackUrl of ["https://user:pass@hooks.example/cb", "https://user@hooks.example/cb", "https://:pass@hooks.example/cb"]) {
    await assert.rejects(normalizeCallback(callbackUrl, { lookup }), (e) => e.status === 400 && /credentials/.test(e.message), callbackUrl);
  }
  const state = emptyState();
  await assert.rejects(createJob(state, { target: "build", brief: "x", callbackUrl: "https://u:p@hooks.example/cb" }, caller, { lookup }), (e) => e.status === 400);
  assert.equal(state.jobs.length, 0);

  const job = await createJob(state, { target: "build", brief: "x", callbackUrl: "https://hooks.example/cb" }, caller, { lookup });
  state.jobs[0].callbackUrl = "https://legacy:s3cret@hooks.example/cb?q=1";
  state.callbackSecret = { value: "rfcb_hidden", createdAt: new Date().toISOString() };
  assert.equal(publicJob(state.jobs[0]).callbackUrl, "https://hooks.example/cb?q=1");
  assert.equal(listJobs(state)[0].callbackUrl, "https://hooks.example/cb?q=1");
  const shared = JSON.stringify(publicState(state));
  assert.equal(shared.includes("s3cret"), false);
  assert.equal(shared.includes("rfcb_hidden"), false);
  assert.equal(publicState(state).jobs[0].id, job.id);
  const refused = await deliverCallback(state.jobs[0], { lookup, secret: "s" });
  assert.equal(refused.error, "blocked");
  assert.equal(refused.error.includes("s3cret"), false);
});

test("the callback secret is per org, env-overridable, and rotates", () => {
  const state = emptyState();
  const first = ensureCallbackSecret(state, {});
  assert.match(first, /^rfcb_[0-9a-f]{64}$/);
  assert.equal(ensureCallbackSecret(state, {}), first);
  const envSecret = "e".repeat(CALLBACK_SECRET_MIN_BYTES);
  assert.equal(ensureCallbackSecret(state, { ROSTER_CALLBACK_SECRET: envSecret }), envSecret);
  const rotated = rotateCallbackSecret(state, {});
  assert.notEqual(rotated.secret, first);
  assert.equal(rotated.headers.signature, "x-roster-signature");
  assert.throws(() => rotateCallbackSecret(state, { ROSTER_CALLBACK_SECRET: envSecret }), (e) => e.status === 409);
});

test("publishing a job that lands in needs_human fires the callback", async () => {
  const state = emptyState();
  const { deps, messages } = harness(state, async (to) => ({ human: true, seat: to }));
  const hits = [];
  deps.deliverCallback = async (job, opts) => {
    hits.push({ status: job.status, secret: opts.secret, env: opts.env });
    return { ok: true, status: 204, at: new Date().toISOString() };
  };
  const { job } = await publishNewJob(
    { target: "jules", brief: "Approve the refund", callbackUrl: "http://127.0.0.1:9/hook" },
    caller,
    deps,
    loopback,
  );
  assert.equal(job.status, "needs_human");
  assert.equal(job.callback, null);
  await flushCallbacks();
  const recorded = getJob(state, job.id);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].status, "needs_human");
  assert.equal(hits[0].secret, state.callbackSecret.value);
  assert.equal(hits[0].env, loopback.env);
  assert.equal(recorded.callback.ok, true);
  assert.equal(recorded.callback.status, 204);
  assert.deepEqual(recorded.events.map((e) => e.type), ["submitted", "needs_human", "callback"]);
  assert.ok(messages.some((m) => m.text.includes("needs_human")));

  const quiet = await publishNewJob({ target: "build", brief: "bot work", callbackUrl: "http://127.0.0.1:9/hook" }, caller, harness(state, async () => ({ sessionId: "ses_1" })).deps, loopback);
  assert.equal(quiet.job.status, "running");
  assert.equal(quiet.job.callback, null);
  assert.equal(hits.length, 1);
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

function secretHeaders(res) {
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  assert.equal(res.headers.get("access-control-allow-headers"), null);
}

test("unauthenticated callback-secret reads are 403 when onboarding is skipped", async () => {
  const open = await bootCore({ ROSTER_SKIP_ONBOARDING: "1", ROSTER_HARNESS_AUTOSTART: "0" });
  try {
    const res = await fetch(`${open.base}/api/v1/jobs/callback-secret`);
    assert.equal(res.status, 403);
    secretHeaders(res);
    assert.match((await res.json()).error, /owner or admin/);
    const rotated = await fetch(`${open.base}/api/v1/jobs/callback-secret/rotate`, { method: "POST" });
    assert.equal(rotated.status, 403);
    secretHeaders(rotated);
    const opt = await fetch(`${open.base}/api/v1/jobs/callback-secret`, { method: "OPTIONS" });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get("access-control-allow-origin"), null);
    assert.equal(opt.headers.get("cache-control"), "no-store");
    const health = await fetch(`${open.base}/api/v1/health`);
    assert.equal(health.headers.get("access-control-allow-origin"), "*");
  } finally {
    await open.stop();
  }

  const core = await bootCore({
    ROSTER_SKIP_ONBOARDING: "1",
    ROSTER_HARNESS_AUTOSTART: "0",
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_OWNER_TEMPLATE: "empty",
  });
  try {
    const secretPath = `${core.base}/api/v1/jobs/callback-secret`;
    const anon = await fetch(secretPath);
    assert.equal(anon.status, 403);
    secretHeaders(anon);
    const demo = await fetch(secretPath, { headers: { authorization: "Bearer roster-demo" } });
    assert.equal(demo.status, 403);
    secretHeaders(demo);
    const login = await fetch(`${core.base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ops@example.com", password: "password1" }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const authed = await fetch(secretPath, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(authed.status, 200);
    secretHeaders(authed);
    const info = await authed.json();
    assert.match(info.secret, /^rfcb_[0-9a-f]{64}$/);
  } finally {
    await core.stop();
  }
});

test("a short ROSTER_CALLBACK_SECRET is rejected", async () => {
  assert.throws(() => assertCallbackSecret({ ROSTER_CALLBACK_SECRET: "a".repeat(31) }), (e) => /at least 32 bytes/.test(e.message));
  assert.equal(assertCallbackSecret({ ROSTER_CALLBACK_SECRET: "a".repeat(CALLBACK_SECRET_MIN_BYTES) }), "a".repeat(32));
  assert.equal(assertCallbackSecret({}), "");
  assert.throws(() => ensureCallbackSecret(emptyState(), { ROSTER_CALLBACK_SECRET: "short" }), /32 bytes/);

  const dir = mkdtempSync(join(tmpdir(), "rf-secret-"));
  const child = spawn(process.execPath, [join(repoRoot, "server/index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ROSTER_CALLBACK_SECRET: "too-short",
      ROSTER_SKIP_ONBOARDING: "1",
      ROSTER_API_HOST: "127.0.0.1",
      ROSTER_API_PORT: "0",
      ROSTER_DATA_DIR: join(dir, "data"),
      ROSTER_OPENCODE_DIR: join(dir, "oc"),
      ROSTER_WORKSPACE: join(dir, "ws"),
      ROSTER_HARNESS_AUTOSTART: "0",
      ROSTER_DISABLE_ROUTINES: "1",
      OPENCODE_BIN: "/nonexistent/opencode",
      HOME: dir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const code = await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`startup hung: ${stderr}`)), 8000)),
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /ROSTER_CALLBACK_SECRET must be at least 32 bytes/);
  } finally {
    if (child.exitCode == null) child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("state.json and auth.json are mode 0600, including existing files on load", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-mode-"));
  writeFileSync(join(dir, "state.json"), "{}\n", { mode: 0o644 });
  writeFileSync(join(dir, "auth.json"), "{}\n", { mode: 0o644 });
  assert.equal(statSync(join(dir, "state.json")).mode & 0o777, 0o644);
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import ${JSON.stringify(join(repoRoot, "server/store.mjs"))}; import { listProviders } from ${JSON.stringify(join(repoRoot, "server/providers.mjs"))}; listProviders();`,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ROSTER_DATA_DIR: dir,
        ROSTER_OPENCODE_DIR: join(dir, "oc"),
        ROSTER_WORKSPACE: join(dir, "ws"),
        HOME: dir,
      },
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0, stderr);
    assert.equal(statSync(join(dir, "state.json")).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, "auth.json")).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("callback grace is clamped to 24h and a second rotate drops the earlier secret", () => {
  assert.equal(callbackGraceMs({ ROSTER_CALLBACK_GRACE_MS: "1e309" }), MAX_CALLBACK_GRACE_MS);
  assert.equal(callbackGraceMs({ ROSTER_CALLBACK_GRACE_MS: String(Number.MAX_VALUE) }), MAX_CALLBACK_GRACE_MS);
  assert.equal(callbackGraceMs({ ROSTER_CALLBACK_GRACE_MS: "nope" }), DEFAULT_CALLBACK_GRACE_MS);
  assert.equal(callbackGraceMs({ ROSTER_CALLBACK_GRACE_MS: "-5" }), 0);
  const state = emptyState();
  const now = Date.parse("2026-04-11T12:00:00.000Z");
  ensureCallbackSecret(state, {}, now);
  const leaked = state.callbackSecret.value;
  const info = rotateCallbackSecret(state, { ROSTER_CALLBACK_GRACE_MS: String(Number.MAX_VALUE) }, now);
  assert.equal(info.previous.until, new Date(now + MAX_CALLBACK_GRACE_MS).toISOString());
  const body = JSON.stringify({ job: { id: "job-1" } });
  const ts = String(Math.floor(now / 1000));
  const headersFor = (secret) => ({
    "x-roster-timestamp": ts,
    "x-roster-job-id": "job-1",
    "x-roster-signature": signCallback(secret, ts, "job-1", body),
  });
  const first = callbackSecretInfo(state, {}, now);
  assert.equal(verifyCallback(first.secret, headersFor(leaked), body, { now, previous: first.previous }), true);
  rotateCallbackSecret(state, { ROSTER_CALLBACK_GRACE_MS: "600000" }, now + 1000);
  const second = callbackSecretInfo(state, {}, now + 1000);
  assert.equal(verifyCallback(second.secret, headersFor(leaked), body, { now: now + 1000, previous: second.previous }), false);
  assert.equal(verifyCallback(second.secret, headersFor(second.secret), body, { now: now + 1000, previous: second.previous }), true);
});

test("create returns before DNS, blocks IP literals, and records a private hostname at delivery", async () => {
  const state = emptyState();
  const started = Date.now();
  const job = await Promise.race([
    createJob(
      state,
      { target: "build", brief: "x", callbackUrl: "https://hooks.example/cb" },
      caller,
      { lookup: () => new Promise(() => {}), dnsTimeoutMs: 30000 },
    ),
    new Promise((_, reject) => setTimeout(() => reject(new Error("create waited on DNS")), 400)),
  ]);
  assert.ok(Date.now() - started < 400);
  assert.equal(job.callbackUrl, "https://hooks.example/cb");
  assert.equal(job.callback, null);
  const literalStarted = Date.now();
  for (const callbackUrl of ["http://169.254.169.254/latest", "http://127.0.0.1/hook", "http://[::1]/hook"]) {
    await assert.rejects(
      createJob(state, { target: "build", brief: "x", callbackUrl }, caller, { lookup: () => new Promise(() => {}), dnsTimeoutMs: 30000 }),
      (e) => e.status === 400 && /blocked/.test(e.message),
      callbackUrl,
    );
  }
  assert.ok(Date.now() - literalStarted < 300);
  const allowed = await createJob(state, { target: "build", brief: "x", callbackUrl: "http://127.0.0.1:9/hook" }, caller, loopback);
  assert.match(allowed.callbackUrl, /127\.0\.0\.1:9/);
  await assert.rejects(
    createJob(state, { target: "build", brief: "x", callbackUrl: "ftp://hooks.example/cb" }, caller),
    (e) => e.status === 400,
  );
  const { deps } = harness(state, async () => ({ sessionId: "ses_fast" }));
  const published = await Promise.race([
    publishNewJob(
      { target: "build", brief: "fast", callbackUrl: "https://slow.example/cb" },
      caller,
      deps,
      { lookup: () => new Promise(() => {}), dnsTimeoutMs: 30000 },
    ),
    new Promise((_, reject) => setTimeout(() => reject(new Error("publish waited on DNS")), 400)),
  ]);
  assert.equal(published.job.callback, null);

  const live = emptyState();
  let lookups = 0;
  const lookup = async () => {
    lookups += 1;
    return [{ address: "10.1.1.1", family: 4 }];
  };
  const created = await createJob(live, { target: "build", brief: "x", callbackUrl: "http://private.example/hook" }, caller, { lookup });
  assert.equal(lookups, 0);
  const delivery = harness(live, async () => ({ offline: true }));
  delete delivery.deps.deliverCallback;
  const done = await settleJob(created.id, "complete", { result: "ok" }, caller, delivery.deps, { lookup, retryDelaysMs: [] });
  assert.equal(done.callback, null);
  await flushCallbacks();
  const recorded = getJob(live, created.id);
  assert.equal(recorded.callback.ok, false);
  assert.equal(recorded.callback.error, "blocked");
  assert.equal(lookups, 1);
});

test("callback errors are fixed codes with no socket detail", async () => {
  const secret = "rfcb_test_secret";
  const refused = await deliverCallback(
    { id: "job-refused", status: "done", callbackUrl: "http://127.0.0.1:9/hook", events: [] },
    { ...loopback, secret },
  );
  assert.equal(refused.error, "connect_failed");
  assert.doesNotMatch(refused.error, /127\.0\.0\.1|:[0-9]/);
  const missing = await deliverCallback(
    { id: "job-dns", status: "done", callbackUrl: "https://missing.example/cb", events: [] },
    { secret, lookup: async () => { throw Object.assign(new Error("getaddrinfo ENOTFOUND missing.example"), { code: "ENOTFOUND" }); } },
  );
  assert.equal(missing.error, "dns_failed");
  const timed = await deliverCallback(
    { id: "job-dns-timeout", status: "done", callbackUrl: "https://slow.example/cb", events: [] },
    { secret, lookup: () => new Promise(() => {}), dnsTimeoutMs: 30 },
  );
  assert.equal(timed.error, "dns_failed");
  const sockets = new Set();
  const tcp = createTcpServer((socket) => sockets.add(socket));
  await new Promise((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  try {
    const port = tcp.address().port;
    const hung = await deliverCallback(
      { id: "job-timeout", status: "done", callbackUrl: `http://127.0.0.1:${port}/hook`, events: [] },
      { ...loopback, secret, timeoutMs: 40 },
    );
    assert.equal(hung.error, "timeout");
    assert.doesNotMatch(hung.error, /127\.0\.0\.1/);
    assert.equal(hung.error.includes(String(port)), false);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (tcp.listening) await new Promise((resolve) => tcp.close(resolve));
  }
});

async function settleQuiet(state, deps, job, body, opts) {
  return settleJob(job.id, "complete", { announce: false, ...body }, caller, deps, opts);
}

test("a queued callback is signed when its slot opens", async () => {
  const state = emptyState();
  const { deps } = harness(state, async () => ({ offline: true }));
  let now = 1_700_000_000_000;
  const seen = [];
  const gates = [];
  deps.deliverCallback = async (job, opts) => {
    seen.push({ host: new URL(job.callbackUrl).hostname, ts: opts.timestamp });
    if (job.callbackUrl.includes("hold")) await new Promise((resolve) => gates.push(resolve));
    return { ok: true, status: 204, at: new Date().toISOString() };
  };
  const opts = { now: () => now, retryDelaysMs: [] };
  try {
    for (let i = 0; i < 3; i++) {
      const hold = await createJob(state, { target: "build", brief: `hold ${i}`, callbackUrl: `https://hold${i}.example/cb` }, caller);
      void settleQuiet(state, deps, hold, { result: "hold" }, opts);
    }
    for (let i = 0; i < 50 && seen.length < 3; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(seen.length, 3);
    const scheduledAt = String(Math.floor(now / 1000));
    const subject = await createJob(state, { target: "build", brief: "later", callbackUrl: "https://subject.example/cb" }, caller);
    await settleQuiet(state, deps, subject, { result: "done" }, opts);
    now += 400_000;
    gates.shift()();
    for (let i = 0; i < 50 && seen.length < 4; i++) await new Promise((r) => setTimeout(r, 10));
    const sent = seen.find((row) => row.host === "subject.example");
    assert.equal(sent.ts, String(Math.floor(now / 1000)));
    assert.notEqual(sent.ts, scheduledAt);
  } finally {
    for (const release of gates) release();
    await flushCallbacks();
  }
});

test("needs_human and done callbacks keep the body from schedule time", async () => {
  const state = emptyState();
  const { deps } = harness(state, async () => ({ offline: true }));
  const seen = [];
  const gates = [];
  deps.deliverCallback = async (job) => {
    seen.push({ id: job.id, status: job.status, result: job.result, host: new URL(job.callbackUrl).hostname });
    if (job.callbackUrl.includes("hold")) await new Promise((resolve) => gates.push(resolve));
    return { ok: true, status: 204, at: new Date().toISOString() };
  };
  try {
    for (let i = 0; i < 3; i++) {
      const hold = await createJob(state, { target: "build", brief: `hold ${i}`, callbackUrl: `https://hold${i}.example/cb` }, caller);
      void settleQuiet(state, deps, hold, { result: "hold" }, { retryDelaysMs: [] });
    }
    for (let i = 0; i < 50 && seen.length < 3; i++) await new Promise((r) => setTimeout(r, 10));
    const subject = await createJob(state, { target: "build", brief: "ask", callbackUrl: "https://subject.example/cb" }, caller);
    await settleQuiet(state, deps, subject, { status: "needs_human", result: "question" }, { retryDelaysMs: [] });
    await settleQuiet(state, deps, subject, { status: "done", result: "answer" }, { retryDelaysMs: [] });
    for (const release of gates) release();
    gates.length = 0;
    await flushCallbacks();
    const bodies = seen.filter((row) => row.id === subject.id);
    assert.deepEqual(bodies.map((row) => row.status), ["needs_human", "done"]);
    assert.deepEqual(bodies.map((row) => row.result), ["question", "answer"]);
  } finally {
    for (const release of gates) release();
    await flushCallbacks();
  }
});

test("the callback queue records callback_queue_full and does not send", async () => {
  const state = emptyState();
  const { deps } = harness(state, async () => ({ offline: true }));
  let started = 0;
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const hosts = [];
  deps.deliverCallback = async (job) => {
    started += 1;
    hosts.push(new URL(job.callbackUrl).hostname);
    await gate;
    return { ok: true, status: 204, at: new Date().toISOString() };
  };
  const jobs = [];
  try {
    for (let i = 0; i < 1004; i++) {
      const created = await createJob(
        state,
        { target: "build", brief: `q${i}`, callbackUrl: `https://q${i}.example/cb` },
        { ...caller, tokenId: `tok-q-${i}` },
      );
      jobs.push(created);
      void settleQuiet(state, deps, created, { result: "ok" }, { retryDelaysMs: [] });
    }
    for (let i = 0; i < 50 && started < 3; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(started, 3);
    const overflow = getJob(state, jobs[1003].id);
    assert.equal(overflow.callback.ok, false);
    assert.equal(overflow.callback.error, "callback_queue_full");
    assert.equal(hosts.includes("q1003.example"), false);
  } finally {
    release();
    await flushCallbacks();
  }
});

test("at most three callback deliveries run at once", async () => {
  const state = emptyState();
  const started = [];
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { deps } = harness(state, async () => ({ offline: true }));
  deps.deliverCallback = async (job) => {
    started.push(new URL(job.callbackUrl).hostname);
    await gate;
    return { ok: true, status: 204, at: new Date().toISOString() };
  };
  try {
    for (let i = 0; i < 4; i++) {
      const created = await createJob(state, { target: "build", brief: `b${i}`, callbackUrl: `https://slot${i}.example/cb` }, caller);
      void settleQuiet(state, deps, created, { result: "ok" }, { retryDelaysMs: [] });
    }
    for (let i = 0; i < 50 && started.length < 3; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(started.length, 3);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(started.length, 3);
    release();
    await flushCallbacks();
    assert.equal(started.length, 4);
  } finally {
    release();
    await flushCallbacks();
  }
});

test("a hanging host does not delay another host beyond one slot", async () => {
  const state = emptyState();
  const { deps } = harness(state, async () => ({ offline: true }));
  const started = [];
  const gates = new Map();
  let stop = false;
  deps.deliverCallback = async (job) => {
    const host = new URL(job.callbackUrl).hostname;
    started.push(host);
    if (host !== "fast.example" && !stop) {
      await new Promise((resolve) => {
        const list = gates.get(host) || [];
        list.push(resolve);
        gates.set(host, list);
      });
    }
    return { ok: true, status: 204, at: new Date().toISOString() };
  };
  const mk = async (host, brief) => {
    const job = await createJob(state, { target: "build", brief, callbackUrl: `https://${host}/cb` }, caller);
    void settleQuiet(state, deps, job, { result: brief }, { retryDelaysMs: [] });
    return job;
  };
  try {
    await mk("h1.example", "h1");
    await mk("h2.example", "h2");
    await mk("h3.example", "h3");
    for (let i = 0; i < 50 && started.length < 3; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(started.length, 3);
    const extra = await mk("h1.example", "h1-again");
    const fast = await mk("fast.example", "fast");
    const began = Date.now();
    gates.get("h2.example").shift()();
    for (let i = 0; i < 50 && !getJob(state, fast.id).callback; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(Date.now() - began < 1000);
    assert.equal(getJob(state, fast.id).callback.ok, true);
    assert.equal(started.filter((host) => host === "h1.example").length, 1);
    assert.equal(getJob(state, extra.id).callback, null);
    assert.ok(started.includes("fast.example"));
  } finally {
    stop = true;
    for (const list of gates.values()) for (const release of list) release();
    await flushCallbacks();
  }
});

test("a queued callback checks the cooldown again when its slot opens", async () => {
  const state = emptyState();
  const { deps } = harness(state, async () => ({ offline: true }));
  let calls = 0;
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  deps.deliverCallback = async () => {
    calls += 1;
    await gate;
    return { ok: false, error: "timeout", at: new Date().toISOString() };
  };
  const jobs = [];
  try {
    for (let i = 0; i < 4; i++) {
      const job = await createJob(state, { target: "build", brief: `c${i}`, callbackUrl: "https://cool.example/cb" }, caller);
      jobs.push(job);
      void settleQuiet(state, deps, job, { result: "ok" }, { retryDelaysMs: [] });
    }
    for (let i = 0; i < 50 && calls < 1; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1);
    release();
    await flushCallbacks();
    assert.equal(calls, 3);
    assert.equal(getJob(state, jobs[3].id).callback.error, "timeout");
  } finally {
    release();
    await flushCallbacks();
  }
});

test("each host:port queue stops at 50 and another port still runs", async () => {
  const state = emptyState();
  const { deps } = harness(state, async () => ({ offline: true }));
  const started = [];
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  deps.deliverCallback = async (job) => {
    started.push(new URL(job.callbackUrl).port || "443");
    await gate;
    return { ok: true, status: 204, at: new Date().toISOString() };
  };
  const jobs = [];
  try {
    for (let i = 0; i < 52; i++) {
      const job = await createJob(
        state,
        { target: "build", brief: `p${i}`, callbackUrl: "https://ports.example/cb" },
        { ...caller, tokenId: `tok-p-${i}` },
      );
      jobs.push(job);
      void settleQuiet(state, deps, job, { result: "ok" }, { retryDelaysMs: [] });
    }
    const other = await createJob(
      state,
      { target: "build", brief: "other-port", callbackUrl: "https://ports.example:8443/cb" },
      { ...caller, tokenId: "tok-other-port" },
    );
    void settleQuiet(state, deps, other, { result: "ok" }, { retryDelaysMs: [] });
    for (let i = 0; i < 50 && started.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(started.filter((port) => port === "443").length, 1);
    assert.ok(started.includes("8443"));
    assert.equal(getJob(state, jobs[51].id).callback.error, "callback_queue_full");
    assert.equal(getJob(state, other.id).callback, null);
  } finally {
    release();
    await flushCallbacks();
  }
});

test("one token can queue 100 callbacks and the next is callback_queue_full", async () => {
  const state = emptyState();
  const { deps } = harness(state, async () => ({ offline: true }));
  let started = 0;
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  deps.deliverCallback = async () => {
    started += 1;
    await gate;
    return { ok: true, status: 204, at: new Date().toISOString() };
  };
  const mine = { ...caller, tokenId: "tok-cap" };
  const jobs = [];
  try {
    for (let i = 0; i < 104; i++) {
      const job = await createJob(state, { target: "build", brief: `u${i}`, callbackUrl: `https://user${i}.example/cb` }, mine);
      jobs.push(job);
      void settleQuiet(state, deps, job, { result: "ok" }, { retryDelaysMs: [] });
    }
    const other = await createJob(
      state,
      { target: "build", brief: "someone else", callbackUrl: "https://someone.example/cb" },
      { ...caller, userId: "usr-2", tokenId: "tok-other" },
    );
    void settleQuiet(state, deps, other, { result: "waiting" }, { retryDelaysMs: [] });
    for (let i = 0; i < 50 && started < 3; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(started, 3);
    assert.equal(getJob(state, jobs[103].id).callback.error, "callback_queue_full");
    assert.equal(getJob(state, other.id).callback, null);
  } finally {
    release();
    await flushCallbacks();
  }
});

test("a DNS lookup timeout stays dns_failed and cools down that host:port", async () => {
  const state = emptyState();
  const { deps } = harness(state, async () => ({ offline: true }));
  delete deps.deliverCallback;
  let lookups = 0;
  const lookup = () => {
    lookups += 1;
    return new Promise(() => {});
  };
  const opts = { lookup, dnsTimeoutMs: 20, retryDelaysMs: [] };
  for (let i = 0; i < 3; i++) {
    const job = await createJob(state, { target: "build", brief: `d${i}`, callbackUrl: "https://dns-cool.example/cb" }, caller);
    await settleQuiet(state, deps, job, { result: "ok" }, opts);
    await flushCallbacks();
    assert.equal(getJob(state, job.id).callback.error, "dns_failed");
  }
  assert.equal(lookups, 3);
  const parked = await createJob(state, { target: "build", brief: "d3", callbackUrl: "https://dns-cool.example/cb" }, caller);
  await settleQuiet(state, deps, parked, { result: "ok" }, opts);
  assert.equal(lookups, 3);
  assert.equal(getJob(state, parked.id).callback.error, "timeout");
  const otherPort = await createJob(state, { target: "build", brief: "d4", callbackUrl: "https://dns-cool.example:8443/cb" }, caller);
  await settleQuiet(state, deps, otherPort, { result: "ok" }, opts);
  await flushCallbacks();
  assert.equal(lookups, 4);
  assert.equal(getJob(state, otherPort.id).callback.error, "dns_failed");
});

test("callback DNS timeout is clamped to 30s", () => {
  assert.equal(callbackDnsTimeoutMs({}), DEFAULT_CALLBACK_DNS_TIMEOUT_MS);
  assert.equal(callbackDnsTimeoutMs({ ROSTER_CALLBACK_DNS_TIMEOUT_MS: "60000" }), MAX_CALLBACK_DNS_TIMEOUT_MS);
  assert.equal(callbackDnsTimeoutMs({ ROSTER_CALLBACK_DNS_TIMEOUT_MS: "1500" }), 1500);
  assert.equal(callbackDnsTimeoutMs({}, 120000), MAX_CALLBACK_DNS_TIMEOUT_MS);
});

test("reading an old callback error drops the socket address", async () => {
  const state = emptyState();
  const job = await createJob(state, { target: "build", brief: "old", callbackUrl: "https://hooks.example/cb" }, caller);
  state.jobs[0].callback = {
    ok: false,
    status: null,
    error: "connect ECONNREFUSED 10.0.0.8:54321",
    at: "2026-04-11T12:00:00.000Z",
  };
  const pub = getJob(state, job.id);
  assert.equal(pub.callback.error, "connect_failed");
  assert.equal(JSON.stringify(pub).includes("10.0.0.8"), false);
  assert.equal(JSON.stringify(pub).includes("54321"), false);
});

test("a host that keeps timing out fails fast", async () => {
  const state = emptyState();
  const { deps } = harness(state, async () => ({ offline: true }));
  let calls = 0;
  deps.deliverCallback = async () => {
    calls += 1;
    return { ok: false, error: "timeout", at: new Date().toISOString() };
  };
  const host = "breaker.example";
  for (let i = 0; i < 3; i++) {
    const job = await createJob(state, { target: "build", brief: `t${i}`, callbackUrl: `https://${host}/cb` }, caller);
    await settleQuiet(state, deps, job, { result: "ok" }, { retryDelaysMs: [] });
    await flushCallbacks();
  }
  assert.equal(calls, 3);
  const parked = await createJob(state, { target: "build", brief: "t3", callbackUrl: `https://${host}/cb` }, caller);
  await settleQuiet(state, deps, parked, { result: "ok" }, { retryDelaysMs: [] });
  assert.equal(calls, 3);
  assert.equal(getJob(state, parked.id).callback.error, "timeout");
});

test("callback DNS lookup times out", async () => {
  const started = Date.now();
  await assert.rejects(
    normalizeCallback("https://hooks.example/cb", { lookup: () => new Promise(() => {}), dnsTimeoutMs: 40 }),
    (e) => e.status === 400 && /lookup timed out/.test(e.message),
  );
  assert.ok(Date.now() - started < 2000);
});

test("rotation grace accepts the previous secret until the window ends", () => {
  const state = emptyState();
  const t0 = Date.now();
  const first = ensureCallbackSecret(state, {}, t0);
  const jobId = "job-grace";
  const body = JSON.stringify({ event: "job.status", job: { id: jobId, status: "done" } });
  const ts = String(Math.floor(t0 / 1000));
  const headers = {
    [CALLBACK_HEADERS.timestamp]: ts,
    [CALLBACK_HEADERS.jobId]: jobId,
    [CALLBACK_HEADERS.signature]: signCallback(first, ts, jobId, body),
  };
  const rotated = rotateCallbackSecret(state, { ROSTER_CALLBACK_GRACE_MS: "1000" }, t0);
  assert.equal(rotated.previous.secret, first);
  assert.equal(new Date(rotated.previous.until).getTime(), t0 + 1000);
  assert.equal(verifyCallback(rotated.secret, headers, body, { now: t0 + 500 }), false);
  assert.equal(verifyCallback(rotated.secret, headers, body, { previous: rotated.previous, now: t0 + 500 }), true);
  assert.equal(verifyCallback(rotated.secret, headers, body, { previous: rotated.previous, now: t0 + 1500 }), false);
  assert.equal(callbackSecretInfo(state, {}, t0 + 1500).previous, null);

  const fresh = emptyState();
  ensureCallbackSecret(fresh, {}, t0);
  const full = rotateCallbackSecret(fresh, {}, t0);
  assert.equal(new Date(full.previous.until).getTime(), t0 + DEFAULT_CALLBACK_GRACE_MS);
  const none = emptyState();
  ensureCallbackSecret(none, {}, t0);
  const closed = rotateCallbackSecret(none, { ROSTER_CALLBACK_GRACE_MS: "0" }, t0);
  assert.equal(closed.previous, null);
});

test("callback delivery retries in the background and reuses the signature", async () => {
  const state = emptyState();
  const { deps } = harness(state, async () => ({ offline: true }));
  const stamps = [];
  let n = 0;
  deps.deliverCallback = async (job, opts) => {
    stamps.push(opts.timestamp);
    n += 1;
    if (n < 3) return { ok: false, error: "connect ECONNREFUSED", at: new Date().toISOString() };
    return { ok: true, status: 204, at: new Date().toISOString() };
  };
  const created = await createJob(state, { target: "build", brief: "x", callbackUrl: "http://127.0.0.1:9/hook" }, caller, loopback);
  const done = await settleJob(created.id, "complete", { result: "ok" }, caller, deps, { retryDelaysMs: [0, 0] });
  assert.equal(done.callback, null);
  await flushCallbacks();
  assert.equal(n, 3);
  assert.equal(new Set(stamps).size, 1);
  assert.equal(getJob(state, created.id).callback.ok, true);
});

test("normalized IPv6 allowlist entries match, and 0.0.0.0/8 stays blocked when listed", async () => {
  const env = { ROSTER_CALLBACK_ALLOWLIST: "2001:0db8:0000:0000:0000:0000:0000:1" };
  assert.equal(await normalizeCallback("http://[2001:db8::1]/cb", { env }), "http://[2001:db8::1]/cb");
  await assert.rejects(
    normalizeCallback("http://0.8.8.8/cb", { env: { ROSTER_CALLBACK_ALLOWLIST: "0.8.8.8" } }),
    (e) => e.status === 400 && /blocked/.test(e.message),
  );
});

test("startup warns that *.host allowlist entries never match", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-wild-"));
  const child = spawn(process.execPath, [join(repoRoot, "server/index.mjs")], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      ROSTER_CALLBACK_ALLOWLIST: "*.hooks.example, hooks.internal:443",
      ROSTER_CALLBACK_SECRET: "",
      ROSTER_SKIP_ONBOARDING: "1",
      ROSTER_API_HOST: "127.0.0.1",
      ROSTER_API_PORT: String(21000 + Math.floor(Math.random() * 20000)),
      ROSTER_DATA_DIR: join(dir, "data"),
      ROSTER_OPENCODE_DIR: join(dir, "oc"),
      ROSTER_WORKSPACE: join(dir, "ws"),
      ROSTER_HARNESS_AUTOSTART: "0",
      ROSTER_DISABLE_ROUTINES: "1",
      OPENCODE_BIN: "/nonexistent/opencode",
      HOME: dir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const kill = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  };
  try {
    const start = Date.now();
    while (!/never matches/.test(stderr)) {
      if (Date.now() - start > 8000) throw new Error(`no wildcard warning in: ${stderr}`);
      if (child.exitCode != null) throw new Error(`core exited ${child.exitCode}: ${stderr}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.match(stderr, /\*\.hooks\.example/);
  } finally {
    kill();
    await Promise.race([
      new Promise((resolve) => {
        if (child.exitCode != null) resolve();
        else child.once("exit", resolve);
      }),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    rmSync(dir, { recursive: true, force: true });
  }
});
