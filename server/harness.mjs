/**
 * Everflow-style OpenCode wrapper: company serve for product bots,
 * plus a dedicated System serve for Architect / Channel.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveChildEnv, readOpenCodeConfig, readGlobalOpenCodeConfig, ensureAuthProviders } from "./providers.mjs";
import { getState, mutate } from "./store.mjs";
import { emit } from "./trace.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const companyWorkspace = process.env.ROSTER_WORKSPACE
  ? join(root, process.env.ROSTER_WORKSPACE)
  : join(root, ".roster-flow", "workspace");
const systemWorkspace = join(root, ".roster-flow", "system");

const HEALTH = "/global/health";
const instances = { company: null, system: null };

export const COMPANY = "company";
export const SYSTEM = "system";

export function harnessKind(kind) {
  return kind === SYSTEM ? SYSTEM : COMPANY;
}

export function harnessKindForSeat(seat) {
  return seat?.system ? SYSTEM : COMPANY;
}

export function sessionKeyForKind(kind) {
  return harnessKind(kind) === SYSTEM ? "systemSessions" : "sessions";
}

export function spec(kind) {
  if (harnessKind(kind) === SYSTEM) {
    return {
      kind: SYSTEM,
      workspace: systemWorkspace,
      cwd: systemWorkspace,
      preferredPort: Number(process.env.OPENCODE_SYSTEM_PORT) || 14181,
      logFile: join(root, ".roster-flow", "opencode-system.log"),
      sessionKey: "systemSessions",
      client: "roster-flow-system",
    };
  }
  return {
    kind: COMPANY,
    workspace: companyWorkspace,
    cwd: root,
    preferredPort: Number(process.env.OPENCODE_PORT) || 14180,
    logFile: join(root, ".roster-flow", "opencode-serve.log"),
    sessionKey: "sessions",
    client: "roster-flow",
  };
}

export function workspacePath(kind = COMPANY) {
  return spec(kind).workspace;
}

export function whichOpenCode() {
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
    const bind = (port, fallback) => {
      const s = createServer();
      s.unref();
      s.on("error", () => {
        if (fallback) bind(0, false);
        else reject(new Error("No free port for opencode serve"));
      });
      s.listen(port, "127.0.0.1", () => {
        const addr = s.address();
        const p = typeof addr === "object" && addr ? addr.port : port;
        s.close(() => resolve(p));
      });
    };
    bind(preferred, true);
  });
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

function writeCompanyConfig() {
  mkdirSync(companyWorkspace, { recursive: true });
  mkdirSync(join(root, ".opencode"), { recursive: true });
  const dest = join(root, ".opencode", "opencode.json");
  const global = readGlobalOpenCodeConfig();
  let cfg = {
    $schema: "https://opencode.ai/config.json",
    plugin: ["roster-flow-opencode"],
    provider: {},
    providers: {},
  };
  if (existsSync(dest)) {
    try {
      cfg = { ...cfg, ...JSON.parse(readFileSync(dest, "utf8")) };
    } catch {
      /* keep defaults */
    }
  }
  if (!Array.isArray(cfg.plugin) || !cfg.plugin.includes("roster-flow-opencode")) {
    cfg.plugin = [...(cfg.plugin || []), "roster-flow-opencode"];
  }
  cfg.provider = { ...(global.provider || {}), ...(cfg.provider || {}) };
  cfg.providers = { ...(global.providers || {}), ...(cfg.providers || {}) };
  writeFileSync(dest, JSON.stringify(cfg, null, 2));
}

function writeSystemConfig() {
  const ocDir = join(systemWorkspace, ".opencode");
  mkdirSync(systemWorkspace, { recursive: true });
  mkdirSync(join(ocDir, "agents"), { recursive: true });
  const dest = join(ocDir, "opencode.json");
  const company = readOpenCodeConfig();
  const global = readGlobalOpenCodeConfig();
  let cfg = {
    $schema: "https://opencode.ai/config.json",
    plugin: ["roster-flow-opencode"],
    provider: {},
    providers: {},
    agents: {},
  };
  if (existsSync(dest)) {
    try {
      cfg = { ...cfg, ...JSON.parse(readFileSync(dest, "utf8")) };
    } catch {
      /* keep defaults */
    }
  }
  cfg.plugin = ["roster-flow-opencode"];
  cfg.provider = { ...(global.provider || {}), ...(cfg.provider || {}), ...(company.provider || {}) };
  cfg.providers = { ...(global.providers || {}), ...(cfg.providers || {}), ...(company.providers || {}) };
  writeFileSync(dest, JSON.stringify(cfg, null, 2));
}

