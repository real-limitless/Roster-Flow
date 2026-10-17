import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { bootCore, stopAllCores } from "./test-helpers.mjs";

function resolveOpenCodeBin() {
  const fromEnv = String(process.env.OPENCODE_BIN || process.env.OPENCODE_BIN_TEST || "").trim();
  if (fromEnv && existsSync(fromEnv)) return { bin: fromEnv, reason: "" };
  for (const dir of String(process.env.PATH || "").split(":")) {
    if (!dir) continue;
    const cand = join(dir, "opencode");
    if (existsSync(cand)) return { bin: cand, reason: "" };
  }
  const homeBin = join(process.env.HOME || "", ".opencode/bin/opencode");
  if (process.env.HOME && existsSync(homeBin)) return { bin: homeBin, reason: "" };
  const checked = [
    fromEnv ? `OPENCODE_BIN=${fromEnv} (not a file)` : "OPENCODE_BIN is unset",
    "opencode on PATH",
    homeBin || "~/.opencode/bin/opencode",
  ];
  return { bin: "", reason: `opencode binary not found; set OPENCODE_BIN or install opencode (checked ${checked.join("; ")})` };
}

const resolvedBin = resolveOpenCodeBin();
const bin = resolvedBin.bin;
const binSkipReason = resolvedBin.reason;
if (!bin) console.log(`live harness skipped: ${binSkipReason}`);

after(() => stopAllCores());
const TOKEN = "rf_liveseats_token_0000001";

