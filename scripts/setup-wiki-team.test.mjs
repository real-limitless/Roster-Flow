import assert from "node:assert/strict";
import test from "node:test";
import { setupWikiTeam } from "./setup-wiki-team.mjs";

function fakeCore({ teamExists = false, seats = [], teams = [], providers = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    calls.push({ path, method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    let status = 200;
    let data = {};
    if (path === "/api/v1/providers" && method === "GET") data = providers;
    if (path === "/api/v1/projects") status = teamExists ? 409 : 201;
    if (path === "/api/v1/teams" && method === "GET") data = teams;
    if (path === "/api/v1/teams" && method === "POST") status = teamExists ? 409 : 201;
    if (path === "/api/v1/seats" && method === "GET") data = seats;
    if (path === "/api/v1/seats" && method === "POST") status = 201;
    return { ok: status < 300, status, text: async () => JSON.stringify(data) };
  };
  return { calls, fetchImpl };
}

const READS = ["GET /api/v1/providers", "GET /api/v1/seats", "GET /api/v1/teams"];
const offlineCatalog = async () => {
  throw new Error("offline");
};

test("setup-wiki-team registers Featherless by env ref, project, and @wiki team", async () => {
  const { calls, fetchImpl } = fakeCore();
  const out = await setupWikiTeam({ env: { FEATHERLESS_API_KEY: "secret", ROSTER_API_TOKEN: "rf_test" }, fetchImpl, catalogFetch: offlineCatalog, log() {} });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [...READS, "PUT /api/v1/providers", "POST /api/v1/projects", "POST /api/v1/teams"]);
  const put = calls.find((c) => c.method === "PUT");
  const team = calls.find((c) => c.method === "POST" && c.path === "/api/v1/teams");
  assert.equal(put.body.apiKeyEnv, "FEATHERLESS_API_KEY");
  assert.ok(!JSON.stringify(calls).includes("secret"), "API key must never be sent or written");
  const ids = team.body.specialists.map((s) => s.id);
  assert.deepEqual(ids, ["wiki-architect", "wiki-scribe", "wiki-diagrammer", "wiki-editor"]);
  assert.ok(team.body.specialists.every((s) => s.model.startsWith("featherless/")));
  assert.equal(team.body.defaultModel, "featherless/deepseek-ai/DeepSeek-V4.1-Flash");
  const modelIds = put.body.models.map((m) => m.id);
  assert.ok(modelIds.includes("deepseek-ai/DeepSeek-V4.1-Flash"));
  assert.ok(modelIds.includes("Qwen/Qwen2.5-Coder-32B-Instruct"));
  assert.ok(put.body.models.every((m) => m.limit.context > 0 && m.limit.output >= 512));
  assert.equal(put.body.models.find((m) => m.id === "deepseek-ai/DeepSeek-V4.1-Flash").limit.context, 262144);
  for (const spec of team.body.specialists) {
    assert.ok(modelIds.includes(spec.model.slice("featherless/".length)), spec.model);
  }
  assert.equal(out.model, "deepseek-ai/DeepSeek-V4.1-Flash");
  assert.equal(out.teamCreated, true);
  assert.ok(calls.every((c) => c.headers.authorization === "Bearer rf_test"));
});

test("setup-wiki-team adds a non-default WIKI_MODEL and accepts a featherless/ ref", async () => {
  const custom = fakeCore();
  await setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_test", WIKI_MODEL: "Qwen/Qwen2.5-Coder-32B-Instruct" }, fetchImpl: custom.fetchImpl, catalogFetch: offlineCatalog, log() {} });
  const put = custom.calls.find((c) => c.method === "PUT");
  const team = custom.calls.find((c) => c.method === "POST" && c.path === "/api/v1/teams");
  const ids = put.body.models.map((m) => m.id);
  assert.ok(ids.includes("Qwen/Qwen2.5-Coder-32B-Instruct"));
  assert.ok(ids.includes("deepseek-ai/DeepSeek-V4.1-Flash"));
  assert.equal(team.body.defaultModel, "featherless/Qwen/Qwen2.5-Coder-32B-Instruct");
  assert.ok(team.body.specialists.every((s) => s.model === "featherless/Qwen/Qwen2.5-Coder-32B-Instruct"));

  const prefixed = fakeCore();
  const out = await setupWikiTeam({
    env: { ROSTER_API_TOKEN: "rf_test", WIKI_MODEL: "featherless/org/custom-model" },
    fetchImpl: prefixed.fetchImpl,
    catalogFetch: offlineCatalog,
    log() {},
  });
  assert.equal(out.model, "org/custom-model");
  const prefixedTeam = prefixed.calls.find((c) => c.method === "POST" && c.path === "/api/v1/teams");
  const prefixedPut = prefixed.calls.find((c) => c.method === "PUT");
  assert.equal(prefixedTeam.body.defaultModel, "featherless/org/custom-model");
  assert.ok(prefixedPut.body.models.some((m) => m.id === "org/custom-model"));
});

test("setup-wiki-team keeps featherless models used by seats outside the wiki", async () => {
  const { calls, fetchImpl } = fakeCore({
    providers: [
      {
        id: "featherless",
        models: [
          { id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen" },
          { id: "kept-extra", name: "Kept extra" },
          { id: "bogus-87", name: "Bogus" },
        ],
      },
    ],
    seats: [
      {
        id: "llama-seat",
        model: "featherless/meta-llama/Llama-3.3-70B-Instruct",
        fallbackModel: "featherless/org/fallback-model",
      },
      { id: "other", model: "openai/gpt-5" },
    ],
    teams: [
      {
        id: "eng",
        defaultModel: "featherless/deepseek-ai/DeepSeek-V4.1-Flash",
        allowedModels: ["featherless/team-allowed", "openai/gpt-5"],
      },
    ],
  });
  const lines = [];
  await setupWikiTeam({
    env: { ROSTER_API_TOKEN: "rf_test" },
    fetchImpl,
    catalogFetch: offlineCatalog,
    log(msg) {
      lines.push(msg);
    },
  });
  assert.ok(lines.some((line) => /catalog unreachable/.test(line)));
  const ids = calls.find((c) => c.method === "PUT").body.models.map((m) => m.id);
  for (const id of [
    "meta-llama/Llama-3.3-70B-Instruct",
    "kept-extra",
    "org/fallback-model",
    "team-allowed",
    "deepseek-ai/DeepSeek-V4.1-Flash",
    "Qwen/Qwen2.5-Coder-32B-Instruct",
    "bogus-87",
  ]) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(!ids.includes("openai/gpt-5"));
  assert.ok(!ids.includes("gpt-5"));
});

test("setup-wiki-team omits an in-use featherless id the upstream catalog does not offer", async () => {
  const { calls, fetchImpl } = fakeCore({
    seats: [{ id: "llama-seat", model: "featherless/meta-llama/Llama-3.3-70B-Instruct" }],
  });
  await setupWikiTeam({
    env: { ROSTER_API_TOKEN: "rf_test" },
    fetchImpl,
    catalogFetch: async () => new Set(["deepseek-ai/DeepSeek-V4.1-Flash"]),
    log() {},
  });
  const ids = calls.find((c) => c.method === "PUT").body.models.map((m) => m.id);
  assert.ok(!ids.includes("meta-llama/Llama-3.3-70B-Instruct"));
  assert.ok(ids.includes("deepseek-ai/DeepSeek-V4.1-Flash"));
  assert.ok(ids.includes("Qwen/Qwen2.5-Coder-32B-Instruct"));
});

test("setup-wiki-team prunes stored featherless ids the catalog does not offer", async () => {
  const { calls, fetchImpl } = fakeCore({
    providers: [
      {
        id: "featherless",
        models: [
          { id: "bogus-87", name: "Bogus" },
          { id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen" },
        ],
      },
    ],
    seats: [{ id: "llama-seat", model: "featherless/meta-llama/Llama-3.3-70B-Instruct" }],
  });
  await setupWikiTeam({
    env: { ROSTER_API_TOKEN: "rf_test" },
    fetchImpl,
    catalogFetch: async () => new Set(["deepseek-ai/DeepSeek-V4.1-Flash", "Qwen/Qwen2.5-Coder-32B-Instruct"]),
    log() {},
  });
  const ids = calls.find((c) => c.method === "PUT").body.models.map((m) => m.id);
  assert.ok(!ids.includes("bogus-87"));
  assert.ok(!ids.includes("meta-llama/Llama-3.3-70B-Instruct"));
  assert.ok(ids.includes("Qwen/Qwen2.5-Coder-32B-Instruct"));
  assert.ok(ids.includes("deepseek-ai/DeepSeek-V4.1-Flash"));
});

test("setup-wiki-team is idempotent: on 409 it only hires missing specialists", async () => {
  const { calls, fetchImpl } = fakeCore({ teamExists: true, seats: [{ id: "wiki-architect" }, { id: "wiki-scribe" }] });
  const out = await setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_test" }, fetchImpl, catalogFetch: offlineCatalog, log() {} });
  assert.deepEqual(out.hired, ["wiki-diagrammer", "wiki-editor"]);
  const posts = calls.filter((c) => c.method === "POST" && c.path === "/api/v1/seats");
  assert.equal(posts.length, 2);
});

test("setup-wiki-team requires a token and reports a rejected one", async () => {
  await assert.rejects(setupWikiTeam({ env: {}, fetchImpl: async () => ({}), catalogFetch: offlineCatalog, log() {} }), /ROSTER_API_TOKEN is required/);
  const revoked = async () => ({ ok: false, status: 401, text: async () => '{"error":"invalid, expired, or revoked API token"}' });
  await assert.rejects(setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_x" }, fetchImpl: revoked, catalogFetch: offlineCatalog, log() {} }), /rejected \(401\)/);
});

test("setup-wiki-team explains a CORE that cannot write its data volume", async () => {
  const eacces = async () => ({
    ok: false,
    status: 500,
    text: async () => JSON.stringify({ error: "EACCES: permission denied, open '/data/opencode/opencode.json'", detail: "EACCES" }),
  });
  await assert.rejects(
    setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_x" }, fetchImpl: eacces, catalogFetch: offlineCatalog, log() {} }),
    (err) => {
      assert.match(err.message, /^provider: 500 EACCES: permission denied, open '\/data\/opencode\/opencode\.json'/);
      assert.match(err.message, /CORE cannot write its data volume\. Start roster-flow as root/);
      return true;
    },
  );
  const other = async () => ({ ok: false, status: 500, text: async () => '{"error":"boom"}' });
  await assert.rejects(setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_x" }, fetchImpl: other, catalogFetch: offlineCatalog, log() {} }), (err) => {
    assert.equal(err.message, "provider: 500 boom");
    return true;
  });
});
