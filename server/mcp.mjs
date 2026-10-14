/**
 * Roster MCP backend (issue #69, milestone M3).
 *
 * mcp-flow is the public front door. This is the streamable-http JSON-RPC
 * backend it proxies: POST /mcp, application/json, bearer auth. No SDK.
 * Budgets are a per-caller seam (not enforced here).
 */
import { listModels } from "./providers.mjs";
import { assertCallerCanTask, canReadJob, listTaskableSeats, listTaskableTeams } from "./access.mjs";
import { getJob, publishNewJob, settleJob, followUpJob, waitForJob } from "./jobs.mjs";
import { readJobFile, writeJobFile } from "./files.mjs";

const PROTOCOL = "2025-03-26";
const WRITE_TOOLS = new Set(["submit_task", "cancel_task", "put_file", "send_message"]);

const TOOLS = [
  {
    name: "list_seats",
    description: "Seats this caller may task, with role, model, tools, and open-job load.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_teams",
    description: "Teams this caller may task. Seat ids are limited to that caller's reporting line.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "submit_task",
    description: "Hand a brief to a seat or team. Returns a job. Routing: supervisor, round_robin, or specialist.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Seat id or team:<id>" },
        brief: { type: "string" },
        routing: { type: "string" },
        specialist: { type: "string" },
        fileRefs: { type: "array" },
        files: { type: "array", description: "Inline job files: { name, content, encoding? }" },
        channel: { type: "string" },
        callbackUrl: { type: "string" },
        budget: { type: "object" },
        priority: { type: "string" },
        runId: { type: "string" },
      },
      required: ["target", "brief"],
    },
  },
  {
    name: "get_task",
    description: "One job this caller may see.",
    inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
  },
  {
    name: "wait_task",
    description: "Long-poll a job until it needs a human, finishes, or the timeout elapses.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" }, timeout: { type: "number" }, since: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "cancel_task",
    description: "Cancel a job this caller submitted or is assigned.",
    inputSchema: { type: "object", properties: { jobId: { type: "string" }, reason: { type: "string" } }, required: ["jobId"] },
  },
  {
    name: "put_file",
    description: "Store a job file (1MB each, 8 files, 4MB per job).",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        name: { type: "string" },
        content: { type: "string" },
        encoding: { type: "string", enum: ["utf8", "base64"] },
      },
      required: ["jobId", "name", "content"],
    },
  },
  {
    name: "get_file",
    description: "Read a job file. Content is base64.",
    inputSchema: { type: "object", properties: { jobId: { type: "string" }, name: { type: "string" } }, required: ["jobId", "name"] },
  },
  {
    name: "send_message",
    description: "Follow-up mail into an open job. Wakes the assignee.",
    inputSchema: { type: "object", properties: { jobId: { type: "string" }, text: { type: "string" } }, required: ["jobId", "text"] },
  },
  {
    name: "list_models",
    description: "Models configured on this Roster. No provider keys.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolText(value, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }], isError };
}

function allowsWrite(scopes) {
  if (!scopes) return true;
  return scopes.includes("write") || scopes.includes("admin");
}

async function callTool(name, args, ctx) {
  const state = ctx.getState();
  const caller = ctx.caller || {};
  const a = args && typeof args === "object" ? args : {};
  if (name === "list_seats") return listTaskableSeats(state, caller);
  if (name === "list_teams") return listTaskableTeams(state, caller);
  if (name === "list_models") return (ctx.listModels || listModels)().map(({ providerID, modelID, name: modelName, connected }) => ({ providerID, modelID, name: modelName, connected }));
  if (name === "submit_task") {
    assertCallerCanTask(state, caller, a);
    const deps = ctx.jobDeps();
    const files = Array.isArray(a.files) ? a.files : [];
    const body = { ...a };
    delete body.files;
    if (files.length) {
      const root = ctx.fileRoot;
      deps.attachFiles = (s, jobId) => {
        for (const file of files) writeJobFile(s, jobId, file, caller, root);
      };
    }
    const { job } = await (ctx.publishNewJob || publishNewJob)(body, caller, deps);
    return job;
  }
  if (name === "get_task") {
    const job = (ctx.getJob || getJob)(state, a.jobId);
    if (!job || !canReadJob(job, caller)) {
      const err = new Error("job not found");
      err.status = 404;
      throw err;
    }
    return job;
  }
  if (name === "wait_task") {
    const existing = (ctx.getJob || getJob)(state, a.jobId);
    if (!existing || !canReadJob(existing, caller)) {
      const err = new Error("job not found");
      err.status = 404;
      throw err;
    }
    return (ctx.waitForJob || waitForJob)(a.jobId, { timeout: a.timeout, since: a.since }, ctx.jobDeps());
  }
  if (name === "cancel_task") {
    return (ctx.settleJob || settleJob)(a.jobId, "cancel", { reason: a.reason }, caller, ctx.jobDeps());
  }
  if (name === "put_file") {
    let meta;
    ctx.mutate((s) => {
      meta = writeJobFile(s, a.jobId, a, caller, ctx.fileRoot);
    });
    return meta;
  }
  if (name === "get_file") return readJobFile(state, a.jobId, a.name, caller, ctx.fileRoot);
  if (name === "send_message") return (ctx.followUpJob || followUpJob)(a.jobId, { text: a.text }, caller, ctx.jobDeps());
  const err = new Error(`unknown tool: ${name}`);
  err.status = 400;
  throw err;
}

export async function handleMcp(msg, ctx) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return { status: 400, body: rpcError(null, -32600, "invalid request") };
  }
  const id = Object.prototype.hasOwnProperty.call(msg, "id") ? msg.id : undefined;
  if (id === undefined || id === null) return { status: 202, body: null };
  const method = String(msg.method || "");
  const params = msg.params || {};
  try {
    if (method === "initialize") {
      return {
        status: 200,
        body: rpcResult(id, {
          protocolVersion: PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "roster-flow", version: "0.1.0" },
        }),
      };
    }
    if (method === "ping") return { status: 200, body: rpcResult(id, {}) };
    if (method === "tools/list") return { status: 200, body: rpcResult(id, { tools: TOOLS }) };
    if (method === "tools/call") {
      const name = String(params.name || "");
      if (!TOOLS.some((t) => t.name === name)) {
        return { status: 200, body: rpcResult(id, toolText(`unknown tool: ${name}`, true)) };
      }
      if (WRITE_TOOLS.has(name) && !allowsWrite(ctx.scopes)) {
        return { status: 200, body: rpcResult(id, toolText("write scope required", true)) };
      }
      try {
        const value = await callTool(name, params.arguments, ctx);
        return { status: 200, body: rpcResult(id, toolText(value)) };
      } catch (err) {
        return { status: 200, body: rpcResult(id, toolText(err.message || "error", true)) };
      }
    }
    return { status: 200, body: rpcError(id, -32601, `method not found: ${method}`) };
  } catch (err) {
    return { status: 200, body: rpcError(id, -32603, err.message || "internal error") };
  }
}

export function mcpToolNames() {
  return TOOLS.map((t) => t.name);
}
