import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "./seed.mjs";
import { getState } from "./store.mjs";
import { assistantText, sessionTranscript, bindSessionMeta } from "./harness.mjs";
import {
  collectWakeTargets,
  followChannel,
  implicitTargets,
  mirrorTranscript,
  providerHint,
  routeChannelMessage,
  seatModelPlan,
  deps,
} from "./chat.mjs";
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
    const results = await routed.pending;
    assert.equal(woke, null);
    assert.equal(results[0].started, false);
    const added = getState().messages.slice(before);
    assert.ok(added.some((m) => /not in Settings/.test(m.text) && m.system));
    assert.ok(!added.some((m) => m.text === "Fallback supervisor is awake."));
  } finally {
    Object.assign(deps, prev);
  }
});

const BUILTIN_ONLY = [{ providerID: "opencode", modelID: "big-pickle" }];

/** keyStatus for a seat whose provider has a key; `loaded` decides the rest. */
function keyedStatus(providerID, modelID) {
  return (_model, loaded) => {
    const have = Array.isArray(loaded) ? loaded : null;
    return {
      providerID,
      modelID,
      configured: true,
      connected: true,
      loaded: have ? have.some((m) => m.providerID === providerID && m.modelID === modelID) : null,
      providerLoaded: have ? have.some((m) => m.providerID === providerID) : null,
      loadedProviders: have ? [...new Set(have.map((m) => m.providerID))] : [],
    };
  };
}

test("seatModelPlan falls back only to a model the serve loaded, and labels it", () => {
  const prev = { ...deps };
  const fallbackCalls = [];
  deps.keyStatus = keyedStatus("featherless", "Qwen/Qwen2.5-Coder-32B-Instruct");
  deps.fallbackModel = (loaded) => {
    fallbackCalls.push(loaded);
    return loaded?.some((m) => m.providerID === "infiniterouter-dev") ? { providerID: "infiniterouter-dev", modelID: "big-pickle" } : null;
  };
  const seat = { name: "Channel", model: "featherless/Qwen/Qwen2.5-Coder-32B-Instruct" };
  try {
    const unknown = seatModelPlan(seat, null);
    assert.equal(unknown.ok, true);
    assert.equal(unknown.fallback, false);
    assert.equal(unknown.model, seat.model);

    const loaded = [...BUILTIN_ONLY, { providerID: "infiniterouter-dev", modelID: "big-pickle" }];
    const assigned = seatModelPlan(seat, loaded);
    assert.equal(assigned.ok, false);
    assert.equal(assigned.fallback, false);
    assert.equal(assigned.model, seat.model);
    assert.match(assigned.hint, /featherless\/Qwen\/Qwen2\.5-Coder-32B-Instruct is not loaded by the harness \(loaded: opencode, infiniterouter-dev\)/);
    assert.equal(fallbackCalls.length, 0);

    const open = seatModelPlan({ name: "Channel", model: "" }, loaded);
    assert.equal(open.ok, true);
    assert.equal(open.fallback, true);
    assert.equal(open.model, "infiniterouter-dev/big-pickle");
    assert.match(open.hint, /no model assigned\. Using infiniterouter-dev\/big-pickle/);

    const none = seatModelPlan(seat, BUILTIN_ONLY);
    assert.equal(none.ok, false);
    assert.match(none.hint, /is not loaded by the harness \(loaded: opencode\)/);
  } finally {
    Object.assign(deps, prev);
  }
});

test("routeChannelMessage labels the Channel seat with the loaded fallback and wakes it", async () => {
  const prev = { ...deps };
  resetTrace();
  const loaded = [...BUILTIN_ONLY, { providerID: "infiniterouter-dev", modelID: "big-pickle" }];
  deps.harnessStatus = () => ({ harness: "up" });
  deps.ensure = async () => ({ harness: "up" });
  deps.loadedModels = async () => loaded;
  deps.knownLoadedModels = () => loaded;
  deps.keyStatus = keyedStatus("featherless", "Qwen/Qwen2.5-Coder-32B-Instruct");
  deps.fallbackModel = (l) => (l ? { providerID: "infiniterouter-dev", modelID: "big-pickle" } : null);
  let woke = null;
  deps.wakeSeat = async (to) => {
    woke = to;
    return { sessionId: "ses_loaded", seat: to };
  };
  deps.pullAssistant = async () => [{ id: `a-loaded-${Date.now()}`, text: "Loaded fallback reply." }];
  deps.pullFailure = async () => null;
  deps.followTicks = 1;
  deps.followDelayMs = 0;
  const channel = `loaded-${Date.now()}`;
  try {
    const routed = routeChannelMessage({ channelId: channel, text: "hi loaded" });
    await routed.pending;
    assert.equal(woke, null);
    const added = getState().messages.filter((m) => m.channel === channel);
    assert.ok(added.some((m) => m.system && /is not loaded by the harness \(loaded: opencode, infiniterouter-dev\)/.test(m.text)));
    assert.ok(!added.some((m) => m.text === "Loaded fallback reply."));
  } finally {
    Object.assign(deps, prev);
  }
});

test("routeChannelMessage does not wake a seat whose provider OpenCode did not load", async () => {
  const prev = { ...deps };
  resetTrace();
  deps.harnessStatus = () => ({ harness: "up" });
  deps.ensure = async () => ({ harness: "up" });
  deps.loadedModels = async () => BUILTIN_ONLY;
  deps.knownLoadedModels = () => BUILTIN_ONLY;
  deps.keyStatus = keyedStatus("featherless", "Qwen/Qwen2.5-Coder-32B-Instruct");
  deps.fallbackModel = () => null;
  deps.wakeSeat = async () => {
    throw new Error("wakeSeat should not run when the provider is not loaded");
  };
  deps.followTicks = 0;
  const channel = `notloaded-${Date.now()}`;
  try {
    const routed = routeChannelMessage({ channelId: channel, text: "hi not loaded" });
    const results = await routed.pending;
    assert.equal(results[0].nokey, true);
    const added = getState().messages.filter((m) => m.channel === channel);
    assert.ok(added.some((m) => m.system && /is not loaded by the harness \(loaded: opencode\)/.test(m.text)));
    assert.ok(listTrace({ scope: "chat" }).some((e) => e.step === "seat.nokey"));
  } finally {
    Object.assign(deps, prev);
  }
});

test("followChannel posts a provider 401 instead of waiting for a reply that never comes", async () => {
  const prev = { ...deps };
  resetTrace();
  const sinces = [];
  deps.pullAssistant = async () => [];
  deps.pullFailure = async (_seat, since) => {
    sinces.push(since);
    return { id: "a1:error", error: true, code: "PROVIDER_AUTH", text: "featherless rejected the API key (401): You must be signed in. Update the key in Settings → Providers, then send again." };
  };
  deps.knownLoadedModels = () => null;
  deps.followDelayMs = 0;
  const channel = `auth-${Date.now()}`;
  try {
    const replies = await followChannel(channel, ["channel"], 5, { since: 1234 });
    assert.equal(replies, 0);
    const added = getState().messages.filter((m) => m.channel === channel);
    assert.equal(added.length, 1);
    assert.match(added[0].text, /^Channel could not reply: featherless rejected the API key \(401\)/);
    assert.ok(!added.some((m) => /did not reply/.test(m.text)));
    assert.deepEqual(sinces, [1234]);
    assert.ok(listTrace({ scope: "chat" }).some((e) => e.step === "seat.failed" && e.detail.code === "PROVIDER_AUTH"));
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