function stubServer() {
  const hits = [];
  const hitTimes = [];
  const sockets = new Set();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      hits.push(raw);
      hitTimes.push(Date.now());
      const chunk = (content, finish) =>
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: content ? { content } : {}, ...(finish ? { finish_reason: finish } : {}) }],
        })}\n\n`;
      if (raw.includes("SILENT")) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        return;
      }
      if (raw.includes("SLOWHOLD")) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        setTimeout(() => {
          res.write(chunk("slow-reply"));
          res.write(chunk("", "stop"));
          res.write("data: [DONE]\n\n");
          res.end();
        }, 4000);
        return;
      }
      if (raw.includes("SLOWAGREE")) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        setTimeout(() => {
          res.write(chunk("agree-reply"));
          setTimeout(() => {
            res.write(chunk("", "stop"));
            res.write("data: [DONE]\n\n");
            res.end();
          }, 400);
        }, 1200);
        return;
      }
      if (raw.includes("LONG")) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        res.write(chunk("hello-"));
        setTimeout(() => {
          res.write(chunk("from-x"));
          setTimeout(() => {
            res.write(chunk("", "stop"));
            res.write("data: [DONE]\n\n");
            res.end();
          }, 1500);
        }, 5000);
        return;
      }
      const body = [chunk("stub-reply-ok"), chunk("", "stop"), "data: [DONE]\n\n"].join("");
      res.writeHead(200, { "content-type": "text/event-stream", "content-length": Buffer.byteLength(body) });
      res.end(body);
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        server,
        hits,
        hitTimes,
        port: server.address().port,
        close() {
          for (const socket of sockets) socket.destroy();
          return new Promise((done) => server.close(() => done()));
        },
      }),
    );
  });
}

test("bad seats do not stop a stub seat or wiki-scribe from replying", { timeout: 120000 }, async (t) => {
  if (!bin) {
    t.skip(binSkipReason);
    return;
  }
  const stub = await stubServer();
  const core = await bootCore({
    OPENCODE_BIN: bin,
    OPENCODE_PORT: "18180",
    OPENCODE_SYSTEM_PORT: "18181",
    ROSTER_HARNESS_AUTOSTART: "1",
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_PROVIDER_ID: "stub",
    ROSTER_PROVIDER_NAME: "Stub",
    ROSTER_PROVIDER_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
    ROSTER_PROVIDER_API_KEY_ENV: "STUB_API_KEY",
    ROSTER_PROVIDER_MODELS: "stub-model",
    STUB_API_KEY: "stub-key",
    ROSTER_PROVIDER_TURN_MS: "8000",
    XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
    FEATHERLESS_API_KEY: "",
    DEAD_API_KEY: "dead-key",
  });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  try {
    let health;
    const start = Date.now();
    while (Date.now() - start < 30000) {
      health = await (await fetch(`${core.base}/api/v1/health`)).json();
      if (health.harnessReady) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(health.harnessReady, true, JSON.stringify(health));

    const dead = await fetch(`${core.base}/api/v1/providers`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        id: "dead",
        name: "Dead",
        baseURL: "http://127.0.0.1:9/v1",
        apiKeyEnv: "DEAD_API_KEY",
        models: [{ id: "dead-model" }],
      }),
    });
    assert.equal(dead.status, 200);

    async function hire(body) {
      const res = await fetch(`${core.base}/api/v1/seats`, { method: "POST", headers, body: JSON.stringify(body) });
      const json = await res.json();
      assert.equal(res.status, 201, JSON.stringify(json));
      return json;
    }

    await hire({ name: "Not Loaded", model: "stub/not-loaded-model", job: "Bad model id." });
    await hire({ name: "Unreachable", model: "dead/dead-model", job: "Port 9." });
    await hire({ name: "Builtin", model: "opencode/longcat-2.5-preview-free", job: "Built-in provider." });
    const patched = await fetch(`${core.base}/api/v1/seats/builtin`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ model: "opencode/longcat-2.5-preview-free" }),
    });
    assert.equal(patched.status, 200);
    await hire({ id: "valid", name: "Valid", model: "stub/stub-model", job: "Reaches the stub." });
    await hire({ id: "wiki-scribe", name: "Wiki Scribe", model: "stub/stub-model", job: "Wiki scribe on the stub." });

    const cfg = await (await fetch(`${core.base}/api/v1/opencode/config`, { headers })).json();
    const persisted = JSON.stringify(cfg.agent || {});
    assert.doesNotMatch(persisted, /not-loaded-model/);
    assert.doesNotMatch(persisted, /dead-model/);
    assert.doesNotMatch(persisted, /longcat/);
    assert.match(persisted, /stub\/stub-model/);

    async function say(text) {
      const res = await fetch(`${core.base}/api/v1/channels/ship/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text, who: "You" }),
      });
      const json = await res.json();
      assert.equal(res.status, 201, JSON.stringify(json));
      return json;
    }

    const bad = await say("please @NotLoaded @Unreachable @Builtin stay quiet");
    for (const name of ["not-loaded", "unreachable"]) {
      const row = (bad.wakeResults || []).find((item) => item.seat === name);
      assert.ok(row, name);
      assert.equal(row.started, false, name);
      const run = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
      const rec = (run.runs || []).find((item) => item.id === row.runId);
      assert.equal(rec?.status, "blocked", `${name} run ${rec?.status}`);
    }
    const builtin = (bad.wakeResults || []).find((item) => item.seat === "builtin");
    assert.ok(builtin);
    const builtinState = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    const builtinRun = (builtinState.runs || []).find((item) => item.id === builtin.runId);
    assert.equal(Boolean(builtin.started), builtinRun?.status === "done" || builtinRun?.status === "running");

    const before = stub.hits.length;
    const good = await say("please @Valid answer now");
    const valid = (good.wakeResults || []).find((item) => item.seat === "valid");
    assert.equal(valid?.started, true);
    const wiki = await say("please @wiki-scribe answer now");
    const scribe = (wiki.wakeResults || []).find((item) => item.seat === "wiki-scribe");
    assert.equal(scribe?.started, true);

    const state = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    assert.equal((state.runs || []).find((item) => item.id === valid.runId)?.status, "done");
    assert.equal((state.runs || []).find((item) => item.id === scribe.runId)?.status, "done");
    const room = (state.messages || []).filter((m) => m.channel === "ship");
    assert.ok(
      room.some((m) => m.seatId === "wiki-scribe" && m.text.includes("stub-reply-ok")),
      JSON.stringify({
        scribe,
        run: (state.runs || []).find((item) => item.id === scribe?.runId),
        hits: stub.hits.length,
      }),
    );
    assert.ok(!room.some((m) => m.seatId === "wiki-scribe" && /did not reply/.test(m.text)));
    const seen = stub.hits.slice(before).join("\n");
    assert.match(seen, /Valid|valid/);
    assert.match(stub.hits.join("\n"), /wiki-scribe|Wiki Scribe/);
    const logPath = join(core.dir, "data", "opencode-serve.log");
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    assert.doesNotMatch(log, /MaxListenersExceeded/);
  } finally {
    await core.stop();
    await stub.close();
  }
});

