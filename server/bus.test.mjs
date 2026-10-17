import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncSeatAgent } from "./agents.mjs";
import { readOpenCodeConfig } from "./providers.mjs";
import { providerTurnVerdict } from "./harness.mjs";
import { blockLatestRun, roomForApiCall, SHIP_FALLBACK_NOTE, waitForIdleServe } from "./bus.mjs";
import { delegationLines, deps, isPass, meterChildren, meterTurn, pendingWake, postBus, promptBody, roomReplyLines, taskTitle, wakeSeat } from "./bus.mjs";
import { meterWake } from "./budget.mjs";
import { bootCore } from "./test-helpers.mjs";
import { liveRoomSession } from "./room-sessions.mjs";
import { getState, mutate } from "./store.mjs";

test("promptBody tells the seat which job to finish", () => {
  const text = promptBody(
    { name: "Eng.Build", role: "Implement", job: "Ship the PR", tools: ["read"], deny: [] },
    "build",
    "implement it",
    { from: "you", kind: "job", jobId: "job-1" },
    null,
  ).parts[0].text;
  assert.match(text, /job-1/);
  assert.match(text, /roster_report/);
});

test("promptBody asks an un-mentioned responder for a plain-text reply in that room", () => {
  const seat = { name: "Channel", role: "Conductor", job: "Conduct", tools: ["bus"], deny: [] };
  const text = promptBody(seat, "channel", "Anyone here", { from: "you", kind: "implicit", channel: "general" }, null).parts[0].text;
  assert.match(text, /A human wrote in #general without mentioning anyone/);
  assert.match(text, /Reply in plain text, briefly, as yourself\. Roster-flow posts your text to #general\./);
  assert.match(text, /Do not use roster_report for this reply/);
  assert.doesNotMatch(text, /Use roster_send_message \/ roster_handoff \/ roster_report to talk/);
  const mentioned = promptBody(seat, "channel", "@channel hi", { from: "you", kind: "mention-seat", channel: "ship" }, null).parts[0].text;
  assert.match(mentioned, /Reply in plain text\. Roster-flow posts your text to #ship\./);
  const mail = promptBody(seat, "channel", "hi", { from: "build", kind: "send_message" }, null).parts[0].text;
  assert.doesNotMatch(mail, /Reply in plain text/);
});

test("a seat with no model prompts the loaded fallback and writes it onto the agent", async () => {
  const prompts = [];
  const prev = { ...deps };
  const prevKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-key";
  let priorModel;
  let priorFallback;
  let priorTeamFallback;
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_fallback" });
  deps.loadedModels = async () => [{ providerID: "demo-llm", modelID: "demo-small" }];
  deps.promptSession = async (_id, body) => {
    prompts.push(body.model);
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
    const seat = (s.seats || []).find((x) => x.id === "build");
    const team = (s.teams || []).find((t) => t.id === "eng");
    if (team) {
      priorTeamFallback = team.fallbackModel;
      team.fallbackModel = "";
    }
    if (seat) {
      seat.status = "idle";
      priorModel = seat.model;
      priorFallback = seat.fallbackModel;
      seat.model = "";
      seat.fallbackModel = "";
    }
  });
  try {
    const result = await wakeSeat("build", "ship the webhook", { from: "product", kind: "handoff" });
    assert.equal(result.started, true);
    assert.deepEqual(prompts[0], { providerID: "demo-llm", modelID: "demo-small" });
  } finally {
    Object.assign(deps, prev);
    if (prevKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prevKey;
    mutate((s) => {
      const seat = (s.seats || []).find((x) => x.id === "build");
      const team = (s.teams || []).find((t) => t.id === "eng");
      if (seat) {
        seat.model = priorModel;
        seat.fallbackModel = priorFallback;
        syncSeatAgent(seat);
      }
      if (team) team.fallbackModel = priorTeamFallback;
    });
  }
});

test("providerTurnVerdict waits for a completed assistant turn and blockLatestRun leaves a success running", () => {
  const state = { userIds: new Set(), assistantIds: new Set() };
  const user = providerTurnVerdict(
    { type: "message.updated", properties: { sessionID: "s1", info: { id: "u1", role: "user" } } },
    "s1",
    state,
  );
  assert.equal(user, null);
  const echo = providerTurnVerdict(
    { type: "message.part.updated", properties: { sessionID: "s1", part: { type: "text", text: "ping", messageID: "u1" } } },
    "s1",
    state,
  );
  assert.equal(echo, null);
  const open = providerTurnVerdict(
    { type: "message.updated", properties: { sessionID: "s1", info: { id: "a1", role: "assistant", time: { created: 1 } } } },
    "s1",
    state,
  );
  assert.equal(open, null);
  const step = providerTurnVerdict(
    { type: "message.part.updated", properties: { sessionID: "s1", part: { type: "step-start", messageID: "a1" } } },
    "s1",
    state,
  );
  assert.equal(step.reached, true);
  assert.equal(step.done, false);
  const chunk = providerTurnVerdict(
    { type: "message.part.updated", properties: { sessionID: "s1", part: { type: "text", text: "stub-reply-ok", messageID: "a1" } } },
    "s1",
    state,
  );
  assert.equal(chunk.reached, true);
  assert.equal(chunk.done, false);
  assert.equal(chunk.text, "stub-reply-ok");
  const done = providerTurnVerdict(
    {
      type: "message.updated",
      properties: { sessionID: "s1", info: { id: "a1", role: "assistant", time: { created: 1, completed: 2 }, finish: "stop", providerID: "stub", modelID: "stub-model" } },
    },
    "s1",
    state,
  );
  assert.equal(done.reached, true);
  assert.equal(done.done, true);
  assert.equal(done.text, "stub-reply-ok");
  const failed = providerTurnVerdict(
    {
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: { id: "a2", role: "assistant", error: { name: "APIError", data: { message: "connection refused", statusCode: 502 } }, providerID: "dead", modelID: "dead-model" },
      },
    },
    "s1",
    state,
  );
  assert.equal(failed.reached, false);
  assert.match(failed.error, /dead/);

  mutate((s) => {
    s.runs = [
      ...(s.runs || []),
      { id: "run-ok", seatId: "build", status: "running", at: new Date().toISOString() },
      { id: "run-start", seatId: "qa", status: "starting", at: new Date().toISOString() },
    ];
  });
  assert.equal(blockLatestRun("build", "late noreply"), null);
  assert.equal([...(getState().runs || [])].reverse().find((r) => r.id === "run-ok")?.status, "running");
  assert.equal(blockLatestRun("qa", "did not reply"), "run-start");
  assert.equal((getState().runs || []).find((r) => r.id === "run-start")?.status, "blocked");
});

test("wakeSeat starts a run id and puts it on the prompt", async () => {
  const prompts = [];
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_run" });
  deps.promptSession = async (id, body) => {
    prompts.push(body.parts?.[0]?.text || "");
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) seat.status = "idle";
  });
  try {
    const result = await wakeSeat("build", "ship the webhook", { from: "product", kind: "handoff" });
    assert.equal(result.started, true);
    assert.ok(result.runId);
    assert.match(prompts[0], new RegExp(`Run: ${result.runId}`));
    const run = (getState().runs || []).find((r) => r.id === result.runId);
    assert.equal(run?.status, "done");
    assert.equal(run?.seatId, "build");
  } finally {
    Object.assign(deps, prev);
  }
});

