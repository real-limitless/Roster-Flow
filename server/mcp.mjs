import { randomUUID } from "node:crypto";
import { skipOnboarding } from "./flags.mjs";
import { getState, mutate } from "./store.mjs";
import { cycleSafe, postBus } from "./bus.mjs";
import { postMessage } from "./chat.mjs";
import { listInbox } from "./inbox.mjs";

export const MCP_GUEST_ID = "mcp-guest";

const mcpSessions = new Map();

export const MCP_TOOLS = [
  {
    name: "roster_whoami",
    description: "Bound MCP guest seat, origin, and channel membership. Not an OpenCode loop.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "roster_join",
    description: "Bind this client to the MCP guest harness seat (origin: claude-code | cursor | codex | gemini-cli | goose | other).",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "roster_list_seats",
    description: "Org chart: humans, OpenCode bots, guest harnesses, teams, projects.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "roster_list_channels",
    description: "Rooms plus membership.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "roster_read_messages",
    description: "Recent messages for a channel (default #ship).",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "roster_send_message",
    description: "Send a message to a seat id, team:eng, or channel:ship on the audited bus.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Seat id, team:<id>, or channel:<id>" },
        text: { type: "string" },
        from: { type: "string", description: "Defaults to mcp-guest" },
      },
      required: ["to", "text"],
    },
  },
  {
    name: "roster_handoff",
    description: "Close your phase and open the next seat with a brief.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        text: { type: "string" },
        from: { type: "string" },
      },
      required: ["to", "text"],
    },
  },
  {
    name: "roster_report",
    description: "Post a structured result back to a Room thread.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        channel: { type: "string" },
        from: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "roster_ask_human",
    description: "Park the run on reports_to. Never dump into #general.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        from: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "roster_inbox",
    description: "Read inbox for a seat (defaults to mcp-guest).",
    inputSchema: {
      type: "object",
      properties: {
        seatId: { type: "string" },
      },
    },
  },
];

export function mcpGuestSeat() {
  return {
    id: MCP_GUEST_ID,
    name: "MCP Guest",
    role: "Guest",
    kind: "bot",
    seatType: "harness",
    reportsTo: "you",
    mcpGuest: true,
    origin: "mcp",
    job: "External agent via CORE /mcp. Not an OpenCode loop.",
    tools: ["bus", "read"],
    deny: ["edit", "deploy", "bash"],
    status: "idle",
  };
}

export function ensureMcpGuest(state) {
  if (!(state.seats || []).some((s) => s.id === MCP_GUEST_ID)) {
    state.seats = [...(state.seats || []), mcpGuestSeat()];
  }
  const ship = (state.channels || []).find((c) => c.id === "ship");
  if (ship && !(ship.seatIds || []).includes(MCP_GUEST_ID)) {
    ship.seatIds = [...(ship.seatIds || []), MCP_GUEST_ID];
  }
  return state;
}

export function allowMcp(req, user) {
  const dedicated = String(process.env.ROSTER_MCP_TOKEN || "").trim();
  const presented = String(req?.headers?.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (dedicated && presented === dedicated) return true;
  if (user) return true;
  if (skipOnboarding() && !dedicated) return true;
  return false;
}

export function isMcpPath(pathname) {
  return pathname === "/mcp" || pathname === "/api/v1/mcp";
}

function fromOf(args = {}) {
  return String(args.from || MCP_GUEST_ID);
}

function toolResult(obj) {
  return {
    content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }],
  };
}

function publicSeat(seat) {
  if (!seat) return null;
  return {
    id: seat.id,
    name: seat.name,
    role: seat.role,
    kind: seat.kind,
    seatType: seat.seatType,
    reportsTo: seat.reportsTo,
    team: seat.team || null,
    projectId: seat.projectId || null,
    job: seat.job,
    status: seat.status,
    mcpGuest: Boolean(seat.mcpGuest),
    origin: seat.origin || null,
    system: Boolean(seat.system),
  };
}

function floorChannel(to, channel) {
  if (channel) return String(channel);
  if (String(to).startsWith("channel:")) return String(to).slice("channel:".length);
  return "ship";
}