test("a seat hired after the serve is up reaches the stub and posts a reply", { timeout: 120000 }, async (t) => {
  if (!bin) {
    t.skip(binSkipReason);
    return;
  }
  const stub = await stubServer();
  const core = await bootCore({
    OPENCODE_BIN: bin,
    OPENCODE_PORT: String(19000 + Math.floor(Math.random() * 2000)),
    OPENCODE_SYSTEM_PORT: String(21000 + Math.floor(Math.random() * 2000)),
    ROSTER_HARNESS_AUTOSTART: "1",
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_NAME: "Featherless",
    ROSTER_PROVIDER_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: "stub-model",
    FEATHERLESS_API_KEY: "stub-key",
    ROSTER_PROVIDER_TURN_MS: "30000",
    XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
  });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  try {
    let health;
    const start = Date.now();
    while (Date.now() - start < 30000) {
      health = await (await fetch(`${core.base}/api/v1/health`)).json();
      if (health.harnessReady) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(health.harnessReady, true, JSON.stringify(health));
    const hired = await fetch(`${core.base}/api/v1/seats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Fresh", model: "featherless/stub-model", job: "Hired after boot." }),
    });
    const seat = await hired.json();
    assert.equal(hired.status, 201, JSON.stringify(seat));
    const before = stub.hits.length;
    const res = await fetch(`${core.base}/api/v1/channels/ship/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "please @Fresh answer now", who: "You" }),
    });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    const row = (body.wakeResults || []).find((item) => item.seat === seat.id);
    assert.equal(row?.started, true, JSON.stringify(body.wakeResults));
    assert.ok(stub.hits.length > before, "stub received no request");
    const state = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    assert.equal((state.runs || []).find((item) => item.id === row.runId)?.status, "done");
    const room = (state.messages || []).filter((m) => m.channel === "ship");
    const replies = room.filter((m) => m.seatId === seat.id && String(m.text).includes("stub-reply-ok"));
    assert.equal(replies.length, 1, room.map((m) => `${m.seatId}: ${m.text}`).join(" | "));
    const logPath = join(core.dir, "data", "opencode-serve.log");
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    assert.doesNotMatch(log, /MaxListenersExceeded/);
  } finally {
    await core.stop();
    await stub.close();
  }
});