test("a room wake whose reply the follow loop already mirrored is not posted again", async () => {
  const prev = { ...deps };
  const channel = `posted-${Date.now()}`;
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_posted" });
  deps.promptSession = async () => {
    mutate((s) => {
      s.messages = [
        ...s.messages,
        { id: `m-${channel}`, channel, who: "Eng.Build", kind: "bot", seatId: "build", text: "Room reply.", sessionId: "msg_room", mirrored: true },
      ];
    });
  };
  deps.sessionMessages = async () => [];
  deps.watchProviderTurn = () =>
    Object.assign(Promise.resolve({ reached: true, done: true, text: "Room reply.", messageId: "msg_room" }), { cancel() {} });
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) seat.status = "idle";
  });
  try {
    const woke = await wakeSeat("build", "status?", { from: "you", kind: "mention-seat", channel });
    assert.equal(woke.started, true);
    const posted = getState().messages.filter((m) => m.channel === channel && m.text === "Room reply.");
    assert.equal(posted.length, 1);
    assert.equal(posted[0].runId, woke.runId);
  } finally {
    Object.assign(deps, prev);
  }
});

test("a serve restart for a late hire reopens the room's session, not the DM", async () => {
  const prev = { ...deps };
  const created = [];
  const prompted = [];
  const restarts = [];
  let restart = false;
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async (title) => {
    const id = `ses_restart_${created.length + 1}`;
    created.push({ id, title: typeof title === "string" ? title : title?.title });
    return { id };
  };
  deps.promptSession = async (id) => prompted.push(id);
  deps.watchProviderTurn = () => Object.assign(Promise.resolve({ reached: true, text: "ok" }), { cancel() {} });
  deps.agentNeedsServeRestart = () => restart;
  deps.ensure = async (opts) => restarts.push(opts);
  const dm = getState().sessions?.build;
  mutate((s) => {
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) seat.status = "idle";
    if (s.roomSessions?.build) delete s.roomSessions.build.ship;
    s.runs = (s.runs || []).map((run) => (run.status === "starting" || run.status === "running" ? { ...run, status: "done" } : run));
  });
  try {
    await wakeSeat("build", "first", { from: "you", kind: "mention-seat", channel: "ship" });
    const before = liveRoomSession(getState(), getState().seats.find((x) => x.id === "build"), "ship")?.sessionId;
    restart = true;
    await wakeSeat("build", "second", { from: "you", kind: "mention-seat", channel: "ship" });
    const after = liveRoomSession(getState(), getState().seats.find((x) => x.id === "build"), "ship")?.sessionId;
    assert.equal(restarts.length, 1);
    assert.equal(restarts[0].forceRestart, true);
    assert.notEqual(after, before);
    assert.equal(prompted.at(-1), after);
    assert.equal(getState().sessions?.build, dm);
  } finally {
    Object.assign(deps, prev);
  }
});