export function status(kind = COMPANY) {
  const k = harnessKind(kind);
  const inst = instances[k];
  const s = spec(k);
  return {
    kind: k,
    harness: inst?.healthy ? "up" : "offline",
    binary: whichOpenCode(),
    port: inst?.port ?? null,
    version: inst?.version ?? null,
    workspace: s.workspace,
    plugin: "roster-flow-opencode",
    pid: inst?.pid ?? null,
  };
}

export function combinedStatus() {
  const company = status(COMPANY);
  return {
    ...company,
    systemHarness: status(SYSTEM),
  };
}

async function adoptIfHealthy(kind) {
  const k = harnessKind(kind);
  const s = spec(k);
  const h = await healthCheck(s.preferredPort);
  if (!h) return null;
  instances[k] = {
    port: s.preferredPort,
    baseUrl: `http://127.0.0.1:${s.preferredPort}`,
    child: null,
    pid: null,
    healthy: true,
    version: String(h.version || ""),
  };
  await reconcileSessions(k).catch(() => undefined);
  return status(k);
}

export async function ocFetch(path, init = {}, kind = COMPANY) {
  const k = harnessKind(kind);
  const inst = instances[k];
  if (!inst?.baseUrl) throw new Error(k === SYSTEM ? "System OpenCode harness is offline" : "OpenCode harness is offline");
  const url = `${inst.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
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

export async function ensure({ forceRestart = false, kind = COMPANY } = {}) {
  const k = harnessKind(kind);
  const s = spec(k);
  emit({ scope: "harness", step: "ensure.start", detail: { kind: k, forceRestart: Boolean(forceRestart) } });
  if (k !== SYSTEM) ensureAuthProviders();
  if (k === SYSTEM) writeSystemConfig();
  else writeCompanyConfig();

  if (!forceRestart && !instances[k]) {
    const adopted = await adoptIfHealthy(k);
    if (adopted) {
      emit({ scope: "harness", step: "ensure.up", detail: { kind: k, adopted: true } });
      return adopted;
    }
  }
  if (instances[k] && !forceRestart) {
    const h = await healthCheck(instances[k].port);
    if (h && instances[k].child && instances[k].child.exitCode == null) {
      instances[k].healthy = true;
      instances[k].version = String(h.version || instances[k].version || "");
      emit({ scope: "harness", step: "ensure.up", detail: { kind: k } });
      return status(k);
    }
  }
  if (instances[k]?.child && instances[k].child.exitCode == null) {
    instances[k].child.kill("SIGTERM");
  }
  instances[k] = null;

  const binary = whichOpenCode();
  if (!binary) {
    const err = new Error(
      k === SYSTEM
        ? "OpenCode CLI is not installed. Architect needs the System harness; set OPENCODE_BIN or install opencode."
        : "OpenCode CLI is not installed. Room and bus still work; set OPENCODE_BIN or install opencode.",
    );
    err.status = 409;
    err.code = "OPENCODE_MISSING";
    emit({ level: "error", scope: "harness", step: "ensure.error", detail: { kind: k, error: err.message, code: err.code } });
    throw err;
  }

  const port = await freePort(s.preferredPort);
  mkdirSync(s.workspace, { recursive: true });
  mkdirSync(join(root, ".roster-flow"), { recursive: true });

  const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: s.cwd,
    env: {
      ...serveChildEnv(),
      OPENCODE_CLIENT: s.client,
      NODE_PATH: [join(root, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(":"),
      ROSTER_API: process.env.ROSTER_API || `http://127.0.0.1:${process.env.ROSTER_API_PORT || 8787}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  const onLog = (buf) => {
    try {
      appendFileSync(s.logFile, buf);
    } catch {
      /* ignore */
    }
  };
  child.stdout?.on("data", onLog);
  child.stderr?.on("data", onLog);

  instances[k] = {
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
      instances[k] = null;
      const err = new Error(`opencode serve exited early (code=${child.exitCode}). See ${s.logFile}`);
      err.status = 502;
      emit({ level: "error", scope: "harness", step: "ensure.error", detail: { kind: k, error: err.message } });
      throw err;
    }
    const h = await healthCheck(port);
    if (h) {
      instances[k].healthy = true;
      instances[k].version = String(h.version || "");
      await reconcileSessions(k).catch(() => undefined);
      emit({ scope: "harness", step: "ensure.up", detail: { kind: k, port } });
      return status(k);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGTERM");
  instances[k] = null;
  const err = new Error(k === SYSTEM ? "System opencode serve did not become healthy" : "opencode serve did not become healthy");
  err.status = 502;
  emit({ level: "error", scope: "harness", step: "ensure.error", detail: { kind: k, error: err.message } });
  throw err;
}