test("a seat mid-stream finishes after a new seat is hired", { timeout: 120000 }, async (t) => {
  if (!bin) {
    t.skip(binSkipReason);
    return;
  }
  const stub = await stubServer();
  const core = await bootCore({
    OPENCODE_BIN: bin,
    OPENCODE_PORT: String(23000 + Math.floor(Math.random() * 2000)),
    OPENCODE_SYSTEM_PORT: String(25000 + Math.floor(Math.random() * 2000)),
    ROSTER_HARNESS_AUTOSTART: "1",
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_NAME: "Featherless",
    ROSTER_PROVIDER_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: "stub-model",
    FEATHERLESS_API_KEY: "stub-key",
    ROSTER_PROVIDER_TURN_MS: "4000",
    ROSTER_RESTART_WAIT_MS: "30000",
    XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
  });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  try {
    let health;
    const start = Date.now();
    while (Date.now() - start < 30000) {
      health = await (await fetch(`${core.base}/api/v1/health`)).json();
      if (health.harnessReady) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(health.harnessReady, true, JSON.stringify(health));
    async function hire(name) {
      const res = await fetch(`${core.base}/api/v1/seats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: name.toLowerCase(), name, model: "featherless/stub-model", job: `${name} after boot.` }),
      });
      const json = await res.json();
      assert.equal(res.status, 201, JSON.stringify(json));
      return json;
    }
    const seatX = await hire("StreamX");
    const xWake = fetch(`${core.base}/api/v1/channels/ship/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "LONG please @StreamX keep streaming", who: "You" }),
    });
    const heard = Date.now();
    while (!stub.hits.some((hit) => hit.includes("LONG")) && Date.now() - heard < 20000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(stub.hits.some((hit) => hit.includes("LONG")), "long provider was not reached");
    const seatY = await hire("StreamY");
    const yWake = fetch(`${core.base}/api/v1/channels/ship/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "please @StreamY answer after", who: "You" }),
    });
    const xBody = await (await xWake).json();
    const yBody = await (await yWake).json();
    const xRow = (xBody.wakeResults || []).find((item) => item.seat === seatX.id);
    const yRow = (yBody.wakeResults || []).find((item) => item.seat === seatY.id);
    assert.equal(xRow?.started, true, JSON.stringify(xBody.wakeResults));
    assert.equal(yRow?.started, true, JSON.stringify(yBody.wakeResults));
    const state = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    const room = (state.messages || []).filter((m) => m.channel === "ship");
    assert.ok(
      room.some((m) => m.seatId === seatX.id && m.runId === xRow.runId && String(m.text).includes("hello-from-x")),
      room.map((m) => `${m.seatId}: ${m.text}`).join(" | "),
    );
    assert.equal(room.filter((m) => m.runId === xRow.runId && m.seatId === seatX.id).length, 1);
    assert.equal((state.runs || []).find((item) => item.id === xRow.runId)?.status, "done");
    assert.equal((state.runs || []).find((item) => item.id === yRow.runId)?.status, "done");
    assert.ok(room.some((m) => m.seatId === seatY.id && String(m.text).includes("stub-reply-ok")));
    const yHit = stub.hits.findIndex((hit) => hit.includes("StreamY") || hit.includes(seatY.id));
    const xHit = stub.hits.findIndex((hit) => hit.includes("LONG"));
    assert.ok(xHit >= 0 && yHit > xHit, `x=${xHit} y=${yHit}`);
    const logPath = join(core.dir, "data", "opencode-serve.log");
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    assert.doesNotMatch(log, /MaxListenersExceeded/);
  } finally {
    await core.stop();
    await stub.close();
  }
});

test("bus, messages, and the channel agree on one slow wake", { timeout: 120000 }, async (t) => {
  if (!bin) {
    t.skip(binSkipReason);
    return;
  }
  const stub = await stubServer();
  const core = await bootCore({
    OPENCODE_BIN: bin,
    OPENCODE_PORT: String(26000 + Math.floor(Math.random() * 2000)),
    OPENCODE_SYSTEM_PORT: String(28000 + Math.floor(Math.random() * 2000)),
    ROSTER_HARNESS_AUTOSTART: "1",
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_NAME: "Featherless",
    ROSTER_PROVIDER_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: "stub-model",
    FEATHERLESS_API_KEY: "stub-key",
    ROSTER_PROVIDER_TURN_MS: "5000",
    XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
  });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  try {
    let health;
    const start = Date.now();
    while (Date.now() - start < 30000) {
      health = await (await fetch(`${core.base}/api/v1/health`)).json();
      if (health.harnessReady) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(health.harnessReady, true, JSON.stringify(health));
    const hired = await fetch(`${core.base}/api/v1/seats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "agree", name: "Agree", model: "featherless/stub-model", job: "Same wake everywhere." }),
    });
    const seat = await hired.json();
    assert.equal(hired.status, 201, JSON.stringify(seat));
    const [busRes, msgRes, channelRes] = await Promise.all([
      fetch(`${core.base}/api/v1/bus/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({ from: "you", to: seat.id, text: "SLOWAGREE from the bus", wake: true, channel: "ship" }),
      }),
      fetch(`${core.base}/api/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ from: "you", to: seat.id, text: "SLOWAGREE from messages" }),
      }),
      fetch(`${core.base}/api/v1/channels/ship/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "SLOWAGREE please @Agree answer", who: "You" }),
      }),
    ]);
    const bus = await busRes.json();
    const msg = await msgRes.json();
    const channel = await channelRes.json();
    assert.equal(busRes.status, 201, JSON.stringify(bus));
    assert.equal(msgRes.status, 201, JSON.stringify(msg));
    assert.equal(channelRes.status, 201, JSON.stringify(channel));
    assert.equal(bus.started, true, JSON.stringify({ bus, msg, channel: channel.wakeResults }));
    assert.equal(msg.started, bus.started);
    assert.equal(channel.started, bus.started);
    assert.equal(msg.runId, bus.runId);
    assert.equal(channel.runId, bus.runId);
    const state = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    const replies = (state.messages || []).filter((m) => m.channel === "ship" && m.runId === bus.runId && m.seatId === seat.id);
    assert.equal(replies.length, 1);
    assert.match(replies[0].text, /agree-reply/);
  } finally {
    await core.stop();
    await stub.close();
  }
});

test("a provider that accepts the request and sends nothing stays blocked", { timeout: 120000 }, async (t) => {
  if (!bin) {
    t.skip(binSkipReason);
    return;
  }
  const stub = await stubServer();
  const core = await bootCore({
    OPENCODE_BIN: bin,
    OPENCODE_PORT: String(30000 + Math.floor(Math.random() * 2000)),
    OPENCODE_SYSTEM_PORT: String(32000 + Math.floor(Math.random() * 2000)),
    ROSTER_HARNESS_AUTOSTART: "1",
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_NAME: "Featherless",
    ROSTER_PROVIDER_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: "stub-model",
    FEATHERLESS_API_KEY: "stub-key",
    ROSTER_PROVIDER_TURN_MS: "1500",
    XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
  });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  try {
    let health;
    const start = Date.now();
    while (Date.now() - start < 30000) {
      health = await (await fetch(`${core.base}/api/v1/health`)).json();
      if (health.harnessReady) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(health.harnessReady, true, JSON.stringify(health));
    const hired = await fetch(`${core.base}/api/v1/seats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "quiet", name: "Quiet", model: "featherless/stub-model", job: "Never answers." }),
    });
    const seat = await hired.json();
    assert.equal(hired.status, 201, JSON.stringify(seat));
    const calls = [
      () =>
        fetch(`${core.base}/api/v1/bus/send`, {
          method: "POST",
          headers,
          body: JSON.stringify({ from: "you", to: seat.id, text: "SILENT from the bus", wake: true, channel: "ship" }),
        }),
      () =>
        fetch(`${core.base}/api/v1/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ from: "you", to: seat.id, text: "SILENT from messages" }),
        }),
      () =>
        fetch(`${core.base}/api/v1/channels/ship/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ text: "SILENT please @Quiet stay quiet", who: "You" }),
        }),
    ];
    const bodies = [];
    for (const call of calls) {
      const res = await call();
      const body = await res.json();
      assert.equal(res.status, 201, JSON.stringify(body));
      bodies.push(body);
    }
    assert.ok(bodies.every((body) => body.started === false), JSON.stringify(bodies.map((body) => body.started)));
    const state = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    for (const body of bodies) {
      const run = (state.runs || []).find((item) => item.id === body.runId);
      assert.equal(run?.status, "blocked", JSON.stringify(run));
      assert.ok(
        (state.messages || []).some((m) => m.channel === "ship" && m.system && String(m.text).includes(body.runId)),
        body.runId,
      );
    }
  } finally {
    await core.stop();
    await stub.close();
  }
});