test("a reused session posts only this turn's reply, not earlier turns from the transcript", async () => {
  const prev = { ...deps };
  const channel = `reused-${Date.now()}`;
  const old = "An earlier answer that is longer than the new one.";
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_reused" });
  deps.promptSession = async () => undefined;
  deps.watchProviderTurn = () => Object.assign(Promise.resolve({ reached: true, done: true, text: "New." }), { cancel() {} });
  deps.sessionMessages = async () => [
    { info: { id: "msg_old", role: "assistant", time: { created: Date.now() - 60000 } }, parts: [{ type: "text", text: old }] },
    { info: { id: "msg_new", role: "assistant", time: { created: Date.now() + 1 } }, parts: [{ type: "text", text: "New." }] },
  ];
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) seat.status = "idle";
  });
  try {
    await wakeSeat("build", "status?", { from: "product", kind: "handoff", channel });
    const texts = getState().messages.filter((m) => m.channel === channel && !m.system).map((m) => m.text);
    assert.deepEqual(texts, ["New."]);
  } finally {
    Object.assign(deps, prev);
  }
});

test("a wake that cannot start posts the reason in the room", async () => {
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "offline" });
  deps.promptSession = async () => {
    throw new Error("should not prompt");
  };
  const before = getState().messages.length;
  try {
    const entry = postBus({
      from: "product",
      to: "build",
      kind: "handoff",
      text: "ship it",
      channel: "ship",
      wake: true,
    });
    assert.ok(entry.runId);
    const woke = await pendingWake(entry);
    assert.equal(woke.started, false);
    assert.equal(woke.offline, true);
    assert.equal(woke.runId, entry.runId);
    const added = getState().messages.slice(before);
    assert.ok(added.some((m) => m.channel === "ship" && m.system && m.text.includes(entry.runId) && /offline/.test(m.text)));
    const run = (getState().runs || []).find((r) => r.id === entry.runId);
    assert.equal(run?.status, "blocked");
  } finally {
    Object.assign(deps, prev);
  }
});

test("wakeSeat records promptAsync on the recipient session", async () => {
  const prompts = [];
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async ({ title }) => ({ id: `ses_${title}` });
  deps.promptSession = async (id, body) => {
    prompts.push({ id, agent: body.agent, text: body.parts?.[0]?.text });
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) seat.status = "idle";
  });
  try {
    const result = await wakeSeat("build", "ship the webhook", { from: "product", kind: "handoff" });
    assert.ok(result.sessionId);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].agent, "build");
    assert.match(prompts[0].text, /ship the webhook/);
  } finally {
    Object.assign(deps, prev);
  }
});

test("wakeSeat routes team: addresses to the Supervisor", async () => {
  const prompts = [];
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async ({ title }) => ({ id: `ses_${title}` });
  deps.promptSession = async (id, body) => {
    prompts.push({ id, agent: body.agent, text: body.parts?.[0]?.text });
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions["eng-supervisor"];
    const seat = (s.seats || []).find((x) => x.id === "eng-supervisor");
    if (seat) seat.status = "idle";
  });
  try {
    const result = await wakeSeat("team:eng", "build the webhook", { from: "product", kind: "send_message" });
    assert.equal(result.seat, "eng-supervisor");
    assert.ok(result.sessionId);
    assert.equal(prompts[0].agent, "eng-supervisor");
    assert.match(prompts[0].text, /build the webhook/);
    assert.match(prompts[0].text, /Persona:/);
  } finally {
    Object.assign(deps, prev);
  }
});

test("wakeSeat stores Architect sessions on systemSessions", async () => {
  const prompts = [];
  const kinds = [];
  const prev = { ...deps };
  deps.harnessStatus = (kind) => ({ harness: kind === "system" ? "up" : "offline" });
  deps.createSession = async ({ title }, kind) => {
    kinds.push(kind);
    return { id: `ses_${title}` };
  };
  deps.promptSession = async (id, body, kind) => {
    prompts.push({ id, agent: body.agent, kind });
  };
  mutate((s) => {
    s.systemSessions = { ...(s.systemSessions || {}) };
    delete s.systemSessions.architect;
    const seat = (s.seats || []).find((x) => x.id === "architect");
    if (seat) seat.status = "idle";
  });
  try {
    const result = await wakeSeat("architect", "propose a plan", { from: "you", kind: "architect" });
    assert.ok(result.sessionId);
    assert.equal(result.harness, "system");
    assert.deepEqual(kinds, ["system"]);
    assert.equal(prompts[0].kind, "system");
    assert.equal(prompts[0].agent, "architect");
  } finally {
    Object.assign(deps, prev);
  }
});

function restoreBuild(model) {
  mutate((s) => {
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) seat.model = model;
    if (s.sessions) delete s.sessions.build;
  });
}

