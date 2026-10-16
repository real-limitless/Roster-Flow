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

test("serveChildEnv passes wiki-flow env through to opencode serve", async () => {
  const { serveChildEnv } = await import("./providers.mjs");
  const env = serveChildEnv({ PATH: "/bin", WIKIFLOW_URL: "http://wiki", WIKIFLOW_TOKEN: "tok" });
  assert.equal(env.WIKIFLOW_URL, "http://wiki");
  assert.equal(env.WIKIFLOW_TOKEN, "tok");
});