test("each endpoint posts a seat reply exactly once", { timeout: 120000 }, async (t) => {
  if (!bin) {
    t.skip(binSkipReason);
    return;
  }
  const stub = await stubServer();
  const core = await bootCore({
    OPENCODE_BIN: bin,
    OPENCODE_PORT: String(33000 + Math.floor(Math.random() * 1500)),
    OPENCODE_SYSTEM_PORT: String(34500 + Math.floor(Math.random() * 1500)),
    ROSTER_HARNESS_AUTOSTART: "1",
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_NAME: "Featherless",
    ROSTER_PROVIDER_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: "stub-model",
    FEATHERLESS_API_KEY: "stub-key",
    ROSTER_PROVIDER_TURN_MS: "8000",
    XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
  });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  try {
    let health;
    const start = Date.now();
    while (Date.now() - start < 30000) {
      health = await (await fetch(`${core.base}/api/v1/health`)).json();
      if (health.harnessReady) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(health.harnessReady, true);
    const hired = await fetch(`${core.base}/api/v1/seats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "rep", name: "Rep", model: "featherless/stub-model", job: "Count replies." }),
    });
    const seat = await hired.json();
    assert.equal(hired.status, 201, JSON.stringify(seat));
    const calls = [
      (i) =>
        fetch(`${core.base}/api/v1/bus/send`, {
          method: "POST",
          headers,
          body: JSON.stringify({ from: "you", to: seat.id, text: `bus reply ${i}`, wake: true, channel: "ship" }),
        }),
      (i) =>
        fetch(`${core.base}/api/v1/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ from: `caller-${i}`, to: seat.id, text: `messages reply ${i}` }),
        }),
      (i) =>
        fetch(`${core.base}/api/v1/channels/ship/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ text: `@Rep channel reply ${i}`, who: "You" }),
        }),
    ];
    const runIds = [];
    for (const call of calls) {
      for (let i = 1; i <= 2; i++) {
        const res = await call(i);
        const body = await res.json();
        assert.equal(res.status, 201, JSON.stringify(body));
        assert.equal(body.started, true, JSON.stringify(body.wakeResults || body));
        runIds.push(body.runId);
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
    const state = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    const replies = (state.messages || []).filter((m) => m.seatId === seat.id && !m.system);
    assert.equal(replies.length, runIds.length, replies.map((m) => `${m.runId || "NO-RUNID"}:${m.text}`).join(" | "));
    for (const id of runIds) {
      assert.equal(replies.filter((m) => m.runId === id).length, 1, id);
    }
    assert.equal(replies.filter((m) => !m.runId).length, 0);
  } finally {
    await core.stop();
    await stub.close();
  }
});

test("a slow provider agrees on started false and still finishes", { timeout: 120000 }, async (t) => {
  if (!bin) {
    t.skip(binSkipReason);
    return;
  }
  const stub = await stubServer();
  const core = await bootCore({
    OPENCODE_BIN: bin,
    OPENCODE_PORT: String(36000 + Math.floor(Math.random() * 1500)),
    OPENCODE_SYSTEM_PORT: String(37500 + Math.floor(Math.random() * 1500)),
    ROSTER_HARNESS_AUTOSTART: "1",
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_NAME: "Featherless",
    ROSTER_PROVIDER_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: "stub-model",
    FEATHERLESS_API_KEY: "stub-key",
    ROSTER_PROVIDER_TURN_MS: "1500",
    XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
  });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  try {
    let health;
    const start = Date.now();
    while (Date.now() - start < 30000) {
      health = await (await fetch(`${core.base}/api/v1/health`)).json();
      if (health.harnessReady) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(health.harnessReady, true);
    const hired = await fetch(`${core.base}/api/v1/seats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "slow", name: "Slow", model: "featherless/stub-model", job: "Answers late." }),
    });
    const seat = await hired.json();
    assert.equal(hired.status, 201, JSON.stringify(seat));
    const calls = [
      () =>
        fetch(`${core.base}/api/v1/bus/send`, {
          method: "POST",
          headers,
          body: JSON.stringify({ from: "you", to: seat.id, text: "SLOWHOLD from the bus", wake: true, channel: "ship" }),
        }),
      () =>
        fetch(`${core.base}/api/v1/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ from: "you", to: seat.id, text: "SLOWHOLD from messages" }),
        }),
      () =>
        fetch(`${core.base}/api/v1/channels/ship/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ text: "SLOWHOLD please @Slow answer", who: "You" }),
        }),
    ];
    const bodies = [];
    for (const call of calls) {
      const res = await call();
      const body = await res.json();
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.equal(body.started, false, JSON.stringify({ runId: body.runId, started: body.started }));
      const deadline = Date.now() + 12000;
      let state;
      while (Date.now() < deadline) {
        state = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
        const run = (state.runs || []).find((item) => item.id === body.runId);
        const replies = (state.messages || []).filter((m) => m.runId === body.runId && m.seatId === seat.id);
        if (run?.status === "done" && replies.length === 1) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const run = (state.runs || []).find((item) => item.id === body.runId);
      const replies = (state.messages || []).filter((m) => m.runId === body.runId && m.seatId === seat.id);
      assert.equal(run?.status, "done", JSON.stringify(run));
      assert.equal(replies.length, 1, JSON.stringify(replies));
      assert.match(replies[0].text, /slow-reply/);
      bodies.push(body);
    }
    assert.deepEqual(bodies.map((body) => body.started), [false, false, false]);
  } finally {
    await core.stop();
    await stub.close();
  }
});

