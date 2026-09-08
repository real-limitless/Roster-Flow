import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "./seed.mjs";
import { getState } from "./store.mjs";
import { assistantText, sessionTranscript, bindSessionMeta } from "./harness.mjs";
import { collectWakeTargets, implicitTargets, mirrorTranscript, providerHint, routeChannelMessage, deps } from "./chat.mjs";
import { emit, listTrace, resetTrace } from "./trace.mjs";

test("implicit targets cover channel, team, project, and DM rooms", () => {
  const state = emptyState();
  assert.deepEqual(
    implicitTargets("ship", state).map((t) => t.to),
    ["channel"],
  );
  assert.deepEqual(
    implicitTargets("team-eng", state).map((t) => t.to),
    ["team:eng"],
  );
  assert.deepEqual(
    implicitTargets("project-billing", state).map((t) => t.to),
    ["product"],
  );
  assert.deepEqual(
    implicitTargets("dm-build", state).map((t) => t.to),
    ["build"],
  );
  assert.deepEqual(implicitTargets("dm-maya", state), []);
});

test("collectWakeTargets uses mentions when present and implicit otherwise", () => {
  const state = emptyState();
  const mentioned = collectWakeTargets("ship", "please ask @eng and @Eng.Build", state);
  assert.ok(mentioned.targets.some((t) => t.to === "team:eng"));
  assert.ok(mentioned.targets.some((t) => t.to === "build"));
  assert.ok(!mentioned.targets.some((t) => t.to === "channel"));

  const plain = collectWakeTargets("ship", "hello there", state);
  assert.deepEqual(
    plain.targets.map((t) => t.to),
    ["channel"],
  );
});

test("routeChannelMessage posts a system line when harness cannot start", async () => {
  const prev = { ...deps };
  resetTrace();
  deps.harnessStatus = () => ({ harness: "offline" });
  deps.ensure = async () => {
    const err = new Error("OpenCode CLI is not installed");
    err.status = 409;
    throw err;
  };
  deps.wakeSeat = async () => ({ offline: true, seat: "channel" });
  deps.followTicks = 0;
  const before = getState().messages.length;
  try {
    const routed = routeChannelMessage({ channelId: "ship", text: "plain hello for routing" });
    assert.equal(routed.wakes, 1);
    await routed.pending;
    const added = getState().messages.slice(before);
    assert.ok(added.some((m) => /Starting |Harness offline/.test(m.text) && m.system));
    assert.ok(listTrace({ scope: "chat" }).some((e) => e.step === "chat.route" || e.step === "harness.error"));
  } finally {
    Object.assign(deps, prev);
  }
});

test("routeChannelMessage posts a key warning and does not wait for a model", async () => {
  const prev = { ...deps };
  resetTrace();
  deps.harnessStatus = () => ({ harness: "up" });
  deps.ensure = async () => ({ harness: "up" });
  deps.wakeSeat = async () => {
    throw new Error("wakeSeat should not run without a key");
  };
  deps.keyStatus = () => ({ providerID: "xai", modelID: "grok-4", configured: true, connected: false });
  deps.fallbackModel = () => null;
  deps.followTicks = 0;
  const before = getState().messages.length;
  try {
    const routed = routeChannelMessage({ channelId: "ship", text: "need a reply from Channel" });
    assert.equal(routed.wakes, 1);
    const immediate = getState().messages.slice(before);
    assert.ok(immediate.some((m) => /Waking Channel/.test(m.text) && m.system));
    assert.ok(immediate.some((m) => /No API key for xai/.test(m.text) && m.system));
    await routed.pending;
    const added = getState().messages.slice(before);
    assert.ok(listTrace({ scope: "chat" }).some((e) => e.step === "seat.nokey"));
  } finally {
    Object.assign(deps, prev);
  }
});

test("routeChannelMessage falls back to a connected OpenCode model", async () => {
  const prev = { ...deps };
  resetTrace();
  deps.harnessStatus = () => ({ harness: "up" });
  deps.ensure = async () => ({ harness: "up" });
  let woke = null;
  deps.wakeSeat = async (to) => {
    woke = to;
    return { sessionId: "ses_fb", seat: to };
  };
  deps.pullAssistant = async () => [{ id: `a-${Date.now()}`, text: "Fallback supervisor is awake." }];
  deps.keyStatus = () => ({ providerID: "xai", modelID: "grok-4", configured: false, connected: false });
  deps.fallbackModel = () => ({ providerID: "infiniterouter-dev", modelID: "big-pickle", connected: true });
  deps.followTicks = 1;
  deps.followDelayMs = 0;
  const before = getState().messages.length;
  try {
    const routed = routeChannelMessage({ channelId: "ship", text: "hi from fallback test" });
    assert.equal(routed.wakes, 1);
    await routed.pending;
    assert.equal(woke, "channel");
    const added = getState().messages.slice(before);
    assert.ok(added.some((m) => /Using infiniterouter-dev\/big-pickle/.test(m.text) && m.system));
    assert.ok(added.some((m) => m.text === "Fallback supervisor is awake."));
  } finally {
    Object.assign(deps, prev);
  }
});

test("mirrorTranscript skips wake prompts and does not duplicate", () => {
  const channel = `test-mirror-${Date.now()}`;
  const first = mirrorTranscript(channel, "build", [
    { id: "u1", role: "user", text: "You are Eng.Build (Implement) on the Roster-flow org chart.\nJob: Own a worktree." },
    { id: "a1", role: "assistant", text: "Working the webhook." },
  ]);
  assert.equal(first.length, 1);
  assert.equal(first[0].text, "Working the webhook.");
  const again = mirrorTranscript(channel, "build", [{ id: "a1", role: "assistant", text: "Working the webhook." }]);
  assert.equal(again.length, 0);
});

test("assistantText reads nested OpenCode message shapes", () => {
  const parts = assistantText([
    { info: { role: "assistant", id: "m1" }, parts: [{ type: "output_text", text: "Ready." }] },
    { role: "user", parts: [{ type: "text", text: "hi" }] },
    { role: "assistant", content: [{ type: "text", text: "Also this." }] },
  ]);
  assert.deepEqual(
    parts.map((p) => p.text),
    ["Ready.", "Also this."],
  );
  const transcript = sessionTranscript([
    { role: "user", parts: [{ type: "text", text: "hi" }] },
    { role: "assistant", parts: [{ type: "text", text: "yo" }] },
  ]);
  assert.equal(transcript.length, 2);
});

test("bindSessionMeta maps roster titles and stored session ids", () => {
  const state = emptyState();
  state.sessions = { build: "ses_1" };
  state.sessionRooms = { build: "ship" };
  const bound = bindSessionMeta({ id: "ses_1", title: "roster:build" }, "company", state);
  assert.equal(bound.seatId, "build");
  assert.equal(bound.channel, "ship");
  assert.equal(bound.harness, "company");
});

test("providerHint explains a missing seat key", () => {
  const prev = deps.keyStatus;
  deps.keyStatus = () => ({ providerID: "xai", modelID: "grok-4", configured: true, connected: false });
  try {
    const hint = providerHint({ name: "Channel", model: "xai/grok-4" });
    assert.match(hint, /No API key for xai/);
    assert.match(hint, /Channel/);
  } finally {
    deps.keyStatus = prev;
  }
});

test("trace ring keeps newest events", () => {
  resetTrace();
  emit({ step: "one", scope: "chat" });
  emit({ step: "two", scope: "architect", level: "error" });
  const all = listTrace();
  assert.equal(all.length, 2);
  assert.equal(all[1].step, "two");
});
