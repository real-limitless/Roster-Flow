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