function floorPost({ from, to, kind, text, channel, wake }) {
  if (!from || !to || !text) {
    const err = new Error("to and text required");
    err.status = 400;
    throw err;
  }
  if (!cycleSafe(from, to)) {
    const err = new Error("cycle detector: too many ping-pongs");
    err.status = 429;
    throw err;
  }
  mutate((s) => ensureMcpGuest(s));
  const fromSeat = getState().seats.find((s) => s.id === from);
  const room = floorChannel(to, channel);
  postMessage(room, fromSeat?.name || from, fromSeat?.kind || "bot", text, { seatId: from });
  return postBus({
    from,
    to,
    kind,
    text,
    channel: room,
    wake: Boolean(wake) && !String(to).startsWith("channel:"),
  });
}

export async function callMcpTool(name, args = {}) {
  mutate((s) => ensureMcpGuest(s));
  const from = fromOf(args);
  if (name === "roster_whoami") {
    const seat = getState().seats.find((s) => s.id === MCP_GUEST_ID);
    const rooms = (getState().channels || [])
      .filter((c) => (c.seatIds || []).includes(MCP_GUEST_ID))
      .map((c) => c.id);
    return toolResult({
      seat: publicSeat(seat),
      origin: seat?.origin || "mcp",
      channels: rooms,
      loop: false,
      attach: false,
      pty: false,
    });
  }
  if (name === "roster_join") {
    mutate((s) => {
      ensureMcpGuest(s);
      const seat = (s.seats || []).find((x) => x.id === MCP_GUEST_ID);
      if (!seat) return;
      if (args.origin) seat.origin = String(args.origin).slice(0, 40);
      if (args.name) seat.name = String(args.name).slice(0, 80);
    });
    const seat = getState().seats.find((s) => s.id === MCP_GUEST_ID);
    return toolResult({ joined: true, seat: publicSeat(seat) });
  }
  if (name === "roster_list_seats") {
    const s = getState();
    return toolResult({
      seats: (s.seats || []).map(publicSeat),
      teams: (s.teams || []).map((t) => ({
        id: t.id,
        name: t.name,
        supervisorSeatId: t.supervisorSeatId || null,
        seatIds: t.seatIds || [],
      })),
      projects: (s.projects || []).map((p) => ({ id: p.id, name: p.name, pmSeatId: p.pmSeatId || null })),
    });
  }
  if (name === "roster_list_channels") {
    return toolResult(
      (getState().channels || []).map((c) => ({
        id: c.id,
        name: c.name,
        topic: c.topic || "",
        teamIds: c.teamIds || [],
        seatIds: c.seatIds || [],
      })),
    );
  }
  if (name === "roster_read_messages") {
    const channel = String(args.channel || "ship");
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
    const items = (getState().messages || [])
      .filter((m) => m.channel === channel)
      .slice(-limit)
      .map((m) => ({
        id: m.id,
        who: m.who,
        seatId: m.seatId || null,
        kind: m.kind,
        text: m.text,
        time: m.time,
      }));
    return toolResult({ channel, messages: items });
  }
  if (name === "roster_send_message") {
    return toolResult(floorPost({ from, to: args.to, kind: "send_message", text: args.text, wake: true }));
  }
  if (name === "roster_handoff") {
    return toolResult(floorPost({ from, to: args.to, kind: "handoff", text: args.text, wake: true }));
  }
  if (name === "roster_report") {
    const channel = args.channel || "ship";
    return toolResult(
      floorPost({
        from,
        to: `channel:${channel}`,
        kind: "report",
        text: args.text,
        channel,
        wake: false,
      }),
    );
  }
  if (name === "roster_ask_human") {
    const seats = getState().seats || [];
    const me = seats.find((s) => s.id === from);
    const manager = me?.reportsTo || "you";
    return toolResult(floorPost({ from, to: manager, kind: "ask_human", text: args.text, wake: false }));
  }
  if (name === "roster_inbox") {
    const id = args.seatId || from;
    const box = listInbox(getState(), id);
    if (!box) {
      const err = new Error("seat not found");
      err.status = 404;
      throw err;
    }
    return toolResult(box);
  }
  const err = new Error(`unknown tool: ${name}`);
  err.status = 400;
  throw err;
}