test("a bad model is not written into the shared config and does not stop another seat", async () => {
  const prev = { ...deps };
  const prompts = [];
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_iso" });
  deps.loadedModels = async () => [{ providerID: "opencode", modelID: "longcat-2.5-preview-free" }];
  deps.promptSession = async (_id, body) => {
    prompts.push(body.model);
  };
  let priorModel;
  mutate((s) => {
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) {
      priorModel = seat.model;
      seat.model = "featherless/not-loaded-model";
      seat.fallbackModel = "";
      seat.status = "idle";
    }
    if (s.sessions) delete s.sessions.build;
    if (s.sessions) delete s.sessions.qa;
  });
  const before = JSON.stringify(readOpenCodeConfig());
  try {
    const bad = await wakeSeat("build", "nope", { from: "you", channel: "ship" });
    assert.equal(bad.started, false);
    assert.equal(prompts.length, 0);
    const badRun = (getState().runs || []).find((r) => r.id === bad.runId);
    assert.equal(badRun?.status, "blocked");
    assert.equal(JSON.stringify(readOpenCodeConfig()), before);
    const added = getState().messages.filter((m) => m.channel === "ship" && m.system && String(m.text).includes(bad.runId));
    assert.ok(added.length);

    deps.loadedModels = async () => [{ providerID: "demo-llm", modelID: "demo-small" }];
    mutate((s) => {
      const seat = (s.seats || []).find((x) => x.id === "qa");
      if (seat) {
        seat.model = "";
        seat.fallbackModel = "";
        seat.status = "idle";
      }
    });
    const good = await wakeSeat("qa", "still works", { from: "you" });
    assert.notEqual(good.seat, "build");
    assert.equal(prompts.some((m) => m?.providerID === "opencode"), false);
  } finally {
    Object.assign(deps, prev);
    mutate((s) => {
      const seat = (s.seats || []).find((x) => x.id === "build");
      if (seat && priorModel !== undefined) seat.model = priorModel;
    });
  }
});

test("an explicitly assigned model is not swapped for a loaded one", async () => {
  const prev = { ...deps };
  const prevKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-key";
  let prompted = 0;
  let priorModel;
  let priorFallback;
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_assigned" });
  deps.loadedModels = async () => [{ providerID: "demo-llm", modelID: "demo-small" }];
  deps.promptSession = async () => {
    prompted += 1;
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
    const seat = (s.seats || []).find((x) => x.id === "build");
    const team = (s.teams || []).find((t) => t.id === "eng");
    if (team) {
      priorFallback = team.fallbackModel;
      team.fallbackModel = "";
    }
    if (seat) {
      seat.status = "idle";
      seat.fallbackModel = "";
      priorModel = seat.model;
      seat.model = "featherless/not-loaded-model";
    }
  });
  const before = getState().messages.length;
  try {
    const result = await wakeSeat("build", "ship it", { from: "product", channel: "ship" });
    assert.equal(prompted, 0);
    assert.equal(result.started, false);
    assert.equal(result.code, "PROVIDER_NOT_LOADED");
    assert.match(result.error, /featherless\/not-loaded-model is not loaded by the company OpenCode harness \(loaded: demo-llm\)/);
    const run = (getState().runs || []).find((r) => r.id === result.runId);
    assert.equal(run?.status, "blocked");
    const added = getState().messages.slice(before);
    assert.ok(added.some((m) => m.channel === "ship" && m.system && /featherless\/not-loaded-model is not loaded by the company OpenCode harness \(loaded: demo-llm\)/.test(m.text)));
  } finally {
    Object.assign(deps, prev);
    if (prevKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prevKey;
    mutate((s) => {
      const seat = (s.seats || []).find((x) => x.id === "build");
      const team = (s.teams || []).find((t) => t.id === "eng");
      if (seat && priorModel !== undefined) seat.model = priorModel;
      if (team) team.fallbackModel = priorFallback;
    });
  }
});

test("wakeSeat refuses a model the serve did not load instead of a silent prompt", async () => {
  const prev = { ...deps };
  let priorModel;
  let prompted = 0;
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_notloaded" });
  deps.loadedModels = async () => [{ providerID: "opencode", modelID: "big-pickle" }];
  deps.promptSession = async () => {
    prompted += 1;
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) {
      seat.status = "idle";
      priorModel = seat.model;
      seat.model = "featherless/Qwen/Qwen2.5-Coder-32B-Instruct";
    }
  });
  try {
    const result = await wakeSeat("build", "ship it", { from: "product" });
    assert.equal(prompted, 0);
    assert.equal(result.code, "PROVIDER_NOT_LOADED");
    assert.match(result.error, /featherless\/Qwen\/Qwen2\.5-Coder-32B-Instruct is not loaded by the company OpenCode harness \(loaded: opencode\)/);
  } finally {
    Object.assign(deps, prev);
    restoreBuild(priorModel);
  }
});

