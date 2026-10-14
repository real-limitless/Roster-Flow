import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { bootCore } from "./test-helpers.mjs";
import { providerFromEnv, shouldAutostartHarness } from "./autostart.mjs";

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

test("shouldAutostartHarness needs an owner, a provider, and no kill switch", () => {
  const env = { ROSTER_PROVIDER_ID: "demo", ROSTER_PROVIDER_MODELS: "m" };
  assert.equal(shouldAutostartHarness({ users: [] }, env, true), false);
  assert.equal(shouldAutostartHarness({ users: [{ id: "u" }] }, env, false), false);
  assert.equal(shouldAutostartHarness({ users: [{ id: "u" }] }, { ...env, ROSTER_DISABLE_HARNESS_AUTOSTART: "1" }, true), false);
  assert.equal(shouldAutostartHarness({ users: [{ id: "u" }] }, env, true), true);
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
    assert.deepEqual(seeded.models.map((m) => m.id), ["demo-small"]);

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
    assert.equal(health.ready, true);
    assert.equal(health.version, "fake-company");
    assert.equal(health.systemHarness.version, "fake-system");
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
    assert.equal(health.ready, false);
  } finally {
    await core.stop();
  }
});
