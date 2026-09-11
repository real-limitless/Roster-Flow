#!/usr/bin/env node
/**
 * stdio shim for clients that cannot speak Streamable HTTP yet.
 * Forwards JSON-RPC (Content-Length framing) to CORE POST /mcp.
 *
 *   ROSTER_API=http://127.0.0.1:8790 ROSTER_MCP_TOKEN=… node scripts/roster-flow-mcp.mjs
 */
const API = process.env.ROSTER_API || "http://127.0.0.1:8790";
const TOKEN = process.env.ROSTER_MCP_TOKEN || process.env.ROSTER_TOKEN || "";

let buf = Buffer.alloc(0);
let sessionId = "";

function writeMessage(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

async function post(msg) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(`${API}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(msg),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (res.status === 202) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function handle(msg) {
  try {
    const out = await post(msg);
    if (msg && Object.prototype.hasOwnProperty.call(msg, "id") && out) writeMessage(out);
  } catch (err) {
    if (msg && Object.prototype.hasOwnProperty.call(msg, "id")) {
      writeMessage({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32000, message: err.message || "shim error" },
      });
    }
  }
}

process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = buf.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buf = buf.slice(headerEnd + 4);
      continue;
    }
    const len = Number(match[1]);
    const start = headerEnd + 4;
    if (buf.length < start + len) break;
    const json = buf.slice(start, start + len).toString("utf8");
    buf = buf.slice(start + len);
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    void handle(parsed);
  }
});

process.stdin.on("end", () => process.exit(0));
