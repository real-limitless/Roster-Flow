import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { bootCore } from "./test-helpers.mjs";
import { envHasProvider, providerFromEnv, shouldAutostartHarness, withSeatModels } from "./autostart.mjs";

const TOKEN = "rf_autostarttoken00000001";

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("providerFromEnv requires an id and at least one model", () => {
  assert.equal(providerFromEnv({}), null);
  assert.equal(providerFromEnv({ ROSTER_PROVIDER_ID: "featherless" }), null);
  const spec = providerFromEnv({
    ROSTER_PROVIDER_ID: "Featherless",
    ROSTER_PROVIDER_NAME: "Featherless",
    ROSTER_PROVIDER_BASE_URL: "https://api.featherless.ai/v1",
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: " model-a, model-b ",
    ROSTER_PROVIDER_NPM: "@ai-sdk/openai-compatible",
  });
  assert.equal(spec.id, "Featherless");
  assert.equal(spec.baseURL, "https://api.featherless.ai/v1");
  assert.equal(spec.apiKeyEnv, "FEATHERLESS_API_KEY");
  assert.deepEqual(spec.models, [
    { id: "model-a", name: "model-a" },
    { id: "model-b", name: "model-b" },
  ]);
});

test("withSeatModels unions assigned featherless models onto the env list", () => {
  const spec = { id: "featherless", models: [{ id: "stub-model", name: "stub-model" }] };
  const out = withSeatModels(spec, {
    seats: [
      { model: "featherless/deepseek-ai/DeepSeek-V4.1-Flash" },
      { model: "featherless/Qwen/Qwen2.5-Coder-32B-Instruct" },
      { model: "opencode/big-pickle" },
      { model: "xai/grok-4" },
    ],
    teams: [{ defaultModel: "featherless/deepseek-ai/DeepSeek-V4.1-Flash", allowedModels: ["featherless/extra-model"] }],
  });
  assert.deepEqual(out.models.map((m) => m.id), [
    "stub-model",
    "deepseek-ai/DeepSeek-V4.1-Flash",
    "Qwen/Qwen2.5-Coder-32B-Instruct",
    "extra-model",
  ]);
});

test("shouldAutostartHarness needs an owner, a provider, and no kill switch", () => {
  const env = { ROSTER_PROVIDER_ID: "demo", ROSTER_PROVIDER_MODELS: "m" };
  assert.equal(shouldAutostartHarness({ users: [] }, env, true), false);
  assert.equal(shouldAutostartHarness({ users: [{ id: "u" }] }, env, false), false);
  assert.equal(shouldAutostartHarness({ users: [{ id: "u" }] }, { ...env, ROSTER_DISABLE_HARNESS_AUTOSTART: "1" }, true), false);
  assert.equal(shouldAutostartHarness({ users: [{ id: "u" }] }, env, true), true);
});

test("ROSTER_HARNESS_AUTOSTART selects auto, always, or never", () => {
  const owner = { users: [{ id: "u" }] };
  assert.equal(shouldAutostartHarness(owner, { ROSTER_HARNESS_AUTOSTART: "0" }, true), false);
  assert.equal(shouldAutostartHarness(owner, { ROSTER_HARNESS_AUTOSTART: "auto" }, false), false);
  assert.equal(shouldAutostartHarness(owner, { ROSTER_HARNESS_AUTOSTART: "auto" }, true), true);
  assert.equal(shouldAutostartHarness(owner, { ROSTER_HARNESS_AUTOSTART: "1" }, false), true);
  assert.equal(shouldAutostartHarness({ users: [] }, { ROSTER_HARNESS_AUTOSTART: "1" }, true), false);
  assert.equal(shouldAutostartHarness(owner, { ROSTER_HARNESS_AUTOSTART: "1", ROSTER_DISABLE_HARNESS_AUTOSTART: "1" }, true), false);
});

test("auto counts FEATHERLESS_API_KEY and a named provider key env", () => {
  const owner = { users: [{ id: "u" }] };
  assert.equal(envHasProvider({}), false);
  assert.equal(envHasProvider({ FEATHERLESS_API_KEY: "secret" }), true);
  assert.equal(envHasProvider({ ROSTER_PROVIDER_API_KEY_ENV: "ACME_KEY", ACME_KEY: "secret" }), true);
  assert.equal(envHasProvider({ ROSTER_PROVIDER_API_KEY_ENV: "ACME_KEY" }), false);
  assert.equal(shouldAutostartHarness(owner, { ROSTER_HARNESS_AUTOSTART: "auto", FEATHERLESS_API_KEY: "secret" }), true);
  assert.equal(shouldAutostartHarness(owner, { ROSTER_HARNESS_AUTOSTART: "0", FEATHERLESS_API_KEY: "secret" }), false);
});

