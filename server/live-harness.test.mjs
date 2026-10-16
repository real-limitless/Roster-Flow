import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { bootCore } from "./test-helpers.mjs";

const bin = process.env.OPENCODE_BIN_TEST || `${process.env.HOME}/.opencode/bin/opencode`;
const TOKEN = "rf_liveseats_token_0000001";

function stubServer() {
  const hits = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      hits.push(raw);
      const chunk = (content, finish) =>
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: content ? { content } : {}, ...(finish ? { finish_reason: finish } : {}) }],
        })}\n\n`;
      if (raw.includes("LONG")) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        res.write(chunk("hello-"));
        setTimeout(() => {
          res.write(chunk("from-x"));
          setTimeout(() => {
            res.write(chunk("", "stop"));
            res.write("data: [DONE]\n\n");
            res.end();
          }, 1200);
        }, 1200);
        return;
      }
      const body = [chunk("stub-reply-ok"), chunk("", "stop"), "data: [DONE]\n\n"].join("");
      res.writeHead(200, { "content-type": "text/event-stream", "content-length": Buffer.byteLength(body) });
      res.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, hits, port: server.address().port }));
  });
}

test("bad seats do not stop a stub seat or wiki-scribe from replying", { timeout: 120000 }, async (t) => {
  if (!existsSync(bin)) {
    t.skip("opencode 1.19.x is not installed");
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
    await new Promise((resolve) => stub.server.close(resolve));
  }
});

test("a seat hired after the serve is up reaches the stub and posts a reply", { timeout: 120000 }, async (t) => {
  if (!existsSync(bin)) {
    t.skip("opencode 1.19.x is not installed");
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
    assert.ok(room.some((m) => m.seatId === seat.id && String(m.text).includes("stub-reply-ok")), room.map((m) => `${m.seatId}: ${m.text}`).join(" | "));
    const logPath = join(core.dir, "data", "opencode-serve.log");
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    assert.doesNotMatch(log, /MaxListenersExceeded/);
  } finally {
    await core.stop();
    await new Promise((resolve) => stub.server.close(resolve));
  }
});

test("a seat mid-stream finishes after a new seat is hired", { timeout: 120000 }, async (t) => {
  if (!existsSync(bin)) {
    t.skip("opencode 1.19.x is not installed");
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
    ROSTER_PROVIDER_TURN_MS: "2000",
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
    await new Promise((resolve) => stub.server.close(resolve));
  }
});
