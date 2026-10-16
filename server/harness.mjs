/**
 * Everflow-style OpenCode wrapper: company serve for product bots,
 * plus a dedicated System serve for Architect / Channel.
 */
import { internalPluginToken } from "./internal-token.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeOpenCodeConfig,
  serveChildEnv,
  readOpenCodeConfig,
  readGlobalOpenCodeConfig,
  ensureAuthProviders,
  loadedProviderIds,
} from "./providers.mjs";
import { getState, mutate } from "./store.mjs";
import { emit } from "./trace.mjs";
import { opencodeHostname, rosterApiUrl } from "./config.mjs";
import { companyWorkspace, dataDir, opencodeDir, root, systemWorkspace } from "./paths.mjs";

const HEALTH = "/global/health";
const instances = { company: null, system: null };
const inflight = { company: null, system: null };

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
      logFile: join(dataDir, "opencode-system.log"),
      sessionKey: "systemSessions",
      client: "roster-flow-system",
    };
  }
  return {
    kind: COMPANY,
    workspace: companyWorkspace,
    cwd: root,
    preferredPort: Number(process.env.OPENCODE_PORT) || 14180,
    logFile: join(dataDir, "opencode-serve.log"),
    sessionKey: "sessions",
    client: "roster-flow",
  };
}

export function workspacePath(kind = COMPANY) {
  return spec(kind).workspace;
}

/**
 * The config each serve must load. Company is the file Settings and
 * roster-setup write through providers.mjs (ROSTER_OPENCODE_DIR); System is
 * its own `.opencode` dir. OpenCode only discovers `.opencode/` by walking up
 * from cwd, which misses ROSTER_OPENCODE_DIR outside the repo (e.g. /data).
 */
export function configPaths(kind = COMPANY) {
  const dir = harnessKind(kind) === SYSTEM ? join(systemWorkspace, ".opencode") : opencodeDir;
  return { dir, file: join(dir, "opencode.json") };
}

/**
 * Env for `opencode serve`: provider keys, plugin env, and the config to load.
 * A non-empty OPENCODE_CONFIG is an operator override for the company serve.
 * OpenCode loads it before OPENCODE_CONFIG_DIR/opencode.json, so the providers
 * Settings and roster-setup write still apply on top. Compose passes "" when
 * unset, which means "use the default".
 */
export function serveEnv(kind = COMPANY, base = process.env) {
  const k = harnessKind(kind);
  const s = spec(k);
  const { dir, file } = configPaths(k);
  const override = k === COMPANY ? String(base.OPENCODE_CONFIG || "").trim() : "";
  return {
    ...serveChildEnv(base),
    OPENCODE_CONFIG: override || file,
    // Also scanned for opencode.json and agents/*.md.
    OPENCODE_CONFIG_DIR: dir,
    OPENCODE_CLIENT: s.client,
    NODE_PATH: [join(root, "node_modules"), base.NODE_PATH].filter(Boolean).join(":"),
    ROSTER_API: rosterApiUrl(),
    ROSTER_API_TOKEN: String(base.ROSTER_API_TOKEN || "").trim() || internalPluginToken(),
  };
}

