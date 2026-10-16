import assert from "node:assert/strict";
import test from "node:test";
import { callMcpTool, handleMcpMessage, MCP_TOOLS, ensureMcpGuest, mcpGuestSeat, allowMcp } from "./mcp.mjs";
import { emptyState, migrateState } from "./seed.mjs";
import { getState, mutate } from "./store.mjs";
import { deps, wakeSeat } from "./bus.mjs";

test("tools/list exposes bus verbs already in the OpenCode plugin", async () => {
  const names = MCP_TOOLS.map((t) => t.name);
  for (const name of ["roster_ask_human", "roster_handoff", "roster_inbox", "roster_report", "roster_send_message"]) {
    assert.ok(names.includes(name), name);
  }
  const listed = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.ok(listed.result.tools.length >= 5);
});

test("initialize is streamable-HTTP JSON-RPC", async () => {
  const out = await handleMcpMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", clientInfo: { name: "test" } },
  });
  assert.equal(out.result.serverInfo.name, "roster-flow");
  assert.ok(out.result.capabilities.tools);
});

test("send and inbox go through the CORE bus as mcp-guest", async () => {
  mutate((s) => {
    Object.assign(s, migrateState(emptyState()));
    ensureMcpGuest(s);
  });
  const sent = await callMcpTool("roster_send_message", { to: "you", text: "hello from guest" });
  assert.match(sent.content[0].text, /hello from guest/);
  const box = await callMcpTool("roster_inbox", { seatId: "you" });
  assert.match(box.content[0].text, /hello from guest/);
  const room = getState().messages.filter((m) => m.seatId === "mcp-guest");
  assert.ok(room.some((m) => /hello from guest/.test(m.text)));
});

test("mcp guest template is not an OpenCode loop", () => {
  const seat = mcpGuestSeat();
  assert.equal(seat.mcpGuest, true);
  assert.equal(seat.seatType, "harness");
  assert.ok(seat.deny.includes("edit"));
});

test("wakeSeat skips OpenCode for the MCP guest", async () => {
  const prompts = [];
  const prev = { ...deps };
  deps.harnessStatus = () => ({ harness: "up" });
  deps.createSession = async () => ({ id: "ses_should_not" });
  deps.promptSession = async () => {
    prompts.push("nope");
  };
  mutate((s) => {
    Object.assign(s, migrateState(emptyState()));
    ensureMcpGuest(s);
  });
  try {
    const result = await wakeSeat("mcp-guest", "mail the guest", { from: "you", kind: "send_message" });
    assert.equal(result.guest, true);
    assert.equal(prompts.length, 0);
  } finally {
    Object.assign(deps, prev);
  }
});

test("allowMcp requires the dedicated token when set", () => {
  const prevTok = process.env.ROSTER_MCP_TOKEN;
  process.env.ROSTER_MCP_TOKEN = "harness-secret";
  try {
    assert.equal(allowMcp({ headers: {} }, null), false);
    assert.equal(allowMcp({ headers: { authorization: "Bearer harness-secret" } }, null), true);
    assert.equal(allowMcp({ headers: {} }, { id: "owner" }), true);
  } finally {
    if (prevTok === undefined) delete process.env.ROSTER_MCP_TOKEN;
    else process.env.ROSTER_MCP_TOKEN = prevTok;
  }
});
