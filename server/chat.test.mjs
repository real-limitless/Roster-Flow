import assert from "node:assert/strict";
import test, { before, beforeEach } from "node:test";
import { emptyState, migrateState } from "./seed.mjs";
import { getState, mutate, save } from "./store.mjs";
import { assistantText, sessionTranscript, bindSessionMeta } from "./harness.mjs";
import {
  collectWakeTargets,
  followChannel,
  implicitTargets,
  mirrorTranscript,
  providerHint,
  quietRoom,
  resetChatRuntime,
  routeBotReply,
  routeChannelMessage,
  seatModelPlan,
  deps,
} from "./chat.mjs";
import { emit, listTrace, resetTrace } from "./trace.mjs";

// A fresh data dir boots without a company until onboarding; these tests need the starter seats.
before(() => {
  if (!getState().seats?.some((seat) => seat.id === "channel")) mutate(() => emptyState());
});

beforeEach(() => resetChatRuntime());

test("implicit targets cover channel, team, project, and DM rooms", () => {
  const state = emptyState();
  assert.deepEqual(
    implicitTargets("general", state).map((t) => t.to),
    ["channel"],
  );
  assert.deepEqual(implicitTargets("ship", state)[0].candidates.slice(0, 2), ["product", "devops"]);
  assert.equal(implicitTargets("ship", state)[0].reason, "implicit");
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

  const plain = collectWakeTargets("general", "hello there", state);
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
    const routed = routeChannelMessage({ channelId: "general", text: "plain hello for routing" });
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
    const routed = routeChannelMessage({ channelId: "general", text: "need a reply from Channel" });
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
    const routed = routeChannelMessage({ channelId: "general", text: "hi from fallback test" });
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
  const a1 = `a1-${Date.now()}`;
  const first = mirrorTranscript(channel, "build", [
    { id: `u1-${Date.now()}`, role: "user", text: "You are Eng.Build (Implement) on the Roster-flow org chart.\nJob: Own a worktree." },
    { id: a1, role: "assistant", text: "Working the webhook." },
  ]);
  assert.equal(first.length, 1);
  assert.equal(first[0].text, "Working the webhook.");
  const again = mirrorTranscript(channel, "build", [{ id: a1, role: "assistant", text: "Working the webhook." }]);
  assert.equal(again.length, 0);
  const elsewhere = mirrorTranscript(`${channel}-other`, "build", [{ id: a1, role: "assistant", text: "Working the webhook." }]);
  assert.equal(elsewhere.length, 0);
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

function stubAwake(overrides = {}) {
  const calls = [];
  deps.harnessStatus = () => ({ harness: "up" });
  deps.ensure = async () => ({ harness: "up" });
  deps.loadedModels = async () => null;
  deps.knownLoadedModels = () => null;
  deps.keyStatus = (model) => ({ providerID: String(model).split("/")[0], modelID: "m", configured: true, connected: true, loaded: null });
  deps.pullFailure = async () => null;
  deps.followTicks = 2;
  deps.followDelayMs = 0;
  deps.wakeSeat = async (to, text, meta) => {
    calls.push({ to, text, meta });
    return { sessionId: `ses-${to}`, seat: to, runId: `run-${calls.length}`, started: true };
  };
  Object.assign(deps, overrides);
  return calls;
}

function withChannelPatch(id, patch) {
  const ch = getState().channels.find((c) => c.id === id);
  const before = { ...ch, seatIds: [...ch.seatIds], teamIds: [...ch.teamIds] };
  Object.assign(ch, patch);
  return () => {
    for (const key of Object.keys(patch)) if (!(key in before)) delete ch[key];
    Object.assign(ch, before);
    save();
  };
}

test("Anyone here in #general wakes the fallback seat and mirrors its plain-text reply into #general", async () => {
  const prev = { ...deps };
  resetTrace();
  const replyId = `msg-anyone-${Date.now()}`;
  const calls = stubAwake({
    pullAssistant: async () => [{ id: replyId, text: "Yes, Channel here. What do you need?", created: Date.now() + 10 }],
  });
  try {
    const routed = routeChannelMessage({ channelId: "general", text: "Anyone here" });
    assert.equal(routed.wakes, 1);
    const started = await routed.started;
    assert.equal(started[0].started, true);
    await routed.pending;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, "channel");
    assert.equal(calls[0].meta.kind, "implicit");
    assert.equal(calls[0].meta.channel, "general");
    const reply = getState().messages.find((m) => m.sessionId === replyId);
    assert.equal(reply?.channel, "general");
    assert.equal(reply?.seatId, "channel");
    assert.ok(listTrace({ scope: "chat" }).some((e) => e.step === "seat.reply" && e.channel === "general"));
  } finally {
    Object.assign(deps, prev);
  }
});

test("a channel lead answers un-mentioned messages", async () => {
  const prev = { ...deps };
  const restore = withChannelPatch("ship", { leadSeatId: "build" });
  const calls = stubAwake({ pullAssistant: async () => [] , followTicks: 0 });
  try {
    const routed = routeChannelMessage({ channelId: "ship", text: "status?" });
    await routed.pending;
    assert.equal(calls[0].to, "build");
  } finally {
    restore();
    Object.assign(deps, prev);
  }
});

test("a paused lead is skipped with one System line and the next seat answers", async () => {
  const prev = { ...deps };
  const restore = withChannelPatch("ship", { leadSeatId: "build" });
  const build = getState().seats.find((s) => s.id === "build");
  const was = { status: build.status, pauseReason: build.pauseReason };
  build.status = "paused";
  build.pauseReason = "owner";
  const calls = stubAwake({ pullAssistant: async () => [], followTicks: 0 });
  const before = getState().messages.length;
  try {
    const routed = routeChannelMessage({ channelId: "ship", text: "who is on?" });
    await routed.pending;
    assert.equal(calls[0].to, "product");
    const skips = getState().messages.slice(before).filter((m) => m.system && /^Skipped /.test(m.text));
    assert.equal(skips.length, 1);
    assert.match(skips[0].text, /Eng\.Build \(paused\)/);
  } finally {
    Object.assign(build, was);
    restore();
    save();
    Object.assign(deps, prev);
  }
});

test("when no candidate has a usable model the first one reports why and nothing is sent", async () => {
  const prev = { ...deps };
  const calls = stubAwake({
    keyStatus: () => ({ providerID: "xai", modelID: "grok-4", configured: true, connected: false }),
    fallbackModel: () => null,
  });
  const before = getState().messages.length;
  try {
    const routed = routeChannelMessage({ channelId: "general", text: "Anyone here" });
    const results = await routed.pending;
    assert.equal(calls.length, 0);
    assert.equal(results[0].nokey, true);
    assert.ok(getState().messages.slice(before).some((m) => m.system && /No API key for xai/.test(m.text)));
  } finally {
    Object.assign(deps, prev);
  }
});

test("an un-mentioned post by a bot seat wakes nobody", async () => {
  const prev = { ...deps };
  const calls = stubAwake();
  try {
    const routed = routeChannelMessage({ channelId: "general", text: "status update", from: "build" });
    await routed.pending;
    assert.equal(routed.wakes, 0);
    assert.equal(calls.length, 0);
  } finally {
    Object.assign(deps, prev);
  }
});

test("followChannel ignores assistant messages created before the wake and posts each message id once", async () => {
  const prev = { ...deps };
  const channel = `since-${Date.now()}`;
  const old = { id: `msg-old-${Date.now()}`, text: "Reply meant for #ship.", created: Date.now() - 60_000 };
  const fresh = { id: `msg-new-${Date.now()}`, text: "Here.", created: Date.now() + 5 };
  deps.pullAssistant = async () => [old, fresh];
  deps.pullFailure = async () => null;
  deps.knownLoadedModels = () => null;
  deps.keyStatus = () => ({ providerID: "x", modelID: "m", configured: true, connected: true, loaded: null });
  deps.followDelayMs = 0;
  try {
    const replies = await followChannel(channel, ["channel"], 2, { since: Date.now() });
    assert.equal(replies, 1);
    const posted = getState().messages.filter((m) => m.channel === channel && !m.system);
    assert.deepEqual(posted.map((m) => m.text), ["Here."]);
    assert.equal(await followChannel(`${channel}-b`, ["channel"], 1, { since: 0 }), 1);
    assert.ok(!getState().messages.some((m) => m.channel === `${channel}-b` && m.text === "Here."));
  } finally {
    Object.assign(deps, prev);
  }
});

test("messages sent while the responder is answering are queued and delivered as one follow-up", async () => {
  const prev = { ...deps };
  let release;
  const gate = new Promise((r) => (release = r));
  const calls = stubAwake({ followTicks: 1 });
  deps.pullAssistant = async () => {
    await gate;
    return [];
  };
  try {
    const first = routeChannelMessage({ channelId: "general", text: "Anyone here" });
    await first.started;
    const second = routeChannelMessage({ channelId: "general", text: "hello?" });
    const third = routeChannelMessage({ channelId: "general", text: "ping" });
    assert.equal(second.queued, true);
    assert.equal(third.queued, true);
    assert.equal(calls.length, 1);
    deps.pullAssistant = async () => [];
    release();
    await first.pending;
    for (let i = 0; i < 50 && calls.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].to, "channel");
    assert.match(calls[1].text, /hello\?/);
    assert.match(calls[1].text, /ping/);
  } finally {
    Object.assign(deps, prev);
  }
});

