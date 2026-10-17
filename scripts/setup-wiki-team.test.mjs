import assert from "node:assert/strict";
import test from "node:test";
import { setupWikiTeam } from "./setup-wiki-team.mjs";

function fakeCore({ teamExists = false, seats = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    calls.push({ path, method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    let status = 200;
    let data = {};
    if (path === "/api/v1/projects") status = teamExists ? 409 : 201;
    if (path === "/api/v1/teams") status = teamExists ? 409 : 201;
    if (path === "/api/v1/seats" && method === "GET") data = seats;
    if (path === "/api/v1/seats" && method === "POST") status = 201;
    return { ok: status < 300, status, text: async () => JSON.stringify(data) };
  };
  return { calls, fetchImpl };
}

test("setup-wiki-team registers Featherless by env ref, project, and @wiki team", async () => {
  const { calls, fetchImpl } = fakeCore();
  const out = await setupWikiTeam({ env: { FEATHERLESS_API_KEY: "secret", ROSTER_API_TOKEN: "rf_test" }, fetchImpl, log() {} });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["PUT /api/v1/providers", "POST /api/v1/projects", "POST /api/v1/teams"]);
  assert.equal(calls[0].body.apiKeyEnv, "FEATHERLESS_API_KEY");
  assert.ok(!JSON.stringify(calls).includes("secret"), "API key must never be sent or written");
  const ids = calls[2].body.specialists.map((s) => s.id);
  assert.deepEqual(ids, ["wiki-architect", "wiki-scribe", "wiki-diagrammer", "wiki-editor"]);
  assert.ok(calls[2].body.specialists.every((s) => s.model.startsWith("featherless/")));
  assert.equal(calls[2].body.defaultModel, "featherless/deepseek-ai/DeepSeek-V4.1-Flash");
  const modelIds = calls[0].body.models.map((m) => m.id);
  assert.ok(modelIds.includes("deepseek-ai/DeepSeek-V4.1-Flash"));
  assert.ok(modelIds.includes("Qwen/Qwen2.5-Coder-32B-Instruct"));
  for (const spec of calls[2].body.specialists) {
    assert.ok(modelIds.includes(spec.model.slice("featherless/".length)), spec.model);
  }
  assert.equal(out.model, "deepseek-ai/DeepSeek-V4.1-Flash");
  assert.equal(out.teamCreated, true);
  assert.ok(calls.every((c) => c.headers.authorization === "Bearer rf_test"));
});

test("setup-wiki-team adds a non-default WIKI_MODEL and accepts a featherless/ ref", async () => {
  const custom = fakeCore();
  await setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_test", WIKI_MODEL: "Qwen/Qwen2.5-Coder-32B-Instruct" }, fetchImpl: custom.fetchImpl, log() {} });
  const ids = custom.calls[0].body.models.map((m) => m.id);
  assert.ok(ids.includes("Qwen/Qwen2.5-Coder-32B-Instruct"));
  assert.ok(ids.includes("deepseek-ai/DeepSeek-V4.1-Flash"));
  assert.equal(custom.calls[2].body.defaultModel, "featherless/Qwen/Qwen2.5-Coder-32B-Instruct");
  assert.ok(custom.calls[2].body.specialists.every((s) => s.model === "featherless/Qwen/Qwen2.5-Coder-32B-Instruct"));

  const prefixed = fakeCore();
  const out = await setupWikiTeam({
    env: { ROSTER_API_TOKEN: "rf_test", WIKI_MODEL: "featherless/org/custom-model" },
    fetchImpl: prefixed.fetchImpl,
    log() {},
  });
  assert.equal(out.model, "org/custom-model");
  assert.equal(prefixed.calls[2].body.defaultModel, "featherless/org/custom-model");
  assert.ok(prefixed.calls[0].body.models.some((m) => m.id === "org/custom-model"));
});

test("setup-wiki-team is idempotent: on 409 it only hires missing specialists", async () => {
  const { calls, fetchImpl } = fakeCore({ teamExists: true, seats: [{ id: "wiki-architect" }, { id: "wiki-scribe" }] });
  const out = await setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_test" }, fetchImpl, log() {} });
  assert.deepEqual(out.hired, ["wiki-diagrammer", "wiki-editor"]);
  const posts = calls.filter((c) => c.method === "POST" && c.path === "/api/v1/seats");
  assert.equal(posts.length, 2);
});

test("setup-wiki-team requires a token and reports a rejected one", async () => {
  await assert.rejects(setupWikiTeam({ env: {}, fetchImpl: async () => ({}), log() {} }), /ROSTER_API_TOKEN is required/);
  const revoked = async () => ({ ok: false, status: 401, text: async () => '{"error":"invalid, expired, or revoked API token"}' });
  await assert.rejects(setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_x" }, fetchImpl: revoked, log() {} }), /rejected \(401\)/);
});

test("setup-wiki-team explains a CORE that cannot write its data volume", async () => {
  const eacces = async () => ({
    ok: false,
    status: 500,
    text: async () => JSON.stringify({ error: "EACCES: permission denied, open '/data/opencode/opencode.json'", detail: "EACCES" }),
  });
  await assert.rejects(
    setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_x" }, fetchImpl: eacces, log() {} }),
    (err) => {
      assert.match(err.message, /^provider: 500 EACCES: permission denied, open '\/data\/opencode\/opencode\.json'/);
      assert.match(err.message, /CORE cannot write its data volume\. Start roster-flow as root/);
      return true;
    },
  );
  const other = async () => ({ ok: false, status: 500, text: async () => '{"error":"boom"}' });
  await assert.rejects(setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_x" }, fetchImpl: other, log() {} }), (err) => {
    assert.equal(err.message, "provider: 500 boom");
    return true;
  });
});
