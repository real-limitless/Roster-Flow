import { spawn } from "node:child_process";

export function familyEnv() {
  return {
    mcpFlowUrl: (process.env.MCP_FLOW_URL || "http://127.0.0.1:8787").replace(/\/+$/, ""),
    skillFlowUrl: (process.env.SKILL_FLOW_URL || "http://127.0.0.1:8788").replace(/\/+$/, ""),
    mcpAdminToken: (process.env.MCP_FLOW_ADMIN_TOKEN || "").trim(),
    skillFlowBin: process.env.SKILL_FLOW_BIN || "skill-flow",
  };
}

/** Roster CORE /api/v1/health — must not count as mcp-flow. */
export function looksLikeRosterHealth(body) {
  return Boolean(
    body &&
      typeof body === "object" &&
      Object.prototype.hasOwnProperty.call(body, "harness") &&
      (Object.prototype.hasOwnProperty.call(body, "seats") ||
        Object.prototype.hasOwnProperty.call(body, "systemHarness")),
  );
}

export async function pingHttp(url, path = "/health", token = "") {
  try {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${url}${path}`, { headers, signal: AbortSignal.timeout(2500) });
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();
    let json = null;
    if (ctype.includes("json")) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!json || typeof json !== "object") {
      return { ok: false, status: res.status, error: "not mcp-flow (HTML or non-JSON)" };
    }
    if (looksLikeRosterHealth(json)) {
      return { ok: false, status: res.status, error: "this URL is Roster CORE, not mcp-flow" };
    }
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function familyStatus() {
  const env = familyEnv();
  const [mcp, skill] = await Promise.all([
    pingHttp(env.mcpFlowUrl, "/health", env.mcpAdminToken),
    pingHttp(env.skillFlowUrl, "/health"),
  ]);
  return {
    mcpFlow: { url: env.mcpFlowUrl, ...mcp, admin: Boolean(env.mcpAdminToken) },
    skillFlow: { url: env.skillFlowUrl, bin: env.skillFlowBin, ...skill },
  };
}

export function runSkillFlow(args, { bin, spawnFn } = {}) {
  const cmd = bin || familyEnv().skillFlowBin;
  const spawnImpl = spawnFn || spawn;
  return new Promise((resolve) => {
    const child = spawnImpl(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (c) => stdout.push(c));
    child.stderr?.on("data", (c) => stderr.push(c));
    child.on("error", (err) => {
      resolve({
        ok: false,
        code: null,
        stdout: "",
        stderr: err.message,
      });
    });
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      let json = null;
      try {
        json = out ? JSON.parse(out) : null;
      } catch {
        json = null;
      }
      resolve({ ok: code === 0, code, stdout: out, stderr: err, json });
    });
  });
}

export async function auditSkill(source, opts = {}) {
  const src = String(source || "").trim();
  if (!src) return { ok: false, error: "source required" };
  return runSkillFlow(["audit", src], opts);
}

export async function installSkill(source, opts = {}) {
  const src = String(source || "").trim();
  if (!src) return { ok: false, error: "source required" };
  if (!opts.confirm) return { ok: false, error: "confirm required" };
  return runSkillFlow(["install", src, "-y"], opts);
}

export async function listMcpBackends() {
  const env = familyEnv();
  if (!env.mcpAdminToken) return { ok: false, error: "MCP_FLOW_ADMIN_TOKEN missing", backends: [] };
  try {
    const res = await fetch(`${env.mcpFlowUrl}/v1/backends`, {
      headers: { Authorization: `Bearer ${env.mcpAdminToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}`, backends: [] };
    return { ok: true, backends: data.backends || data || [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), backends: [] };
  }
}

export async function registerMcpBackend(body = {}) {
  const env = familyEnv();
  if (!env.mcpAdminToken) return { ok: false, error: "MCP_FLOW_ADMIN_TOKEN missing" };
  const slug = String(body.slug || "").trim();
  if (!slug) return { ok: false, error: "slug required" };
  const payload = {
    slug,
    title: body.title || slug,
    transport: body.transport || (body.url ? "streamable-http" : "stdio"),
    url: body.url || undefined,
    command: Array.isArray(body.command) ? body.command : undefined,
    enabled: body.enabled !== false,
    placement: body.placement || (body.url ? { mode: "remote" } : { mode: "central-sandbox" }),
  };
  try {
    const res = await fetch(`${env.mcpFlowUrl}/v1/backends`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.mcpAdminToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, backend: data.backend || data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
