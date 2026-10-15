import assert from "node:assert/strict";
import test from "node:test";
import { deps, promptBody, wakeSeat } from "./bus.mjs";
import { mutate } from "./store.mjs";

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
    assert.deepEqual(prompts, ["ses_fresh"]);
  } finally {
    Object.assign(deps, prev);
    mutate((s) => {
      if (s.sessions?.build === "ses_fresh") delete s.sessions.build;
    });
  }
});
