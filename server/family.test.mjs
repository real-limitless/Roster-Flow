import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { familyEnv, pingHttp, runSkillFlow } from "./family.mjs";

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

test("HTML 200 from Roster SPA is not mcp-flow up", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><body>roster spa</body></html>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    const result = await pingHttp(`http://127.0.0.1:${port}`);
    assert.equal(result.ok, false);
    assert.match(result.error, /not mcp-flow/i);
  } finally {
    server.close();
  }
});

test("Roster CORE health JSON is not mcp-flow up", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, harness: "offline", seats: 19, systemHarness: { harness: "offline" } }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    const result = await pingHttp(`http://127.0.0.1:${port}`);
    assert.equal(result.ok, false);
    assert.match(result.error, /Roster CORE/i);
  } finally {
    server.close();
  }
});

test("mcp-flow JSON health counts as up", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "mcp-flow" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    const result = await pingHttp(`http://127.0.0.1:${port}`);
    assert.equal(result.ok, true);
  } finally {
    server.close();
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