test("wakeSeat turns an opaque OpenCode 500 into a provider error", async () => {
  const prev = { ...deps };
  let priorModel;
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_500" });
  deps.loadedModels = async () => null;
  deps.promptSession = async () => {
    const err = new Error("Internal Server Error");
    err.status = 500;
    err.detail = { name: "UnknownError", data: { message: "ProviderModelNotFoundError: Model not found" } };
    throw err;
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) {
      seat.status = "idle";
      priorModel = seat.model;
      seat.model = "featherless/Qwen/Qwen2.5-Coder-32B-Instruct";
    }
  });
  try {
    const result = await wakeSeat("build", "ship it", { from: "product" });
    assert.equal(result.code, "PROVIDER_NOT_LOADED");
    assert.doesNotMatch(result.error, /Internal Server Error/);
    assert.match(result.error, /not loaded by the company OpenCode harness/);
  } finally {
    Object.assign(deps, prev);
    restoreBuild(priorModel);
  }
});

test("wakeSeat recreates session after 404", async () => {
  const prompts = [];
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_fresh" });
  deps.promptSession = async (id, body) => {
    if (id === "ses_stale") {
      const err = new Error("gone");
      err.status = 404;
      throw err;
    }
    prompts.push(id);
    return { ok: true };
  };
  mutate((s) => {
    s.sessions = { ...(s.sessions || {}), build: "ses_stale" };
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) seat.status = "idle";
  });
  try {
    const result = await wakeSeat("build", "retry", { from: "product" });
    assert.equal(result.sessionId, "ses_fresh");
    assert.ok(result.runId);
    assert.equal(result.started, true);
    assert.deepEqual(prompts, ["ses_fresh"]);
  } finally {
    Object.assign(deps, prev);
    mutate((s) => {
      if (s.sessions?.build === "ses_fresh") delete s.sessions.build;
    });
  }
});

test("room wakes run in the seat's session for that room and carry the messages since its last turn", async () => {
  const prompts = [];
  const created = [];
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.loadedModels = async () => null;
  deps.createSession = async ({ title }) => {
    created.push(title);
    return { id: `ses_${title}` };
  };
  deps.promptSession = async (id, body) => {
    prompts.push({ id, text: body.parts?.[0]?.text || "" });
  };
  const room = `rs-${Date.now()}`;
  const post = (who, seatId, text) =>
    mutate((s) => {
      s.messages = [...s.messages, { id: `m-${room}-${s.messages.length}`, channel: room, who, seatId, text, time: "09:00" }];
    });
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
    if (s.roomSessions) delete s.roomSessions.build;
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) seat.status = "idle";
  });
  try {
    post("Maya", "maya", "the webhook retries twice");
    post("You", "you", "@build can you fix it?");
    const first = await wakeSeat("build", "@build can you fix it?", { from: "you", kind: "mention-seat", channel: room, announce: false });
    assert.equal(first.sessionId, `ses_roster:build:${room}`);
    assert.deepEqual(created, [`roster:build:${room}`]);
    assert.equal(getState().sessions?.build, undefined);
    assert.match(prompts[0].text, new RegExp(`Messages in #${room} since your last turn there`));
    assert.match(prompts[0].text, /\[09:00\] Maya: the webhook retries twice/);
    assert.doesNotMatch(prompts[0].text, /\[09:00\] You: @build can you fix it\?/);

    post("Eng.Build", "build", "on it");
    post("Maya", "maya", "also check the logs");
    post("You", "you", "@build any news?");
    const second = await wakeSeat("build", "@build any news?", { from: "you", kind: "mention-seat", channel: room, announce: false });
    assert.equal(second.sessionId, first.sessionId);
    assert.equal(created.length, 1);
    assert.match(prompts[1].text, /Maya: also check the logs/);
    assert.doesNotMatch(prompts[1].text, /the webhook retries twice/);
    assert.doesNotMatch(prompts[1].text, /Eng\.Build: on it/);
    assert.equal(getState().roomSessions.build[room].cursor, getState().messages.filter((m) => m.channel === room).at(-1).id);

    const mail = await wakeSeat("build", "ship it", { from: "product", kind: "handoff", channel: room, announce: false });
    assert.equal(mail.sessionId, "ses_roster:build");
    assert.doesNotMatch(prompts[2].text, /since your last turn/);
    const dm = await wakeSeat("build", "hi", { from: "you", kind: "dm", channel: "dm-build", announce: false });
    assert.equal(dm.sessionId, "ses_roster:build");
    assert.equal(getState().sessionRooms.build, "dm-build");
  } finally {
    mutate((s) => {
      if (s.roomSessions) delete s.roomSessions.build;
    });
    Object.assign(deps, prev);
  }
});

test("room wakes tell the seat how to bring someone in, and hop wakes say who mentioned it", () => {
  const plain = roomReplyLines({ channel: "ship", kind: "mention-seat" });
  assert.ok(plain.some((l) => l.includes("@mention their seat id in your reply; that wakes them here")));
  assert.ok(!plain.some((l) => l.includes("mentioned you in")));
  const hop = roomReplyLines({ channel: "ship", kind: "mention-seat", thread: { hop: 2, from: "product", maxHops: 4 } });
  assert.equal(hop[0], "@product mentioned you in #ship (hop 2 of 4). Answer them; @mention someone else only if they must act.");
  assert.deepEqual(roomReplyLines({ kind: "send_message" }), []);
});