test("a room in conductor mode sends un-mentioned posts to the Channel conductor", async () => {
  const prev = { ...deps };
  const restore = withChannelPatch("ship", { respond: "conductor", leadSeatId: "build" });
  const calls = stubAwake({ pullAssistant: async () => [], followTicks: 0 });
  try {
    const routed = routeChannelMessage({ channelId: "ship", text: "who owns this?" });
    await routed.pending;
    assert.deepEqual(calls.map((c) => c.to), ["channel"]);
    assert.equal(calls[0].meta.kind, "implicit");
  } finally {
    restore();
    Object.assign(deps, prev);
  }
});

test("a quiet room wakes nobody, notifies the other humans, and posts one System line", async () => {
  const prev = { ...deps };
  const restore = withChannelPatch("ship", { respond: "quiet" });
  const calls = stubAwake();
  const before = getState().messages.length;
  const busBefore = getState().bus.length;
  try {
    assert.equal(quietRoom("ship"), true);
    assert.equal(quietRoom("general"), false);
    const first = routeChannelMessage({ channelId: "ship", text: "fyi, deploy at 5" });
    const second = routeChannelMessage({ channelId: "ship", text: "and the docs too" });
    await first.pending;
    await second.pending;
    assert.equal(first.quiet, true);
    assert.equal(first.wakes, 0);
    assert.equal(calls.length, 0);
    assert.deepEqual(first.notify, ["maya"]);
    const notes = getState().bus.slice(busBefore).filter((b) => b.kind === "notify" && b.channel === "ship");
    assert.deepEqual(notes.map((b) => b.to), ["maya", "maya"]);
    const lines = getState().messages.slice(before).filter((m) => m.system && /This room is quiet/.test(m.text));
    assert.equal(lines.length, 1);
    const mentioned = routeChannelMessage({ channelId: "ship", text: "@build can you look?" });
    await mentioned.started;
    assert.deepEqual(calls.map((c) => c.to), ["build"]);
  } finally {
    restore();
    Object.assign(deps, prev);
  }
});

