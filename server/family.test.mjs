import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { familyEnv, runSkillFlow } from "./family.mjs";

test("family env defaults to locked sibling ports", () => {
  const prevM = process.env.MCP_FLOW_URL;
  const prevS = process.env.SKILL_FLOW_URL;
  delete process.env.MCP_FLOW_URL;
  delete process.env.SKILL_FLOW_URL;
  try {
    const env = familyEnv();
    assert.equal(env.mcpFlowUrl, "http://127.0.0.1:8787");
    assert.equal(env.skillFlowUrl, "http://127.0.0.1:8788");
  } finally {
    if (prevM === undefined) delete process.env.MCP_FLOW_URL;
    else process.env.MCP_FLOW_URL = prevM;
    if (prevS === undefined) delete process.env.SKILL_FLOW_URL;
    else process.env.SKILL_FLOW_URL = prevS;
  }
});

test("skill-flow CLI spawn captures JSON stdout", async () => {
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from('{"name":"demo","audit":{"ok":true}}'));
      child.emit("close", 0);
    });
    return child;
  };
  const result = await runSkillFlow(["audit", "demo"], { spawnFn: fakeSpawn });
  assert.equal(result.ok, true);
  assert.equal(result.json.name, "demo");
});
