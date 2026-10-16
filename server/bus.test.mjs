import assert from "node:assert/strict";
import test from "node:test";
import { delegationLines, deps, isPass, meterChildren, meterTurn, pendingWake, postBus, promptBody, roomReplyLines, taskTitle, wakeSeat } from "./bus.mjs";
import { meterWake } from "./budget.mjs";
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