test("team-mode wakes are told to reply PASS when they have nothing to add", () => {
  const lines = roomReplyLines({ channel: "ship", kind: "implicit", teamMode: true });
  assert.ok(lines.some((l) => l.includes("otherwise reply with exactly PASS")));
  assert.ok(isPass("PASS") && isPass(" pass. ") && !isPass("PASS: I disagree"));
});

test("a PASS reply finishes the run without posting in the room", async () => {
  const prev = { ...deps };
  const channel = `pass-${Date.now()}`;
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_pass" });
  deps.promptSession = async () => undefined;
  deps.sessionMessages = async () => [];
  deps.watchProviderTurn = () => Object.assign(Promise.resolve({ reached: true, done: true, text: "PASS", messageId: "msg_pass" }), { cancel() {} });
  mutate((s) => {
    const seat = (s.seats || []).find((x) => x.id === "build");
    if (seat) seat.status = "idle";
  });
  try {
    const woke = await wakeSeat("build", "anyone?", { from: "you", kind: "implicit", channel, teamMode: true, announce: false });
    assert.equal(woke.started, true);
    assert.equal((getState().runs || []).find((r) => r.id === woke.runId)?.status, "done");
    assert.equal(getState().messages.filter((m) => m.channel === channel && !m.system).length, 0);
  } finally {
    Object.assign(deps, prev);
  }
});

