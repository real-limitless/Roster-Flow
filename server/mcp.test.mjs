import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emptyState } from "./seed.mjs";
import { hireSeat } from "./seats.mjs";
import { handleMcp, mcpToolNames } from "./mcp.mjs";
import { bootCore } from "./test-helpers.mjs";

const owner = { userId: "usr-1", seatId: "you", name: "Ops", tokenId: "tok-owner" };

function world(caller = owner) {
  const state = emptyState();
  hireSeat(state, {
    id: "guest-claude",
    name: "Claude",
    reportsTo: "eng-supervisor",
    guest: true,
    job: "External harness.",
  });
  const dir = mkdtempSync(join(tmpdir(), "rf-files-"));
  const bus = [];
  const deps = {
    mutate(fn) {
      fn(state);
    },
    getState() {
      return state;
    },
    postMessage() {},
    postBus(entry) {
      bus.push(entry);
      return entry;
    },
    async wakeSeat() {
      return { offline: true };
    },
    async deliverCallback() {
      return { ok: true, status: 204, at: new Date().toISOString() };
    },
  };
  return {
    state,
    bus,
    dir,
    ctx: {
      caller,
      scopes: ["read", "write"],
      getState: () => state,
      mutate(fn) {
        fn(state);
      },
      fileRoot: dir,
      jobDeps: () => deps,
    },
  };
}

function toolText(out) {
  const text = out.body?.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

test("MCP tool list covers the epic set", () => {
  assert.deepEqual(mcpToolNames(), [
    "list_seats",
    "list_teams",
    "submit_task",
    "get_task",
    "wait_task",
    "cancel_task",
    "put_file",
    "get_file",
    "send_message",
    "list_models",
  ]);
});

test("guest sees only the manager's reporting line and its own jobs", async () => {
  const guest = { userId: "usr-1", seatId: "guest-claude", name: "Claude", tokenId: "tok-guest" };
  const { ctx, dir } = world(guest);
  try {
    const seats = await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_seats", arguments: {} } }, ctx);
    const ids = toolText(seats).map((s) => s.id).sort();
    assert.deepEqual(ids, ["build", "eng-generic", "review"]);
    const teams = toolText(await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_teams", arguments: {} } }, ctx));
    const eng = teams.find((t) => t.id === "eng");
    assert.ok(eng);
    assert.equal(eng.supervisorSeatId, null);
    assert.deepEqual([...eng.seatIds].sort(), ["build", "eng-generic", "review"]);
    assert.ok(teams.every((t) => t.seatIds.every((id) => ["build", "eng-generic", "review"].includes(id))));

    const denied = await handleMcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "submit_task", arguments: { target: "qa", brief: "no" } },
    }, ctx);
    assert.equal(denied.body.result.isError, true);

    const supervisor = await handleMcp({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "submit_task", arguments: { target: "team:eng", routing: "supervisor", brief: "dispatch" } },
    }, ctx);
    assert.equal(supervisor.body.result.isError, true);

    const ok = await handleMcp({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "submit_task", arguments: { target: "build", brief: "Ship the webhook", files: [{ name: "note.txt", content: "hello" }] } },
    }, ctx);
    const job = toolText(ok);
    assert.equal(ok.body.result.isError, false);
    assert.equal(job.assignee, "build");
    assert.equal(job.status, "queued");
    assert.equal(job.files[0].name, "note.txt");

    const hidden = world(owner);
    hidden.state.jobs = ctx.getState().jobs;
    const other = await handleMcp({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "get_task", arguments: { jobId: job.id } },
    }, { ...ctx, caller: { ...guest, seatId: "guest-other", tokenId: "tok-other" } });
    assert.equal(other.body.result.isError, true);

    const file = toolText(await handleMcp({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "get_file", arguments: { jobId: job.id, name: "note.txt" } },
    }, ctx));
    assert.equal(Buffer.from(file.content, "base64").toString("utf8"), "hello");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read scope cannot submit, and initialize is JSON-RPC", async () => {
  const { ctx, dir } = world();
  ctx.scopes = ["read"];
  try {
    const init = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, ctx);
    assert.equal(init.body.result.serverInfo.name, "roster-flow");
    assert.equal(init.body.result.protocolVersion, "2025-03-26");
    const note = await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx);
    assert.equal(note.status, 202);
    const denied = await handleMcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "submit_task", arguments: { target: "build", brief: "x" } },
    }, ctx);
    assert.equal(denied.body.result.isError, true);
    assert.match(denied.body.result.content[0].text, /write scope/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /mcp accepts a bearer token and submits a job", async () => {
  const token = "rf_mcp_backend_token_00000001";
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_OWNER_TEMPLATE: "starter",
    ROSTER_API_TOKEN: token,
    OPENCODE_BIN: "/nonexistent/opencode",
    OPENCODE_PORT: "1",
    OPENCODE_SYSTEM_PORT: "1",
  });
  try {
    const missing = await fetch(`${core.base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(missing.status, 401);
    const res = await fetch(`${core.base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "submit_task", arguments: { target: "build", brief: "from mcp-flow" } },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const job = JSON.parse(body.result.content[0].text);
    assert.equal(body.result.isError, false);
    assert.equal(job.assignee, "build");
    assert.equal(job.caller.seatId, "you");
  } finally {
    await core.stop();
  }
});
