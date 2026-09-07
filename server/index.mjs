import { createServer } from "node:http";
import { getState, mutate, save, resetState, clock, uid } from "./store.mjs";
import { emptyState, runSteps, stepCopy } from "./seed.mjs";
import { ensure, status as harnessStatus, listSessions, createSession, promptSession } from "./harness.mjs";
import { listProviders, upsertProvider, setAuth, removeProvider, listModels, readOpenCodeConfig } from "./providers.mjs";
import { postBus, wakeSeat, cycleSafe } from "./bus.mjs";

const PORT = Number(process.env.ROSTER_API_PORT || 8787);

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(data);
}

function fail(res, err) {
  json(res, err.status || 500, { error: err.message || "error", detail: err.detail || err.code || undefined });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function looksLikeShip(text) {
  return /product|eng|devops|qa/i.test(text);
}

function postMessage(channel, who, kind, text, extra = {}) {
  const msg = { id: uid("msg"), channel, who, kind, text, time: clock(), ...extra };
  mutate((s) => {
    s.messages = [...s.messages, msg];
  });
  return msg;
}

async function startRun({ prompt, channel = "ship", who = "You" }) {
  const run = {
    id: uid("run"),
    prompt,
    channel,
    step: 0,
    status: "running",
    createdAt: new Date().toISOString(),
    steps: runSteps.map((s) => ({ ...s, status: "pending" })),
  };
  mutate((s) => {
    s.runs = [run, ...s.runs];
  });
  postMessage(channel, who, "human", prompt);
  postMessage(channel, "Floor", "bot", `Compiled run ${run.id}. Product → @eng → confirm → DevOps → QA.`, {
    run: true,
    runId: run.id,
  });
  postBus({ from: "floor", to: "product", kind: "handoff", text: prompt, runId: run.id });
  void tickRun(run.id);
  return run;
}

async function tickRun(runId) {
  const run = getState().runs.find((r) => r.id === runId);
  if (!run || run.status !== "running") return;
  const i = run.step;
  if (i >= runSteps.length) {
    mutate((s) => {
      const r = s.runs.find((x) => x.id === runId);
      if (r) r.status = "done";
    });
    return;
  }
  const spec = runSteps[i];
  const seat = getState().seats.find((x) => x.id === spec.id);
  const text = stepCopy[spec.id] || `${spec.label} complete.`;
  postMessage(run.channel, seat?.name || spec.label, spec.kind, text, { runId });
  mutate((s) => {
    const r = s.runs.find((x) => x.id === runId);
    if (!r) return;
    r.steps[i].status = "done";
    r.step = i + 1;
    const st = s.seats.find((x) => x.id === spec.id);
    if (st) st.status = i + 1 >= runSteps.length ? "done" : "running";
  });
  const next = runSteps[i + 1];
  if (next) {
    postBus({
      from: spec.id,
      to: next.id,
      kind: spec.kind === "human" ? "ask_human" : "handoff",
      text,
      runId,
      wake: next.kind === "bot",
    });
  } else {
    postBus({ from: spec.id, to: "channel:ship", kind: "report", text, runId });
  }
  if (spec.kind === "bot") {
    await wakeSeat(spec.id, `${run.prompt}\n\nYour step: ${spec.label}\nExpected: ${text}`, {
      from: "floor",
      kind: "run",
      runId,
    });
  }
  setTimeout(() => void tickRun(runId), 850);
}

save();

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      });
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const { pathname } = url;
    const method = req.method || "GET";

    if (pathname === "/api/v1/health" && method === "GET") {
      json(res, 200, { ok: true, ...harnessStatus(), seats: getState().seats.length });
      return;
    }
    if (pathname === "/api/v1/reset" && method === "POST") {
      json(res, 200, resetState());
      return;
    }
    if (pathname === "/api/v1/teams" && method === "GET") {
      json(res, 200, getState().teams);
      return;
    }
    if (pathname === "/api/v1/bots" && method === "GET") {
      json(res, 200, getState().seats.filter((s) => s.kind === "bot"));
      return;
    }
    if (pathname === "/api/v1/seats" && method === "GET") {
      json(res, 200, getState().seats);
      return;
    }
    if (pathname === "/api/v1/seats" && method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || body.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32);
      if (!id) {
        json(res, 400, { error: "name required" });
        return;
      }
      if (getState().seats.some((s) => s.id === id)) {
        json(res, 409, { error: "seat exists" });
        return;
      }
      const seat = {
        id,
        name: body.name || id,
        role: body.role || (body.kind === "human" ? "Teammate" : "Specialist"),
        kind: body.kind === "human" ? "human" : "bot",
        reportsTo: body.reportsTo || undefined,
        team: body.team,
        tools: body.tools || (body.kind === "human" ? ["approve"] : ["read"]),
        deny: body.deny || (body.kind === "bot" ? ["deploy"] : []),
        model: body.kind === "human" ? undefined : body.model || "grok-4",
        job: body.job || "New seat.",
        status: "idle",
      };
      mutate((s) => {
        s.seats = [...s.seats, seat];
      });
      json(res, 201, seat);
      return;
    }
    const seatPatch = pathname.match(/^\/api\/v1\/seats\/([^/]+)$/);
    if (seatPatch && method === "PATCH") {
      const id = decodeURIComponent(seatPatch[1]);
      const body = await readBody(req);
      let updated = null;
      mutate((s) => {
        s.seats = s.seats.map((seat) => {
          if (seat.id !== id) return seat;
          updated = { ...seat, ...body, id };
          return updated;
        });
      });
      if (!updated) {
        json(res, 404, { error: "seat not found" });
        return;
      }
      json(res, 200, updated);
      return;
    }
    const attach = pathname.match(/^\/api\/v1\/seats\/([^/]+)\/attach$/);
    if (attach && method === "POST") {
      const id = decodeURIComponent(attach[1]);
      try {
        await ensure({});
      } catch (err) {
        if (err.code !== "OPENCODE_MISSING") throw err;
      }
      const woke = await wakeSeat(id, "Attached from Roster-flow chart.", { from: "you", kind: "attach" });
      json(res, 200, { seat: id, ...woke, harness: harnessStatus() });
      return;
    }
    if (pathname === "/api/v1/channels" && method === "GET") {
      json(res, 200, getState().channels);
      return;
    }
    const chMsg = pathname.match(/^\/api\/v1\/channels\/([^/]+)\/messages$/);
    if (chMsg && method === "GET") {
      const id = decodeURIComponent(chMsg[1]);
      json(res, 200, getState().messages.filter((m) => m.channel === id));
      return;
    }
    if (chMsg && method === "POST") {
      const id = decodeURIComponent(chMsg[1]);
      const body = await readBody(req);
      const text = String(body.text || "").trim();
      if (!text) {
        json(res, 400, { error: "text required" });
        return;
      }
      if (looksLikeShip(text) && id === "ship") {
        const run = await startRun({ prompt: text, channel: id, who: body.who || "You" });
        json(res, 201, { run, messages: getState().messages.filter((m) => m.channel === id) });
        return;
      }
      const msg = postMessage(id, body.who || "You", body.kind || "human", text);
      json(res, 201, msg);
      return;
    }
    if (pathname === "/api/v1/threads" && method === "GET") {
      const byCh = {};
      for (const m of getState().messages) {
        byCh[m.channel] = byCh[m.channel] || [];
        byCh[m.channel].push(m);
      }
      json(
        res,
        200,
        Object.entries(byCh).map(([id, messages]) => ({ id, channel: id, count: messages.length })),
      );
      return;
    }
    const thread = pathname.match(/^\/api\/v1\/threads\/([^/]+)$/);
    if (thread && method === "GET") {
      const id = decodeURIComponent(thread[1]);
      json(res, 200, { id, messages: getState().messages.filter((m) => m.channel === id) });
      return;
    }
    if (pathname === "/api/v1/messages" && method === "POST") {
      const body = await readBody(req);
      const from = body.from || "you";
      const to = body.to;
      const text = String(body.text || "").trim();
      if (!to || !text) {
        json(res, 400, { error: "to and text required" });
        return;
      }
      if (!cycleSafe(from, to)) {
        json(res, 429, { error: "cycle detector: too many ping-pongs" });
        return;
      }
      let channel = "ship";
      if (String(to).startsWith("channel:")) channel = to.slice("channel:".length);
      const fromSeat = getState().seats.find((s) => s.id === from);
      postMessage(channel, fromSeat?.name || from, fromSeat?.kind || "bot", text);
      const entry = postBus({ from, to, kind: "send_message", text, wake: body.wake !== false && !String(to).startsWith("channel:") });
      json(res, 201, entry);
      return;
    }
    if (pathname === "/api/v1/bus" && method === "GET") {
      json(res, 200, getState().bus);
      return;
    }
    if (pathname === "/api/v1/bus/send" && method === "POST") {
      const body = await readBody(req);
      if (!body.from || !body.to || !body.text) {
        json(res, 400, { error: "from, to, text required" });
        return;
      }
      if (!cycleSafe(body.from, body.to)) {
        json(res, 429, { error: "cycle detector: too many ping-pongs" });
        return;
      }
      const fromSeat = getState().seats.find((s) => s.id === body.from);
      postMessage(body.channel || "ship", fromSeat?.name || body.from, fromSeat?.kind || "bot", body.text);
      json(res, 201, postBus(body));
      return;
    }
    if (pathname === "/api/v1/runs" && method === "GET") {
      json(res, 200, getState().runs);
      return;
    }
    if (pathname === "/api/v1/runs" && method === "POST") {
      const body = await readBody(req);
      const prompt = String(body.prompt || "").trim();
      if (!prompt) {
        json(res, 400, { error: "prompt required" });
        return;
      }
      json(res, 201, await startRun({ prompt, channel: body.channel || "ship", who: body.who || "You" }));
      return;
    }
    const runGet = pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);
    if (runGet && method === "GET") {
      const run = getState().runs.find((r) => r.id === decodeURIComponent(runGet[1]));
      if (!run) {
        json(res, 404, { error: "run not found" });
        return;
      }
      json(res, 200, run);
      return;
    }
    const runCancel = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/cancel$/);
    if (runCancel && method === "POST") {
      let run = null;
      mutate((s) => {
        run = s.runs.find((r) => r.id === decodeURIComponent(runCancel[1]));
        if (run) run.status = "cancelled";
      });
      if (!run) {
        json(res, 404, { error: "run not found" });
        return;
      }
      json(res, 200, run);
      return;
    }
    if (pathname === "/api/v1/harness" && method === "GET") {
      json(res, 200, harnessStatus());
      return;
    }
    if (pathname === "/api/v1/harness/ensure" && method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      try {
        json(res, 200, await ensure({ forceRestart: Boolean(body.forceRestart) }));
      } catch (err) {
        json(res, err.status || 409, { error: err.message, code: err.code, ...harnessStatus() });
      }
      return;
    }
    if (pathname === "/api/v1/harness/sessions" && method === "GET") {
      try {
        json(res, 200, await listSessions());
      } catch (err) {
        json(res, 200, { harness: "offline", sessions: [], error: err.message });
      }
      return;
    }
    if (pathname === "/api/v1/harness/sessions" && method === "POST") {
      const body = await readBody(req);
      json(res, 201, await createSession(body));
      return;
    }
    const promptPath = pathname.match(/^\/api\/v1\/harness\/sessions\/([^/]+)\/prompt$/);
    if (promptPath && method === "POST") {
      const body = await readBody(req);
      json(res, 200, await promptSession(decodeURIComponent(promptPath[1]), body));
      return;
    }
    if (pathname === "/api/v1/providers" && method === "GET") {
      json(res, 200, listProviders());
      return;
    }
    if (pathname === "/api/v1/providers" && method === "PUT") {
      json(res, 200, upsertProvider(await readBody(req)));
      return;
    }
    const authP = pathname.match(/^\/api\/v1\/providers\/([^/]+)\/auth$/);
    if (authP && method === "POST") {
      const body = await readBody(req);
      json(res, 200, setAuth(decodeURIComponent(authP[1]), body.apiKey || body.key));
      return;
    }
    const delP = pathname.match(/^\/api\/v1\/providers\/([^/]+)$/);
    if (delP && method === "DELETE") {
      json(res, 200, removeProvider(decodeURIComponent(delP[1])));
      return;
    }
    if (pathname === "/api/v1/models" && method === "GET") {
      json(res, 200, listModels());
      return;
    }
    if (pathname === "/api/v1/opencode/config" && method === "GET") {
      json(res, 200, readOpenCodeConfig());
      return;
    }
    if (pathname === "/api/v1/state" && method === "GET") {
      json(res, 200, getState());
      return;
    }
    if (pathname === "/api/v1/state" && method === "GET") {
      json(res, 200, emptyState());
      return;
    }
    json(res, 404, { error: "not found", path: pathname });
  } catch (err) {
    fail(res, err);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`roster-flow CORE API http://127.0.0.1:${PORT}`);
});
