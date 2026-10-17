import assert from "node:assert/strict";
import test from "node:test";
import { keyStatusForModel, listModels, mergeModelLists } from "./providers.mjs";

test("listModels does not invent a fake provider catalog", () => {
  const models = listModels();
  const keys = models.map((m) => `${m.providerID}/${m.modelID}`);
  assert.ok(!keys.includes("anthropic/claude-sonnet") || models.some((m) => m.source === "workspace" && m.providerID === "anthropic"));
  assert.ok(models.every((m) => m.providerID && m.modelID));
});

test("keyStatusForModel reports xai disconnected when no key is configured", () => {
  const st = keyStatusForModel("xai/grok-4");
  assert.equal(st.providerID, "xai");
  assert.equal(st.modelID, "grok-4");
  assert.equal(typeof st.configured, "boolean");
  assert.equal(typeof st.connected, "boolean");
  if (!st.configured) assert.equal(st.connected, false);
});

test("mergeModelLists prefers live then configured", () => {
  const merged = mergeModelLists(
    [{ providerID: "xai", modelID: "grok-4", name: "Grok 4", source: "live" }],
    [{ providerID: "xai", modelID: "grok-4", name: "old", source: "workspace" }, { providerID: "demo-llm", modelID: "demo-small", name: "demo-small" }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].source, "live");
});

test("normalizeOpenCodeConfig folds legacy keys into OpenCode's documented schema", async () => {
  const { normalizeOpenCodeConfig } = await import("./providers.mjs");
  const out = normalizeOpenCodeConfig({
    $schema: "https://opencode.ai/config.json",
    providers: {
      featherless: {
        npm: "@ai-sdk/openai-compatible",
        package: "@ai-sdk/openai-compatible",
        settings: { baseURL: "https://api.featherless.ai/v1", apiKey: "{env:FEATHERLESS_API_KEY}" },
        models: { m: { name: "m" } },
      },
    },
    agents: { build: { mode: "all", system: "Persona: x", permissions: { edit: "deny" } } },
  });
  assert.equal(out.providers, undefined);
  assert.equal(out.agents, undefined);
  const p = out.provider.featherless;
  assert.equal(p.settings, undefined);
  assert.equal(p.package, undefined);
  assert.deepEqual(p.options, { baseURL: "https://api.featherless.ai/v1", apiKey: "{env:FEATHERLESS_API_KEY}" });
  assert.equal(out.agent.build.prompt, "Persona: x");
  assert.equal(out.agent.build.system, undefined);
  assert.deepEqual(out.agent.build.permission, { edit: "deny" });
  assert.equal(out.agent.build.permissions, undefined);
});

test("endpointAccepts rejects a closed port and accepts an open one", async () => {
  const { createServer } = await import("node:net");
  const { endpointAccepts } = await import("./providers.mjs");
  assert.equal(endpointAccepts("http://127.0.0.1:9/v1", 200), false);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    assert.equal(endpointAccepts(`http://127.0.0.1:${port}/v1`, 400), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("upsertProvider keeps models a seat still uses and never writes a completion cap below 512", async () => {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { opencodeDir } = await import("./paths.mjs");
  const { upsertProvider, readOpenCodeConfig } = await import("./providers.mjs");
  const path = join(opencodeDir, "opencode.json");
  const raw = readFileSync(path, "utf8");
  const cfg = JSON.parse(raw);
  cfg.provider = cfg.provider || {};
  cfg.provider.featherless = {
    npm: "@ai-sdk/openai-compatible",
    name: "Featherless",
    options: { apiKey: "{env:FEATHERLESS_API_KEY}" },
    models: {
      "Qwen/Qwen2.5-Coder-32B-Instruct": { name: "Qwen" },
      "meta-llama/Llama-3.3-70B-Instruct": { name: "Llama 3.3 70B" },
      "unused-model": { name: "Unused" },
    },
  };
  writeFileSync(path, JSON.stringify(cfg, null, 2));
  try {
    upsertProvider(
      {
        id: "featherless",
        name: "Featherless",
        apiKeyEnv: "FEATHERLESS_API_KEY",
        models: [{ id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen", limit: { output: 64 } }],
      },
      {
        seats: [{ model: "featherless/meta-llama/Llama-3.3-70B-Instruct" }],
        teams: [{ allowedModels: ["featherless/team-only", "openai/gpt-5"] }],
      },
    );
    const models = readOpenCodeConfig().provider.featherless.models;
    assert.equal(models["Qwen/Qwen2.5-Coder-32B-Instruct"].limit.output, 512);
    assert.equal(models["meta-llama/Llama-3.3-70B-Instruct"].name, "Llama 3.3 70B");
    assert.ok(models["meta-llama/Llama-3.3-70B-Instruct"].limit.output >= 512);
    assert.ok(models["team-only"].limit.output >= 512);
    assert.equal(models["unused-model"], undefined);
    assert.equal(models["gpt-5"], undefined);
    assert.equal(models["openai/gpt-5"], undefined);
  } finally {
    writeFileSync(path, raw);
  }
});

test("serveChildEnv passes wiki-flow env through to opencode serve", async () => {
  const { serveChildEnv } = await import("./providers.mjs");
  const env = serveChildEnv({ PATH: "/bin", WIKIFLOW_URL: "http://wiki", WIKIFLOW_TOKEN: "tok" });
  assert.equal(env.WIKIFLOW_URL, "http://wiki");
  assert.equal(env.WIKIFLOW_TOKEN, "tok");
});