test("fresh container with owner and provider reports harness ready", async () => {
  const company = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: "fake-company" }));
  });
  const system = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: "fake-system" }));
  });
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_NAME: "Featherless",
    ROSTER_PROVIDER_BASE_URL: "https://api.featherless.ai/v1",
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: "demo-small",
    ROSTER_HARNESS_AUTOSTART: "auto",
    OPENCODE_PORT: String(company.address().port),
    OPENCODE_SYSTEM_PORT: String(system.address().port),
    OPENCODE_BIN: "/nonexistent/opencode",
  });
  try {
    const providers = await fetch(`${core.base}/api/v1/providers`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(providers.status, 200);
    const list = await providers.json();
    const seeded = list.find((p) => p.id === "featherless");
    assert.ok(seeded);
    assert.equal(seeded.baseURL, "https://api.featherless.ai/v1");
    assert.equal(seeded.apiKeyEnv, "FEATHERLESS_API_KEY");
    assert.deepEqual(seeded.models.map((m) => m.id), ["demo-small", "deepseek-ai/DeepSeek-V4.1-Flash"]);

    let health;
    const start = Date.now();
    while (Date.now() - start < 8000) {
      const res = await fetch(`${core.base}/api/v1/health`);
      health = await res.json();
      if (health.harness === "up" && health.systemHarness?.harness === "up") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(health.ok, true);
    assert.equal(health.harness, "up");
    assert.equal(health.systemHarness.harness, "up");
    assert.equal(health.harnessReady, true);
    assert.equal(health.ready, true);
    assert.ok(Array.isArray(health.seats));
    const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
    for (const body of [
      { id: "seat-ready", name: "Eng.Build", model: "opencode/big-pickle", job: "Ship." },
      { id: "seat-gap", name: "Wiki Scribe", model: "featherless/demo-small", job: "Write." },
    ]) {
      const hired = await fetch(`${core.base}/api/v1/seats`, { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(hired.status, 201, await hired.text());
    }
    health = await (await fetch(`${core.base}/api/v1/health`)).json();
    assert.equal(health.harnessReady, true, health.harnessError || JSON.stringify(health.seats));
    const build = health.seats.find((row) => row.seat === "seat-ready");
    const wiki = health.seats.find((row) => row.seat === "seat-gap");
    assert.equal(build?.ready, true);
    assert.equal(wiki?.ready, false);
    assert.match(wiki?.error || "", /Wiki Scribe needs featherless\/demo-small/);
    const harnessRes = await fetch(`${core.base}/api/v1/harness`, { headers });
    const harnessBody = await harnessRes.json();
    assert.equal(harnessRes.status, 200);
    assert.equal(harnessBody.harnessReady, true);
    assert.equal(harnessBody.seats.find((row) => row.seat === "seat-gap")?.ready, false);
    assert.equal(harnessBody.harnessError, null);
    assert.equal(health.version, "fake-company");
    assert.equal(health.systemHarness.version, "fake-system");
  } finally {
    await core.stop();
    await close(company);
    await close(system);
  }
});

test("ROSTER_HARNESS_AUTOSTART=auto starts from FEATHERLESS_API_KEY alone", async () => {
  const company = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: "fake-featherless" }));
  });
  const system = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: "fake-system" }));
  });
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_HARNESS_AUTOSTART: "auto",
    ROSTER_PROVIDER_ID: "",
    ROSTER_PROVIDER_MODELS: "",
    ROSTER_PROVIDER_API_KEY_ENV: "",
    XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
    FEATHERLESS_API_KEY: "test-key",
    OPENCODE_PORT: String(company.address().port),
    OPENCODE_SYSTEM_PORT: String(system.address().port),
    OPENCODE_BIN: "/nonexistent/opencode",
  });
  try {
    let health;
    const start = Date.now();
    while (Date.now() - start < 8000) {
      health = await (await fetch(`${core.base}/api/v1/health`)).json();
      if (health.harnessReady) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(health.harness, "up");
    assert.equal(health.harnessReady, true);
    assert.equal(health.version, "fake-featherless");
  } finally {
    await core.stop();
    await close(company);
    await close(system);
  }
});

test("missing OpenCode binary stays up with harness offline", async () => {
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_MODELS: "demo-small",
    OPENCODE_BIN: "/nonexistent/opencode",
    OPENCODE_PORT: "1",
    OPENCODE_SYSTEM_PORT: "1",
  });
  try {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`${core.base}/api/v1/health`);
    assert.equal(res.status, 200);
    const health = await res.json();
    assert.equal(health.ok, true);
    assert.equal(health.harness, "offline");
    assert.equal(health.systemHarness.harness, "offline");
    assert.equal(health.harnessReady, false);
    assert.equal(health.ready, false);
  } finally {
    await core.stop();
  }
});