test("meterTurn corrects the wake's usage row from the session's reported tokens", async () => {
  const prev = { ...deps };
  const runId = `run-meter-${Date.now()}`;
  const was = JSON.parse(JSON.stringify(getState().seats.find((s) => s.id === "build")));
  mutate((s) => {
    const seat = s.seats.find((x) => x.id === "build");
    seat.tokenBudget = 0;
    meterWake(s, { seatId: "build", runId, inputTokens: 100, outputTokens: 200, channelId: "ship" });
  });
  const spentAfterEstimate = getState().seats.find((s) => s.id === "build").spent;
  deps.sessionMessages = async (id) => {
    assert.equal(id, "ses-meter");
    return [{ info: { role: "assistant", time: { created: Date.now() }, cost: 0.004, tokens: { input: 900, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [] }];
  };
  try {
    const out = await meterTurn("build", { sessionId: "ses-meter", runId });
    assert.equal(out.row.tokens, 1000);
    assert.equal(out.row.channelId, "ship");
    assert.equal(getState().seats.find((s) => s.id === "build").spent, spentAfterEstimate + 700);
    assert.equal(await meterTurn("build", { sessionId: "ses-meter", runId: null }), null);
  } finally {
    Object.assign(deps, prev);
    mutate((s) => {
      s.seats = s.seats.map((x) => (x.id === "build" ? was : x));
      s.usage = (s.usage || []).filter((r) => r.runId !== runId);
    });
  }
});

test("supervisor prompts list the direct reports they can task and the ones they cannot", () => {
  const state = {
    seats: [
      { id: "sup", name: "Sup", role: "Supervisor", kind: "bot", seatType: "supervisor", job: "Route", tools: [], deny: [] },
      { id: "a", kind: "bot", seatType: "specialist", reportsTo: "sup", status: "idle" },
      { id: "b", kind: "bot", seatType: "specialist", reportsTo: "sup", status: "paused", pauseReason: "budget" },
      { id: "c", kind: "bot", seatType: "specialist", reportsTo: "sup", status: "idle", tokenBudget: 10, spent: 10 },
      { id: "d", kind: "bot", seatType: "specialist", reportsTo: "sup", status: "paused", pauseReason: "manual" },
    ],
  };
  const lines = delegationLines(state.seats[0], state).filter(Boolean);
  assert.match(lines[0], /delegate inside this turn with the task tool\. Set subagent_type to the seat id of a direct report: a\./);
  assert.equal(lines[1], "Do not delegate to: b (over budget), c (over budget), d (paused).");
  assert.deepEqual(delegationLines(state.seats[1], state), []);
  const sup = getState().seats.find((s) => s.id === "eng-supervisor");
  const text = promptBody(sup, "eng-supervisor", "fix it", { from: "you", kind: "implicit", channel: "team-eng" }, null).parts[0].text;
  assert.match(text, /task tool/);
  assert.match(text, /build/);
  const spec = getState().seats.find((s) => s.id === "build");
  assert.doesNotMatch(promptBody(spec, "build", "fix it", { from: "you", kind: "implicit", channel: "ship" }, null).parts[0].text, /task tool/);
});

test("taskTitle drops OpenCode's subagent suffix", () => {
  assert.equal(taskTitle("Fix flaky webhook test (@build subagent)"), "Fix flaky webhook test");
  assert.equal(taskTitle("Plain"), "Plain");
  assert.equal(taskTitle(null), "");
});

test("meterChildren meters each subagent session against the seat it ran as", async () => {
  const prev = { ...deps };
  const runId = `run-child-${Date.now()}`;
  const was = JSON.parse(JSON.stringify(getState().seats.find((s) => s.id === "build")));
  const wasSup = JSON.parse(JSON.stringify(getState().seats.find((s) => s.id === "eng-supervisor")));
  const now = Date.now();
  deps.sessionChildren = async (id) => {
    assert.equal(id, "ses-parent");
    return [
      { id: "ses-kid", parentID: "ses-parent", title: "Fix flaky webhook test (@build subagent)", time: { created: now } },
      { id: "ses-old", parentID: "ses-parent", title: "Earlier (@build subagent)", time: { created: now - 60_000 } },
      { id: "ses-ghost", parentID: "ses-parent", title: "Explore (@explore subagent)", time: { created: now } },
    ];
  };
  deps.sessionMessages = async (id) => {
    if (id === "ses-ghost") return [{ info: { role: "assistant", agent: "explore", time: { created: now }, tokens: { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [] }];
    return [{ info: { role: "assistant", agent: "build", time: { created: now }, cost: 0.001, tokens: { input: 400, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [] }];
  };
  mutate((s) => {
    const seat = s.seats.find((x) => x.id === "build");
    seat.tokenBudget = 0;
  });
  try {
    const out = await meterChildren("eng-supervisor", { sessionId: "ses-parent", since: now - 1000, runId, channelId: "team-eng" });
    assert.deepEqual(
      out.map((c) => [c.childSessionId, c.seatId, c.title, c.tokens]),
      [
        ["ses-kid", "build", "Fix flaky webhook test", 500],
        ["ses-ghost", null, "Explore", 10],
      ],
    );
    const ghost = getState().usage.filter((r) => r.runId === `${runId}:ses-ghost`);
    assert.deepEqual(ghost.map((r) => [r.seatId, r.tokens]), [["eng-supervisor", 10]]);
    const rows = getState().usage.filter((r) => r.runId === `${runId}:ses-kid`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "task");
    assert.equal(rows[0].seatId, "build");
    assert.equal(rows[0].parentSeatId, "eng-supervisor");
    await meterChildren("eng-supervisor", { sessionId: "ses-parent", since: now - 1000, runId, channelId: "team-eng" });
    assert.equal(getState().usage.filter((r) => r.runId === `${runId}:ses-kid`).length, 1);
    assert.deepEqual(await meterChildren("eng-supervisor", { sessionId: "ses-parent", runId: null }), []);
  } finally {
    Object.assign(deps, prev);
    mutate((s) => {
      s.seats = s.seats.map((x) => (x.id === "build" ? was : x.id === "eng-supervisor" ? wasSup : x));
      s.usage = (s.usage || []).filter((r) => !String(r.runId || "").startsWith(runId));
    });
  }
});

test("a later wake posts the same text again", async () => {
  const prev = { ...deps };
  const reply = { reached: true, text: "same-reply", done: true };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_same" });
  deps.promptSession = async () => ({ ok: true });
  deps.sessionMessages = async () => [];
  deps.watchProviderTurn = () => {
    const pending = Promise.resolve(reply);
    pending.rest = pending;
    pending.cancel = () => {};
    return pending;
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
  });
  try {
    const first = await wakeSeat("build", "again", { from: "product", channel: "ship" });
    const second = await wakeSeat("build", "again", { from: "product", channel: "ship" });
    const posted = (getState().messages || []).filter(
      (m) => m.text === "same-reply" && (m.runId === first.runId || m.runId === second.runId),
    );
    assert.equal(posted.length, 2);
    assert.equal(posted[0].runId, first.runId);
    assert.equal(posted[1].runId, second.runId);
    assert.notEqual(first.runId, second.runId);
  } finally {
    Object.assign(deps, prev);
  }
});

test("a reply that arrives after the start timeout is posted and the run is done", async () => {
  const prev = { ...deps };
  let release;
  const rest = new Promise((resolve) => {
    release = resolve;
  });
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_late" });
  deps.promptSession = async () => ({ ok: true });
  deps.sessionMessages = async () => [];
  deps.watchProviderTurn = () => {
    const pending = Promise.resolve({ reached: false, timeout: true, done: false });
    pending.rest = rest;
    pending.cancel = () => {};
    return pending;
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
  });
  try {
    const result = await wakeSeat("build", "slow", { from: "product", channel: "ship" });
    assert.equal(result.started, false);
    assert.equal((getState().runs || []).find((r) => r.id === result.runId)?.status, "blocked");
    release({ reached: true, text: "late-hello", done: true });
    const start = Date.now();
    let run;
    while (Date.now() - start < 1000) {
      run = (getState().runs || []).find((r) => r.id === result.runId);
      if (run?.status === "done") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(run?.status, "done");
    assert.ok(
      (getState().messages || []).some((m) => m.runId === result.runId && m.text === "late-hello"),
    );
  } finally {
    Object.assign(deps, prev);
  }
});

test("waitForIdleServe holds while another run is streaming", async () => {
  mutate((s) => {
    s.runs = [
      ...(s.runs || []).map((run) =>
        run.status === "starting" || run.status === "running" ? { ...run, status: "done" } : run,
      ),
      { id: "run-stream-x", seatId: "build", status: "running", started: false, at: new Date().toISOString() },
    ];
    return null;
  });
  let settled = false;
  const pending = waitForIdleServe("company", "run-y", 2000).then(() => {
    settled = true;
  });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(settled, false);
  mutate((s) => {
    s.runs = (s.runs || []).map((run) => (run.id === "run-stream-x" ? { ...run, status: "done" } : run));
    return null;
  });
  await pending;
  assert.equal(settled, true);
});

test("a wake posts only the assistant message from this run", async () => {
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_hist" });
  deps.promptSession = async () => ({ ok: true });
  const freshId = `hist-${Date.now()}`;
  deps.sessionMessages = async () => [
    { id: "old", info: { role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "old-reply" }] },
    { id: freshId, info: { role: "assistant", time: { created: Date.now() + 60_000 } }, parts: [{ type: "text", text: "new-reply" }] },
  ];
  deps.watchProviderTurn = () => {
    const pending = Promise.resolve({ reached: true, text: "old-reply\nnew-reply", done: true });
    pending.rest = pending;
    pending.arm = () => {};
    pending.cancel = () => {};
    return pending;
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
  });
  try {
    const result = await wakeSeat("build", "next", { from: "product", channel: "ship" });
    const posted = (getState().messages || []).filter((m) => m.runId === result.runId && m.seatId === "build" && !m.system);
    assert.equal(
      posted.length,
      1,
      JSON.stringify({
        started: result.started,
        messageId: result.messageId,
        hits: (getState().messages || []).filter((m) => String(m.text).includes("new-reply")).map((m) => ({ runId: m.runId, sessionId: m.sessionId, text: m.text })),
      }),
    );
    assert.equal(posted[0].text, "new-reply");
    assert.equal(posted[0].sessionId, freshId);
  } finally {
    Object.assign(deps, prev);
  }
});

test("overlapping wakes share one wakeSeat result", async () => {
  const prev = { ...deps };
  let prompts = 0;
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_share" });
  deps.promptSession = async () => {
    prompts += 1;
  };
  deps.sessionMessages = async () => [];
  deps.watchProviderTurn = () => {
    const pending = Promise.resolve({ reached: true, text: "shared-reply", done: true, messageId: "shared-1" });
    pending.rest = pending;
    pending.arm = () => {};
    pending.cancel = () => {};
    return pending;
  };
  mutate((s) => {
    if (s.sessions) delete s.sessions.build;
  });
  try {
    const first = wakeSeat("build", "one", { from: "product", channel: "ship" });
    const second = wakeSeat("build", "two", { from: "product", channel: "ship" });
    const [a, b] = await Promise.all([first, second]);
    assert.equal(prompts, 1);
    assert.equal(a.started, true);
    assert.equal(b.started, a.started);
    assert.equal(b.runId, a.runId);
  } finally {
    Object.assign(deps, prev);
  }
});

test("an API call with no room posts to #ship and says so", async () => {
  assert.deepEqual(roomForApiCall({ channel: "general" }), { channel: "general", note: null });
  assert.deepEqual(roomForApiCall({ sessionRoom: "incidents" }), { channel: "incidents", note: null });
  assert.deepEqual(roomForApiCall({ channel: "ship" }), { channel: "ship", note: null });
  assert.deepEqual(roomForApiCall({}), { channel: "ship", note: SHIP_FALLBACK_NOTE });

  const TOKEN = "rf_room_fallback_token_0001";
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_HARNESS_AUTOSTART: "0",
  });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  try {
    const sent = await fetch(`${core.base}/api/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ from: "product", to: "build", text: "no room on messages", wake: false }),
    });
    const body = await sent.json();
    assert.equal(sent.status, 201, JSON.stringify(body));
    assert.equal(body.channel, "ship");
    assert.equal(body.note, SHIP_FALLBACK_NOTE);
    const bus = await fetch(`${core.base}/api/v1/bus/send`, {
      method: "POST",
      headers,
      body: JSON.stringify({ from: "product", to: "build", text: "no room on the bus", wake: false }),
    });
    const busBody = await bus.json();
    assert.equal(bus.status, 201, JSON.stringify(busBody));
    assert.equal(busBody.note, SHIP_FALLBACK_NOTE);
    const named = await fetch(`${core.base}/api/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ from: "product", to: "build", text: "explicit general", channel: "general", wake: false }),
    });
    const namedBody = await named.json();
    assert.equal(named.status, 201);
    assert.equal(namedBody.channel, "general");
    assert.equal(namedBody.note, undefined);
    const state = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    const ship = (state.messages || []).filter((m) => m.channel === "ship");
    assert.equal(ship.filter((m) => m.text === SHIP_FALLBACK_NOTE && m.system).length, 2);
    assert.ok(ship.some((m) => m.text === "no room on messages"));
    assert.ok(ship.some((m) => m.text === "no room on the bus"));
    assert.ok(!(state.messages || []).some((m) => m.channel === "general" && m.text === SHIP_FALLBACK_NOTE));
  } finally {
    await core.stop();
  }
});