function flattenLiveProviders(data) {
  const blocks =
    data?.provider ||
    data?.providers ||
    data?.config?.provider ||
    data?.config?.providers ||
    (data && typeof data === "object" && !Array.isArray(data) ? data : {});
  const out = [];
  for (const [id, block] of Object.entries(blocks || {})) {
    const models = block?.models && typeof block.models === "object" ? block.models : {};
    if (Array.isArray(block?.models)) {
      for (const m of block.models) {
        const mid = m.id || m.modelID || m;
        if (!mid) continue;
        out.push({ providerID: id, modelID: String(mid), name: m.name || String(mid), connected: true, source: "live" });
      }
      continue;
    }
    for (const [mid, m] of Object.entries(models)) {
      out.push({
        providerID: id,
        modelID: mid,
        name: (m && m.name) || mid,
        connected: true,
        source: "live",
      });
    }
  }
  return out;
}

export async function listLiveModels() {
  if (!instances.company?.healthy) return [];
  for (const path of ["/config", "/global/config", "/provider"]) {
    try {
      const data = await ocFetch(path, {}, COMPANY);
      const models = flattenLiveProviders(data);
      if (models.length) return models;
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function listSessions(kind = COMPANY) {
  const data = await ocFetch("/session", {}, kind);
  return Array.isArray(data) ? data : [];
}

export async function createSession(body = {}, kind = COMPANY) {
  return ocFetch("/session", { method: "POST", body: JSON.stringify(body) }, kind);
}

export async function promptSession(sessionId, body, kind = COMPANY) {
  return ocFetch(
    `/session/${sessionId}/prompt_async`,
    { method: "POST", body: JSON.stringify(body) },
    kind,
  );
}

export async function sessionMessages(sessionId, kind = COMPANY) {
  const data = await ocFetch(`/session/${sessionId}/message`, {}, kind);
  return Array.isArray(data) ? data : data?.messages || [];
}

function partText(part) {
  if (!part) return "";
  if (typeof part === "string") return part;
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  if (Array.isArray(part.content)) return part.content.map(partText).join("\n");
  return "";
}

function messageParts(msg) {
  const raw = msg?.parts || msg?.info?.parts || msg?.content || [];
  return Array.isArray(raw) ? raw : [raw];
}

function flattenText(msg) {
  const parts = messageParts(msg);
  return parts
    .filter((p) => !p?.type || p.type === "text" || p.type === "output_text")
    .map(partText)
    .join("\n")
    .trim();
}

export function assistantText(messages) {
  const out = [];
  for (const msg of messages || []) {
    const role = msg.role || msg.info?.role;
    if (role && role !== "assistant") continue;
    const text = flattenText(msg);
    if (text) out.push({ id: msg.id || msg.info?.id, text, role: "assistant" });
  }
  return out;
}

export function sessionTranscript(messages) {
  const out = [];
  for (const msg of messages || []) {
    const role = msg.role || msg.info?.role || "assistant";
    if (role !== "assistant" && role !== "user") continue;
    const text = flattenText(msg);
    if (text) out.push({ id: msg.id || msg.info?.id, text, role });
  }
  return out;
}

export function bindSessionMeta(session, harness, state = getState()) {
  const id = session?.id || session?.sessionID || null;
  const title = String(session?.title || session?.slug || "");
  let seatId = null;
  const rosterMatch = title.match(/^roster:(.+)$/);
  if (rosterMatch) seatId = rosterMatch[1];
  const map = harness === SYSTEM ? state.systemSessions : state.sessions;
  if (!seatId && map) {
    for (const [seat, sid] of Object.entries(map)) {
      if (sid === id) seatId = seat;
    }
  }
  if (!seatId) {
    const seat = (state.seats || []).find((s) => s.lastSession === id);
    if (seat) seatId = seat.id;
  }
  const agent = session?.agent || session?.agentID || seatId || null;
  const channel = seatId ? state.sessionRooms?.[seatId] || `dm-${seatId}` : id ? `session-${id}` : null;
  return {
    id,
    title: title || (seatId ? `roster:${seatId}` : id || "session"),
    agent,
    harness,
    seatId,
    channel,
  };
}

export async function listBoundSessions() {
  const state = getState();
  const out = [];
  for (const kind of [COMPANY, SYSTEM]) {
    try {
      const live = await listSessions(kind);
      for (const session of live) {
        const meta = bindSessionMeta(session, kind, state);
        if (meta.id) out.push(meta);
      }
    } catch {
      /* harness offline */
    }
  }
  return out;
}

export async function reconcileSessions(kind = COMPANY) {
  const k = harnessKind(kind);
  const key = sessionKeyForKind(k);
  const live = await listSessions(k);
  const ids = new Set(live.map((s) => s.id || s.sessionID).filter(Boolean));
  mutate((s) => {
    s[key] = s[key] || {};
    for (const [seat, sid] of Object.entries(s[key])) {
      if (!ids.has(sid)) delete s[key][seat];
    }
  });
  return getState()[key];
}