export function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function handleMcpMessage(msg = {}) {
  if (Array.isArray(msg)) {
    return Promise.all(msg.map((m) => handleMcpMessage(m)));
  }
  if (!msg || typeof msg !== "object") return jsonRpcError(null, -32600, "invalid request");
  const { id, method, params } = msg;
  if (!method) return jsonRpcError(id, -32600, "invalid request");
  if (String(method).startsWith("notifications/")) return { notification: true };
  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: (params && params.protocolVersion) || "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "roster-flow", version: "0.1.0" },
      instructions:
        "Roster-Flow room gateway. mcp-flow is tools. This /mcp is seats, channels, and the bus. You are not an OpenCode loop.",
    });
  }
  if (method === "ping") return jsonRpcResult(id, {});
  if (method === "tools/list") {
    return jsonRpcResult(id, { tools: MCP_TOOLS });
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments && typeof params.arguments === "object" ? { ...params.arguments } : {};
    if ((name === "roster_send_message" || name === "roster_handoff") && !args.from) args.from = MCP_GUEST_ID;
    if (name === "roster_inbox" && !args.seatId) args.seatId = MCP_GUEST_ID;
    try {
      const result = await callMcpTool(name, args);
      return jsonRpcResult(id, result);
    } catch (err) {
      return jsonRpcResult(id, {
        content: [{ type: "text", text: err.message || "tool error" }],
        isError: true,
      });
    }
  }
  return jsonRpcError(id, -32601, `method not found: ${method}`);
}

export function mcpCorsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
    ...extra,
  };
}

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function wantsSse(req) {
  const accept = String(req.headers?.accept || "");
  return accept.includes("text/event-stream") && !accept.includes("application/json");
}

function writeJson(res, code, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(code, mcpCorsHeaders({ "content-type": "application/json; charset=utf-8", ...extraHeaders }));
  res.end(data);
}

function writeSseMessage(res, body, extraHeaders = {}) {
  res.writeHead(200, mcpCorsHeaders({ "content-type": "text/event-stream", "cache-control": "no-cache", ...extraHeaders }));
  res.write(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
  res.end();
}

export async function serveMcp(req, res) {
  mutate((s) => ensureMcpGuest(s));
  const method = req.method || "GET";
  if (method === "GET") {
    if (wantsSse(req)) {
      res.writeHead(
        200,
        mcpCorsHeaders({
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        }),
      );
      res.write("event: endpoint\ndata: /mcp\n\n");
      res.write(": roster-flow room gateway\n\n");
      res.end();
      return;
    }
    writeJson(res, 200, {
      ok: true,
      name: "roster-flow",
      transport: "streamable-http",
      endpoint: "/mcp",
      stdio: "node scripts/roster-flow-mcp.mjs",
    });
    return;
  }
  if (method === "DELETE") {
    const sid = req.headers["mcp-session-id"];
    if (sid) mcpSessions.delete(String(sid));
    res.writeHead(204, mcpCorsHeaders());
    res.end();
    return;
  }
  if (method !== "POST") {
    res.writeHead(405, mcpCorsHeaders());
    res.end();
    return;
  }

  let raw = "";
  try {
    raw = await readRaw(req);
  } catch (err) {
    writeJson(res, 400, jsonRpcError(null, -32700, err.message || "parse error"));
    return;
  }

  let msg;
  try {
    msg = raw ? JSON.parse(raw) : {};
  } catch {
    writeJson(res, 400, jsonRpcError(null, -32700, "Parse error"));
    return;
  }

  const out = await handleMcpMessage(msg);
  if (out && out.notification) {
    res.writeHead(202, mcpCorsHeaders());
    res.end();
    return;
  }

  const extra = {};
  const incomingSid = req.headers["mcp-session-id"];
  if (msg && !Array.isArray(msg) && msg.method === "initialize") {
    const sid = incomingSid || randomUUID();
    mcpSessions.set(String(sid), { created: Date.now() });
    extra["mcp-session-id"] = String(sid);
  } else if (incomingSid) {
    extra["mcp-session-id"] = String(incomingSid);
  }

  if (wantsSse(req)) {
    writeSseMessage(res, out, extra);
    return;
  }
  writeJson(res, 200, out, extra);
}