test("implicitPerMinute caps un-mentioned wakes per room with a single System line", async () => {
  const prev = { ...deps };
  const restore = withChannelPatch("general", { limits: { implicitPerMinute: 1 } });
  const calls = stubAwake({ pullAssistant: async () => [], followTicks: 0 });
  const before = getState().messages.length;
  try {
    const first = routeChannelMessage({ channelId: "general", text: "Anyone here" });
    await first.pending;
    const second = routeChannelMessage({ channelId: "general", text: "still there?" });
    const third = routeChannelMessage({ channelId: "general", text: "hello?" });
    assert.equal(second.rateLimited, true);
    assert.equal(third.rateLimited, true);
    assert.equal(calls.length, 1);
    const lines = getState().messages.slice(before).filter((m) => m.system && /^Rate limit:/.test(m.text));
    assert.equal(lines.length, 1);
    assert.match(lines[0].text, /1 un-mentioned message a minute/);
    const mentioned = routeChannelMessage({ channelId: "general", text: "@channel ping" });
    await mentioned.started;
    assert.equal(calls.length, 2);
  } finally {
    restore();
    Object.assign(deps, prev);
  }
});

test("team and project room records route un-mentioned posts to the supervisor and the PM first", () => {
  const state = migrateState(emptyState());
  const team = implicitTargets("team-eng", state)[0];
  assert.equal(team.reason, "implicit");
  assert.equal(team.to, "eng-supervisor");
  assert.ok(team.candidates.includes("build"));
  state.channels.push({ id: "project-billing", name: "Billing", teamIds: ["eng"], seatIds: ["channel", "you", "product"] });
  const project = implicitTargets("project-billing", state)[0];
  assert.equal(project.reason, "implicit");
  assert.equal(project.to, "product");
  const quiet = state.channels.find((c) => c.id === "team-eng");
  quiet.respond = "quiet";
  assert.deepEqual(implicitTargets("team-eng", state), []);
});

