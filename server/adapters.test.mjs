import assert from "node:assert/strict";
import test from "node:test";
import { deps as adapterDeps, adapterSecretOk, adapterWakePayload, isOpenCodeAdapter, normalizeAdapter, publicSeat, wakeAdapter } from "./adapters.mjs";
import { deps as busDeps, wakeSeat } from "./bus.mjs";
import { hireSeat } from "./seats.mjs";
import { emptyState, migrateState } from "./seed.mjs";
import { getState, mutate } from "./store.mjs";

test("starter seats default to the OpenCode adapter", () => {
  assert.equal(normalizeAdapter({}), "opencode");
  assert.equal(isOpenCodeAdapter({ id: "build" }), true);
  assert.equal(isOpenCodeAdapter({ adapter: "webhook" }), false);
});

test("publicSeat strips adapterSecret", () => {
  const out = publicSeat({ id: "hook", adapter: "webhook", adapterSecret: "s3cret", adapterUrl: "http://127.0.0.1:9/wake" });
  assert.equal(out.adapterSecret, undefined);
  assert.equal(out.hasAdapterSecret, true);
  assert.equal(out.adapterUrl, "http://127.0.0.1:9/wake");
});

test("webhook wake POSTs the bus payload with report/handoff callbacks", async () => {
  const posts = [];
  adapterDeps.fetchFn = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 202 };
  };
  mutate((s) => {
    Object.assign(s, migrateState(emptyState()));
    hireSeat(s, {
      name: "Hook Bot",
      adapter: "webhook",
      adapterUrl: "http://127.0.0.1:9999/wake",
      adapterSecret: "hook-secret",
      job: "BYO webhook specialist.",
    });
  });
  try {
    const result = await wakeSeat("hook-bot", "ship the webhook", { from: "product", kind: "handoff" });
    assert.equal(result.adapter, "webhook");
    assert.equal(result.notified, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "http://127.0.0.1:9999/wake");
    assert.equal(posts[0].body.seatId, "hook-bot");
    assert.match(posts[0].body.callbacks.report, /\/adapter\/report$/);
    assert.match(posts[0].body.callbacks.handoff, /\/adapter\/handoff$/);
    const seat = getState().seats.find((x) => x.id === "hook-bot");
    assert.equal(seat.lastAdapterWake.ok, true);
  } finally {
    adapterDeps.fetchFn = globalThis.fetch.bind(globalThis);
  }
});

test("OpenCode wake path is unchanged when adapter is omitted", async () => {
  const prompts = [];
  const prev = { ...busDeps };
  busDeps.harnessStatus = () => ({ harness: "up" });
  busDeps.createSession = async ({ title }) => ({ id: `ses_${title}` });
  busDeps.promptSession = async (id, body) => {
    prompts.push({ id, agent: body.agent });
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) {
      seat.status = "idle";
      delete seat.adapter;
    }
  });
  try {
    const result = await wakeSeat("build", "ship the webhook", { from: "product", kind: "handoff" });
    assert.ok(result.sessionId);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].agent, "build");
  } finally {
    Object.assign(busDeps, prev);
  }
});

test("adapterSecretOk accepts a matching bearer", () => {
  const seat = { adapterSecret: "hook-secret" };
  assert.equal(adapterSecretOk(seat, { headers: { authorization: "Bearer hook-secret" } }), true);
  assert.equal(adapterSecretOk(seat, { headers: { authorization: "Bearer nope" } }), false);
  assert.equal(adapterSecretOk({ adapterSecret: "" }, { headers: {} }), true);
});

test("claude-code adapter notifies without starting OpenCode", async () => {
  const prompts = [];
  const prev = { ...busDeps };
  busDeps.harnessStatus = () => ({ harness: "up" });
  busDeps.promptSession = async () => {
    prompts.push("nope");
  };
  mutate((s) => {
    Object.assign(s, migrateState(emptyState()));
    hireSeat(s, { name: "Opus Reviewer", adapter: "claude-code", job: "Claude Code chair." });
  });
  try {
    const result = await wakeSeat("opus-reviewer", "review the PR", { from: "you" });
    assert.equal(result.adapter, "claude-code");
    assert.equal(result.notified, true);
    assert.equal(prompts.length, 0);
    assert.match(result.hint, /Claude Code/);
  } finally {
    Object.assign(busDeps, prev);
  }
});

test("adapterWakePayload is a transport, not a runtime", () => {
  const payload = adapterWakePayload({ id: "hook-bot", name: "Hook", adapter: "webhook" }, "hi", { from: "you" });
  assert.ok(payload.callbacks.report);
  assert.equal(payload.adapter, "webhook");
});