test("two mentions in one message reach the provider together", { timeout: 120000 }, async (t) => {
  if (!bin) {
    t.skip(binSkipReason);
    return;
  }
  const stub = await stubServer();
  const core = await bootCore({
    OPENCODE_BIN: bin,
    OPENCODE_PORT: String(39000 + Math.floor(Math.random() * 1500)),
    OPENCODE_SYSTEM_PORT: String(40500 + Math.floor(Math.random() * 1500)),
    ROSTER_HARNESS_AUTOSTART: "1",
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_NAME: "Featherless",
    ROSTER_PROVIDER_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: "stub-model",
    FEATHERLESS_API_KEY: "stub-key",
    ROSTER_PROVIDER_TURN_MS: "8000",
    XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
  });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  try {
    let health;
    const start = Date.now();
    while (Date.now() - start < 30000) {
      health = await (await fetch(`${core.base}/api/v1/health`)).json();
      if (health.harnessReady) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(health.harnessReady, true);
    for (const name of ["FastSeat", "SlowSeat"]) {
      const res = await fetch(`${core.base}/api/v1/seats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: name.toLowerCase(), name, model: "featherless/stub-model", job: name }),
      });
      assert.equal(res.status, 201, await res.text());
    }
    const before = stub.hits.length;
    const res = await fetch(`${core.base}/api/v1/channels/ship/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "please @FastSeat and @SlowSeat go now", who: "You" }),
    });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body.wakeResults));
    const fast = (body.wakeResults || []).find((row) => row.seat === "fastseat");
    const slow = (body.wakeResults || []).find((row) => row.seat === "slowseat");
    const early = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    const why = (id) => (early.runs || []).find((item) => item.id === id);
    assert.equal(fast?.started, true, JSON.stringify({ wake: body.wakeResults, fast: why(fast?.runId), slow: why(slow?.runId) }));
    assert.equal(slow?.started, true, JSON.stringify({ wake: body.wakeResults, fast: why(fast?.runId), slow: why(slow?.runId) }));
    const mine = stub.hits.slice(before);
    const times = stub.hitTimes.slice(before);
    const fastAt = mine.findIndex((hit) => hit.includes("You are FastSeat"));
    const slowAt = mine.findIndex((hit) => hit.includes("You are SlowSeat"));
    assert.ok(fastAt >= 0 && slowAt >= 0, String(mine.length));
    assert.ok(Math.abs(times[fastAt] - times[slowAt]) < 2500, `${times[fastAt]} ${times[slowAt]}`);
    const state = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    for (const row of [fast, slow]) {
      assert.equal((state.runs || []).find((item) => item.id === row.runId)?.status, "done");
      assert.equal((state.messages || []).filter((m) => m.runId === row.runId && !m.system).length, 1);
    }
  } finally {
    await core.stop();
    await stub.close();
  }
});