async function until(check, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const hit = check();
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

test("a bot reply that @mentions a room member wakes it at hop 1 and captions its reply", async () => {
  const prev = { ...deps };
  const stamp = Date.now();
  const replies = {
    product: [{ id: `p-hop-${stamp}`, text: "@build can you check the deploy?", created: stamp + 1000 }],
    build: [{ id: `b-hop-${stamp}`, text: "Deploy is green.", created: stamp + 1000 }],
  };
  const calls = stubAwake({ pullAssistant: async (seat) => replies[seat] || [] });
  try {
    const routed = routeChannelMessage({ channelId: "ship", text: "@product status?", messageId: `root-${stamp}` });
    await routed.pending;
    const buildReply = await until(() => getState().messages.find((m) => m.sessionId === `b-hop-${stamp}`));
    assert.deepEqual(calls.map((c) => c.to), ["product", "build"]);
    assert.equal(calls[0].meta.thread.hop, 0);
    assert.deepEqual(
      { hop: calls[1].meta.thread.hop, from: calls[1].meta.thread.from, threadId: calls[1].meta.thread.threadId },
      { hop: 1, from: "product", threadId: `root-${stamp}` },
    );
    assert.equal(buildReply?.channel, "ship");
    assert.deepEqual(buildReply.thread, { threadId: `root-${stamp}`, hop: 1, from: "product", maxHops: 4, botWakes: 1, maxBotWakes: 8 });
    const productReply = getState().messages.find((m) => m.sessionId === `p-hop-${stamp}`);
    assert.equal(productReply.thread.hop, 0);
  } finally {
    Object.assign(deps, prev);
  }
});

test("a bot reply past the room's hop limit posts a stop line instead of waking", async () => {
  const prev = { ...deps };
  const restore = withChannelPatch("ship", { limits: { maxHops: 1 } });
  const stamp = Date.now();
  const replies = {
    product: [{ id: `p-stop-${stamp}`, text: "@build over to you", created: stamp + 1000 }],
    build: [{ id: `b-stop-${stamp}`, text: "@product back to you", created: stamp + 1000 }],
  };
  const calls = stubAwake({ pullAssistant: async (seat) => replies[seat] || [] });
  try {
    const routed = routeChannelMessage({ channelId: "ship", text: "@product go", messageId: `root-stop-${stamp}` });
    await routed.pending;
    const stop = await until(() => getState().messages.find((m) => m.channel === "ship" && m.system && m.text === "Stopped: thread reached 1 hop."));
    assert.ok(stop, "stop line posted");
    assert.deepEqual(calls.map((c) => c.to), ["product", "build"]);
  } finally {
    restore();
    Object.assign(deps, prev);
  }
});

test("a mirrored reply with no recorded wake never routes its @mentions", () => {
  const calls = stubAwake();
  const prev = { ...deps };
  try {
    assert.equal(routeBotReply("ship", "product", { text: "@build hi" }), null);
    assert.equal(calls.length, 0);
  } finally {
    Object.assign(deps, prev);
  }
});
