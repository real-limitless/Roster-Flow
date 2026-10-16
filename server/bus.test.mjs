import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncSeatAgent } from "./agents.mjs";
import { readOpenCodeConfig } from "./providers.mjs";
import { providerTurnVerdict } from "./harness.mjs";
import { blockLatestRun } from "./bus.mjs";
import { deps, pendingWake, postBus, promptBody, wakeSeat } from "./bus.mjs";
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
  const done = providerTurnVerdict(
    {
      type: "message.updated",
      properties: { sessionID: "s1", info: { id: "a1", role: "assistant", time: { created: 1, completed: 2 }, providerID: "stub", modelID: "stub-model" } },
    },
    "s1",
    state,
  );
  assert.equal(done.reached, true);
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
  assert.equal((getState().runs || []).find((r) => r.id === "run-ok")?.status, "running");
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
    assert.equal(run?.status, "running");
    assert.equal(run?.seatId, "build");
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
