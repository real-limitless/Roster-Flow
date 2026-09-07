/**
 * Everflow-style OpenCode wrapper: resolve binary, serve, health, HTTP to sessions.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = process.env.ROSTER_WORKSPACE
  ? join(root, process.env.ROSTER_WORKSPACE)
  : join(root, ".roster-flow", "workspace");

const HEALTH = "/global/health";
let instance = null;

export function workspacePath() {
  return workspace;
}

function whichOpenCode() {
  const envBin = process.env.OPENCODE_BIN;
  if (envBin && existsSync(envBin)) return envBin;
  const path = process.env.PATH || "";
  for (const dir of path.split(":")) {
    const cand = join(dir, "opencode");
    if (existsSync(cand)) return cand;
  }
  return null;
}

function freePort(preferred) {
  return new Promise((resolve, reject) => {
    const tryBind = (port) => {
      const s = createServer();
      s.unref();
      s.on("error", () => {
        if (port === preferred) tryBind(0);
        else reject(new Error("No free port for opencode serve"));
      });
      s.listen(port, "127.0.0.1", () => {
        const addr = s.address();
        const p = typeof addr === "object" && addr ? addr.port : port;
        s.close(() => resolve(p));
      });
    };
    tryBind(preferred || Number(process.env.OPENCODE_PORT) || 14180);
  });
}

export async function ocFetch(path, init = {}) {
  if (!instance?.baseUrl) throw new Error("OpenCode harness is offline");
  const url = `${instance.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { ...(init.headers || {}) };
  if (init.body && !headers["content-type"] && !headers["Content-Type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = new Error(typeof data === "object" && data?.message ? data.message : res.statusText);
    err.status = res.status;
    err.detail = data;
    throw err;
  }
  return data;
}

export async function healthCheck(port, timeoutMs = 1500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${HEALTH}`, { signal: ac.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function writeWorkspaceConfig() {
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(root, ".opencode"), { recursive: true });
  const dest = join(root, ".opencode", "opencode.json");
  if (!existsSync(dest)) {
    writeFileSync(
      dest,
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          plugin: ["roster-flow-opencode"],
        },
        null,
        2,
      ),
    );
  }
}

export function status() {
  return {
    harness: instance?.healthy ? "up" : "offline",
    binary: whichOpenCode(),
    port: instance?.port ?? null,
    version: instance?.version ?? null,
    workspace,
    plugin: "roster-flow-opencode",
    pid: instance?.pid ?? null,
  };
}

export async function ensure({ forceRestart = false } = {}) {
  writeWorkspaceConfig();
  if (instance && !forceRestart) {
    const h = await healthCheck(instance.port);
    if (h && instance.child && instance.child.exitCode == null) {
      instance.healthy = true;
      instance.version = String(h.version || instance.version || "");
      return status();
    }
  }
  if (instance?.child && instance.child.exitCode == null) {
    instance.child.kill("SIGTERM");
  }
  instance = null;

  const binary = whichOpenCode();
  if (!binary) {
    const err = new Error(
      "OpenCode CLI is not installed. Room and bus still work; set OPENCODE_BIN or install opencode.",
    );
    err.status = 409;
    err.code = "OPENCODE_MISSING";
    throw err;
  }

  const port = await freePort();
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(root, ".roster-flow"), { recursive: true });
  const logPath = join(root, ".roster-flow", "opencode-serve.log");

  const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: {
      ...process.env,
      OPENCODE_CLIENT: "roster-flow",
      ROSTER_API: process.env.ROSTER_API || `http://127.0.0.1:${process.env.ROSTER_API_PORT || 8787}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  const onLog = (buf) => {
    try {
      appendFileSync(logPath, buf);
    } catch {
      /* ignore */
    }
  };
  child.stdout?.on("data", onLog);
  child.stderr?.on("data", onLog);

  instance = {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    pid: child.pid,
    healthy: false,
    version: null,
  };

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      instance = null;
      const err = new Error(`opencode serve exited early (code=${child.exitCode}). See .roster-flow/opencode-serve.log`);
      err.status = 502;
      throw err;
    }
    const h = await healthCheck(port);
    if (h) {
      instance.healthy = true;
      instance.version = String(h.version || "");
      return status();
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGTERM");
  instance = null;
  const err = new Error("opencode serve did not become healthy");
  err.status = 502;
  throw err;
}

export async function listSessions() {
  const data = await ocFetch("/session");
  return Array.isArray(data) ? data : [];
}

export async function createSession(body = {}) {
  return ocFetch("/session", { method: "POST", body: JSON.stringify(body) });
}

export async function promptSession(sessionId, body) {
  return ocFetch(`/session/${sessionId}/prompt_async`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