test("both harnesses load featherless and a channel mention gets a reply", { timeout: 120000 }, async (t) => {
  if (!bin) {
    t.skip(binSkipReason);
    return;
  }
  const stub = await stubServer();
  const core = await bootCore({
    OPENCODE_BIN: bin,
    OPENCODE_PORT: String(42000 + Math.floor(Math.random() * 1500)),
    OPENCODE_SYSTEM_PORT: String(43500 + Math.floor(Math.random() * 1500)),
    ROSTER_HARNESS_AUTOSTART: "1",
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_NAME: "Featherless",
    ROSTER_PROVIDER_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: "stub-model",
    FEATHERLESS_API_KEY: "stub-key",
    ROSTER_PROVIDER_TURN_MS: "8000",
    XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
  });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  try {
    let health;
    const start = Date.now();
    while (Date.now() - start < 30000) {
      health = await (await fetch(`${core.base}/api/v1/health`)).json();
      if (health.harness === "up" && health.systemHarness?.harness === "up") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok((health.loadedProviders || []).includes("featherless"), JSON.stringify(health.loadedProviders));
    assert.ok(
      (health.systemHarness?.loadedProviders || []).includes("featherless"),
      JSON.stringify(health.systemHarness?.loadedProviders),
    );
    assert.equal(health.harnessReady, true, health.harnessError || JSON.stringify(health.loadedProviders));
    const hired = await fetch(`${core.base}/api/v1/seats`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "wiki-scribe",
        name: "Wiki Scribe",
        model: "featherless/stub-model",
        job: "Answer in the wiki room.",
      }),
    });
    const seat = await hired.json();
    assert.equal(hired.status, 201, JSON.stringify(seat));
    const res = await fetch(`${core.base}/api/v1/channels/team-wiki/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "@wiki-scribe hello from the wiki room", who: "You" }),
    });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    const row = (body.wakeResults || []).find((item) => item.seat === "wiki-scribe");
    assert.equal(row?.started, true, JSON.stringify(body.wakeResults || body));
    const state = await (await fetch(`${core.base}/api/v1/state`, { headers })).json();
    const run = (state.runs || []).find((item) => item.id === row.runId);
    assert.equal(run?.status, "done", JSON.stringify(run));
    assert.ok(
      (state.messages || []).some((m) => m.channel === "team-wiki" && m.seatId === "wiki-scribe" && String(m.text).includes("stub-reply-ok")),
      (state.messages || []).filter((m) => m.channel === "team-wiki").map((m) => `${m.seatId}: ${m.text}`).join(" | "),
    );
  } finally {
    await core.stop();
    await stub.close();
  }
});