export function whichOpenCode() {
  const envBin = process.env.OPENCODE_BIN;
  if (envBin) return existsSync(envBin) ? envBin : null;
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
      s.listen(port, opencodeHostname(), () => {
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
    const res = await fetch(`http://${opencodeHostname()}:${port}${HEALTH}`, { signal: ac.signal });
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
  const { dir, file: dest } = configPaths(COMPANY);
  mkdirSync(dir, { recursive: true });
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
  writeFileSync(dest, JSON.stringify(normalizeOpenCodeConfig(cfg), null, 2));
}

function writeSystemConfig() {
  const { dir: ocDir, file: dest } = configPaths(SYSTEM);
  mkdirSync(systemWorkspace, { recursive: true });
  mkdirSync(join(ocDir, "agents"), { recursive: true });
  const company = readOpenCodeConfig();
  const global = readGlobalOpenCodeConfig();
  let cfg = {
    $schema: "https://opencode.ai/config.json",
    plugin: ["roster-flow-opencode"],
    provider: {},
    agent: {},
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
  writeFileSync(dest, JSON.stringify(normalizeOpenCodeConfig(cfg), null, 2));
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
    config: inst?.config?.file || configPaths(k).file,
    loadedProviders: inst?.healthy ? loadedProviderIds(inst.loaded) : [],
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

/** Re-probe a known serve so `harness` reflects whether it answers right now. */
export async function refreshHealth(kind = COMPANY) {
  const k = harnessKind(kind);
  const inst = instances[k];
  if (!inst) return status(k);
  if (inst.child && inst.child.exitCode != null) {
    instances[k] = null;
    return status(k);
  }
  const h = await healthCheck(inst.port);
  if (instances[k] !== inst) return status(k);
  inst.healthy = Boolean(h);
  if (h) inst.version = String(h.version || inst.version || "");
  return status(k);
}

export async function liveCombinedStatus() {
  await Promise.all([refreshHealth(COMPANY), refreshHealth(SYSTEM)]);
  return combinedStatus();
}

/**
 * `{ providerID, modelID }` for every model the serve loaded (built-ins plus
 * config providers), from `GET /config/providers`. Null when unknown.
 */
export function flattenConfigProviders(data) {
  const list = Array.isArray(data?.providers) ? data.providers : Array.isArray(data) ? data : null;
  if (!list) return null;
  const out = [];
  for (const p of list) {
    const providerID = p?.id;
    if (!providerID) continue;
    const models = p.models && typeof p.models === "object" ? p.models : {};
    const ids = Array.isArray(models) ? models.map((m) => m?.id || m) : Object.keys(models);
    for (const modelID of ids) if (modelID) out.push({ providerID, modelID: String(modelID) });
  }
  return out;
}

export async function loadedModels(kind = COMPANY) {
  const k = harnessKind(kind);
  const inst = instances[k];
  if (!inst?.healthy) return null;
  try {
    const loaded = flattenConfigProviders(await ocFetch("/config/providers", {}, k));
    if (instances[k] === inst) inst.loaded = loaded;
    return loaded;
  } catch {
    return inst.loaded ?? null;
  }
}

/** Last list fetched by `loadedModels`, without a round trip. */
export function knownLoadedModels(kind = COMPANY) {
  const inst = instances[harnessKind(kind)];
  return inst?.healthy ? inst.loaded ?? null : null;
}

async function adoptIfHealthy(kind) {
  const k = harnessKind(kind);
  const s = spec(k);
  const h = await healthCheck(s.preferredPort);
  if (!h) return null;
  instances[k] = {
    port: s.preferredPort,
    baseUrl: `http://${opencodeHostname()}:${s.preferredPort}`,
    child: null,
    pid: null,
    healthy: true,
    version: String(h.version || ""),
    loaded: null,
    startedAt: Date.now(),
  };
  await reconcileSessions(k).catch(() => undefined);
  await loadedModels(k);
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
    const err = new Error(openCodeErrorText(data) || res.statusText || `HTTP ${res.status}`);
    err.status = res.status;
    err.detail = data;
    if (data && typeof data === "object" && typeof data.name === "string") err.name = data.name;
    throw err;
  }
  return data;
}

/** OpenCode errors are `{ name, data: { message } }`; older ones use `message`. */
export function openCodeErrorText(data) {
  if (typeof data === "string") return data.trim().slice(0, 500);
  if (!data || typeof data !== "object") return "";
  return String(data.data?.message || data.message || data.error || data.name || "").trim();
}

function errorStatus(err) {
  const d = err?.data || err?.detail?.data || err?.detail || {};
  return Number(err?.statusCode || d.statusCode || err?.status || 0) || null;
}

/**
 * Turn an OpenCode prompt failure (an HTTP error from the serve, or an
 * assistant message's `info.error`) into a message a user can act on.
 */
export function describeOpenCodeError(err, { model = "", kind = COMPANY } = {}) {
  const providerID = String(model).split("/")[0] || "the provider";
  const label = harnessKind(kind) === SYSTEM ? "System" : "company";
  const raw = [err?.message, openCodeErrorText(err?.detail), openCodeErrorText(err), err?.name].filter(Boolean).join(" ");
  const status = errorStatus(err);
  if (/ProviderModelNotFound|ProviderNotFound|Model not found|provider .*not found/i.test(raw)) {
    return {
      code: "PROVIDER_NOT_LOADED",
      status: 409,
      message: `${model || "That model"} is not loaded by the ${label} OpenCode harness. Check ${providerID} in Settings → Providers, then restart the harness.`,
    };
  }
  if (status === 401 || status === 403 || /ProviderAuthError|unauthori[sz]ed|invalid api key|incorrect api key|signed in|forbidden/i.test(raw)) {
    const detail = openCodeErrorText(err?.detail) || openCodeErrorText(err) || err?.message || "";
    return {
      code: "PROVIDER_AUTH",
      status: 502,
      message: `${providerID} rejected the API key${status ? ` (${status})` : ""}${detail ? `: ${detail}` : ""}. Update the key in Settings → Providers, then send again.`,
    };
  }
  const detail = openCodeErrorText(err?.detail) || err?.message || "unknown error";
  return {
    code: "OPENCODE_ERROR",
    status: status && status >= 400 && status < 500 ? status : 502,
    message: `OpenCode could not run ${model || "the prompt"}${status ? ` (${status}${err?.name && err.name !== "Error" ? ` ${err.name}` : ""})` : ""}: ${detail}`,
  };
}

/**
 * The failure of the latest turn, when the session ends in an assistant
 * message with `info.error` created at or after `since` (ms). Older errors
 * are history, not the turn the caller is waiting on.
 */
export function lastAssistantFailure(messages, { since = 0, kind = COMPANY } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list[list.length - 1];
  const info = last?.info || last;
  if (!info || (info.role || "") !== "assistant" || !info.error) return null;
  const created = Number(info.time?.created || 0);
  if (since && created && created < since) return null;
  const model = info.providerID ? `${info.providerID}/${info.modelID || ""}` : "";
  const { code, message } = describeOpenCodeError(info.error, { model, kind });
  return { id: `${info.id || "msg"}:error`, error: true, code, text: message };
}

export function ensure(opts = {}) {
  const k = harnessKind(opts.kind);
  const run = (inflight[k] || Promise.resolve())
    .catch(() => undefined)
    .then(() => ensureOnce({ ...opts, kind: k }));
  inflight[k] = run;
  run.then(
    () => {
      if (inflight[k] === run) inflight[k] = null;
    },
    () => {
      if (inflight[k] === run) inflight[k] = null;
    },
  );
  return run;
}

/** Restart serves that are up so they pick up provider or key changes. */
export function restartForProviderChange() {
  const kinds = [COMPANY, SYSTEM].filter((k) => instances[k]?.healthy);
  for (const k of kinds) {
    ensure({ kind: k, forceRestart: true }).catch((err) => {
      emit({ level: "error", scope: "harness", step: "restart.error", detail: { kind: k, error: String(err.message || err) } });
    });
  }
  return kinds;
}

async function ensureOnce({ forceRestart = false, kind = COMPANY } = {}) {
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
    const adopted = !instances[k].child;
    if (h && (adopted || instances[k].child.exitCode == null)) {
      instances[k].healthy = true;
      instances[k].version = String(h.version || instances[k].version || "");
      emit({ scope: "harness", step: "ensure.up", detail: { kind: k, ...(adopted ? { adopted: true } : {}) } });
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
  mkdirSync(dataDir, { recursive: true });

  const env = serveEnv(k);
  const child = spawn(binary, ["serve", "--hostname", opencodeHostname(), "--port", String(port)], {
    cwd: s.cwd,
    env,
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
  child.on("exit", (code) => {
    if (instances[k]?.child !== child) return;
    instances[k] = null;
    emit({ level: "warn", scope: "harness", step: "serve.exit", detail: { kind: k, code } });
  });

  instances[k] = {
    port,
    baseUrl: `http://${opencodeHostname()}:${port}`,
    child,
    pid: child.pid,
    healthy: false,
    version: null,
    loaded: null,
    startedAt: Date.now(),
    config: { file: env.OPENCODE_CONFIG, dir: env.OPENCODE_CONFIG_DIR },
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
      const loaded = await loadedModels(k);
      emit({
        scope: "harness",
        step: "ensure.up",
        detail: { kind: k, port, config: env.OPENCODE_CONFIG, providers: loadedProviderIds(loaded) },
      });
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

export async function deleteSession(sessionId, kind = COMPANY) {
  return ocFetch(`/session/${sessionId}`, { method: "DELETE" }, kind);
}

/** `roster:<seat>` is a seat's DM session; `roster:<seat>:<room>` is its session for that room. */
export function parseRosterTitle(title) {
  const m = String(title || "").match(/^roster:([^:]+)(?::(.+))?$/);
  if (!m) return null;
  return { seatId: m[1], channelId: m[2] || null };
}

/**
 * Decide whether one SSE event shows that this session's provider turn
 * finished or failed. User echoes are ignored. `state.userIds` collects them.
 */
export function serveStartedAt(kind = COMPANY) {
  return instances[harnessKind(kind)]?.startedAt || 0;
}

export function providerTurnVerdict(ev, sessionId, state = { userIds: new Set() }) {
  const props = ev?.properties || {};
  if (!props.sessionID || props.sessionID !== sessionId) return null;
  if (ev?.type === "message.updated") {
    const info = props.info || {};
    if (info.role === "user" && info.id) state.userIds.add(info.id);
    if (info.role !== "assistant") return null;
    if (info.id) state.assistantIds = state.assistantIds || new Set();
    if (info.id) state.assistantIds.add(info.id);
    if (info.id && state.parts?.get(info.id)) state.text = state.parts.get(info.id);
    if (info.error) {
      const described = describeOpenCodeError(info.error, {
        model: info.providerID ? `${info.providerID}/${info.modelID || ""}` : "",
      });
      return { reached: false, error: described.message, code: described.code };
    }
    if (info.time?.completed && state.text) return { reached: true, text: state.text };
    return null;
  }
  if (ev?.type === "message.part.updated") {
    const part = props.part || {};
    if (part.messageID && state.userIds?.has(part.messageID)) return null;
    if (part.messageID && part.text) {
      state.parts = state.parts || new Map();
      state.parts.set(part.messageID, `${state.parts.get(part.messageID) || ""}${part.text}`);
    }
    const assistant = part.messageID && state.assistantIds?.has(part.messageID);
    if (assistant && state.parts?.get(part.messageID)) state.text = state.parts.get(part.messageID);
    if (assistant && state.text) return { reached: true, text: state.text };
  }
  if (state.text && state.assistantIds?.size) return { reached: true, text: state.text };
  return null;
}

const eventStreams = new Map();

function closeEventStream(entry) {
  if (!entry || entry.closed) return;
  entry.closed = true;
  entry.ac.abort();
  entry.reader?.cancel().catch(() => undefined);
  if (eventStreams.get(entry.baseUrl) === entry) eventStreams.delete(entry.baseUrl);
}

function eventStream(kind) {
  const k = harnessKind(kind);
  const inst = instances[k];
  if (!inst?.baseUrl) return null;
  for (const [url, old] of eventStreams) {
    if (old.kind === k && url !== inst.baseUrl) closeEventStream(old);
  }
  const existing = eventStreams.get(inst.baseUrl);
  if (existing && !existing.closed) return existing;
  const ac = new AbortController();
  const entry = { kind: k, baseUrl: inst.baseUrl, ac, listeners: new Set(), reader: null, closed: false };
  eventStreams.set(inst.baseUrl, entry);
  entry.task = (async () => {
    try {
      const res = await fetch(`${entry.baseUrl}/event`, { signal: ac.signal, headers: { accept: "text/event-stream" } });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      entry.reader = reader;
      const dec = new TextDecoder();
      let buf = "";
      while (!entry.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data) continue;
          let ev;
          try {
            ev = JSON.parse(data);
          } catch {
            continue;
          }
          for (const listener of [...entry.listeners]) listener(ev);
        }
      }
    } catch {
      /* aborted when the last watcher leaves or the serve restarts */
    } finally {
      closeEventStream(entry);
    }
  })();
  return entry;
}

/**
 * Watch `GET /event` until the provider returns or the timeout elapses.
 * When this process is not running a serve, the prompt mock is the signal.
 */
export function watchProviderTurn(sessionId, kind = COMPANY, timeoutMs = Number(process.env.ROSTER_PROVIDER_TURN_MS) || 6000) {
  const inst = instances[harnessKind(kind)];
  if (!inst?.baseUrl || !sessionId) return Object.assign(Promise.resolve({ reached: true, unwatched: true }), { cancel() {} });
  const entry = eventStream(kind);
  const state = { userIds: new Set(), assistantIds: new Set(), text: "" };
  let timer;
  let listener;
  let settled = false;
  const promise = new Promise((resolve) => {
    const finish = (verdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      entry.listeners.delete(listener);
      if (!entry.listeners.size) closeEventStream(entry);
      resolve(verdict);
    };
    timer = setTimeout(() => finish({ reached: false, timeout: true }), timeoutMs);
    listener = (ev) => {
      const verdict = providerTurnVerdict(ev, sessionId, state);
      if (verdict) finish(verdict.text ? verdict : { ...verdict, text: state.text || "" });
    };
    entry.listeners.add(listener);
  });
  promise.cancel = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    entry.listeners.delete(listener);
    if (!entry.listeners.size) closeEventStream(entry);
  };
  return promise;
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
    const created = Number(msg.info?.time?.created || msg.time?.created || 0) || null;
    if (text) out.push({ id: msg.id || msg.info?.id, text, role: "assistant", created });
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
  const parsed = parseRosterTitle(title);
  let seatId = parsed?.seatId || null;
  let room = parsed?.channelId || null;
  if (!room && id) {
    for (const [seat, rooms] of Object.entries(state.roomSessions || {})) {
      for (const [channelId, entry] of Object.entries(rooms || {})) {
        if (entry?.sessionId === id) {
          seatId = seat;
          room = channelId;
        }
      }
    }
  }
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
  const channel = room || (seatId ? state.sessionRooms?.[seatId] || `dm-${seatId}` : id ? `session-${id}` : null);
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
