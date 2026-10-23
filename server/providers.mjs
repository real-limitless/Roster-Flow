/** OpenChamber-shaped write-through to OpenCode config + local auth sidecar. */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./paths.mjs";
import { homedir } from "node:os";
import { normalizeModelId } from "./seed.mjs";
import { contextTokenLimit, outputTokenLimit } from "./model-defaults.mjs";
import { inUseModelAllowed } from "./featherless-catalog.mjs";
import { authPath, opencodeDir as ocDir } from "./paths.mjs";
import { protectPrivateFile, writePrivateFile } from "./private-file.mjs";
import { getState } from "./store.mjs";

const ocPath = join(ocDir, "opencode.json");
const ROSTER_PLUGIN_NAME = "roster-flow-opencode";
const ROSTER_PLUGIN = pathToFileURL(join(root, "packages/roster-flow-opencode/index.js")).href;

function withRosterPlugin(list) {
  const items = (Array.isArray(list) ? list : []).filter((item) => item !== ROSTER_PLUGIN_NAME && item !== ROSTER_PLUGIN);
  items.push(ROSTER_PLUGIN);
  return items;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function readOpenCodeConfig() {
  return readJson(ocPath, {
    $schema: "https://opencode.ai/config.json",
    plugin: [ROSTER_PLUGIN],
    provider: {},
  });
}

function v2Package(raw) {
  const pkg = String(raw?.package || raw?.npm || "").replace(/^aisdk:/, "");
  if (!pkg) return "";
  return pkg.startsWith("@ai-sdk/") ? `aisdk:${pkg}` : pkg;
}

/**
 * v2 rewrites a provider id it recognizes (`featherless`) onto
 * `@opencode/ai/providers/openai-compatible` and then demands an OpenCode
 * account. A custom id keeps the request on the user's API key.
 */
const OPENCODE_OWNED_IDS = new Set(["featherless", "xai", "openai", "anthropic", "google", "groq", "mistral", "cohere", "openrouter"]);

export function harnessProviderId(id) {
  const clean = String(id || "").trim().toLowerCase();
  if (!OPENCODE_OWNED_IDS.has(clean)) return clean;
  return `roster-${clean}`;
}

/**
 * OpenCode v2.0.32 reads `providers`, `package` (`aisdk:` prefix), and
 * `settings`. It ignores the v1 `provider` / `npm` / `options` block.
 */
export function normalizeOpenCodeConfig(cfg = {}) {
  const out = { ...cfg };
  const provider = { ...(out.provider || {}), ...(out.providers || {}) };
  for (const [id, raw] of Object.entries(provider)) {
    if (!raw || typeof raw !== "object") continue;
    const owned = OPENCODE_OWNED_IDS.has(String(id).toLowerCase());
    const { settings, options, npm, package: pkg, ...rest } = raw;
    const merged = { ...(options || {}), ...(settings || {}) };
    if (owned) delete merged.provider;
    const pack = owned ? "@ai-sdk/openai-compatible" : v2Package({ package: pkg, npm });
    const nextId = harnessProviderId(id);
    if (nextId !== id) delete provider[id];
    provider[nextId] = {
      ...rest,
      ...(pack ? { package: pack } : {}),
      ...(Object.keys(merged).length ? { settings: merged } : {}),
    };
  }
  delete out.provider;
  out.providers = provider;
  if (out.agents || out.agent) {
    const agent = { ...(out.agents || {}), ...(out.agent || {}) };
    for (const [id, raw] of Object.entries(agent)) {
      if (!raw || typeof raw !== "object") continue;
      const { system, permissions, ...rest } = raw;
      agent[id] = {
        ...rest,
        ...(rest.prompt || !system ? {} : { prompt: system }),
        ...(rest.permission || !permissions || Array.isArray(permissions) ? {} : { permission: permissions }),
      };
    }
    delete out.agents;
    out.agent = agent;
  }
  return out;
}

export function providerBlocks(cfg) {
  const a = cfg.provider && typeof cfg.provider === "object" ? cfg.provider : {};
  const b = cfg.providers && typeof cfg.providers === "object" ? cfg.providers : {};
  return { ...a, ...b };
}

export function writeOpenCodeConfig(cfg) {
  mkdirSync(ocDir, { recursive: true });
  cfg.plugin = withRosterPlugin(cfg.plugin);
  const clean = normalizeOpenCodeConfig(cfg);
  writeFileSync(ocPath, JSON.stringify(clean, null, 2));
  return clean;
}

function readAuth() {
  protectPrivateFile(authPath);
  return readJson(authPath, {});
}

function writeAuth(auth) {
  writePrivateFile(authPath, JSON.stringify(auth, null, 2));
}

export function listProviders() {
  const cfg = readOpenCodeConfig();
  const global = readGlobalOpenCodeConfig();
  const provider = { ...providerBlocks(global), ...providerBlocks(cfg) };
  const auth = readAuth();
  const globalAuth = new Set(readGlobalAuthIds());
  return Object.entries(provider).map(([id, raw]) => {
    const models = raw.models && typeof raw.models === "object" ? raw.models : {};
    const settings = raw.settings || raw.options || {};
    const keyEnv = String(settings.apiKey || "").match(/\{env:([^}]+)\}/)?.[1];
    const connected = Boolean(auth[id] || (keyEnv && process.env[keyEnv]) || globalAuth.has(id));
    return {
      id,
      name: raw.name || id,
      npm: raw.npm || raw.package || "@ai-sdk/openai-compatible",
      baseURL: settings.baseURL || "",
      models: Object.entries(models).map(([mid, m]) => ({
        id: mid,
        name: (m && m.name) || mid,
      })),
      apiKeyEnv: keyEnv || "",
      connected,
      hasStoredKey: Boolean(auth[id]),
    };
  });
}

export function canonicalProviderId(id) {
  return String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
}

/** Models already stored for this provider, including limits. Boot merges these back in. */
export function configuredProviderModels(providerId) {
  const id = canonicalProviderId(providerId);
  if (!id) return [];
  const block = providerBlocks(readOpenCodeConfig())[id];
  const models = block?.models && typeof block.models === "object" ? block.models : {};
  return Object.entries(models).map(([mid, m]) => ({
    id: mid,
    name: (m && m.name) || mid,
    ...(m?.limit ? { limit: m.limit } : {}),
  }));
}

/** Model ids on this provider that a seat or team already assigns. A short catalog write must not drop them. */
export function providerModelIdsInUse(providerId, state) {
  const prefix = `${String(providerId || "").trim().toLowerCase()}/`;
  if (prefix === "/") return [];
  const ids = new Set();
  const take = (ref) => {
    const raw = String(ref || "").trim();
    if (!raw.toLowerCase().startsWith(prefix)) return;
    const id = raw.slice(prefix.length);
    if (id) ids.add(id);
  };
  for (const seat of state?.seats || []) {
    take(seat?.model);
    take(seat?.fallbackModel);
  }
  for (const team of state?.teams || []) {
    take(team?.defaultModel);
    take(team?.fallbackModel);
    for (const model of team?.allowedModels || []) take(model);
  }
  for (const channel of state?.channels || []) take(channel?.model);
  return [...ids];
}

function modelBlock(id, name, output, context) {
  return {
    name: String(name || id),
    limit: { context: contextTokenLimit(context, id), output: outputTokenLimit(output) },
  };
}

export function upsertProvider(body, state = getState(), offered) {
  const id = canonicalProviderId(body.id);
  if (!id) throw Object.assign(new Error("provider id required"), { status: 400 });
  const cfg = readOpenCodeConfig();
  cfg.provider = cfg.provider || {};
  const previous = cfg.provider[id]?.models && typeof cfg.provider[id].models === "object" ? cfg.provider[id].models : {};
  const models = {};
  for (const m of body.models || []) {
    const mid = String(m?.id || m || "").trim();
    if (!mid) continue;
    const output = m && typeof m === "object" ? (m.limit?.output ?? m.max_tokens ?? m.maxTokens) : undefined;
    const context = m && typeof m === "object" ? m.limit?.context : undefined;
    const name = m && typeof m === "object" ? m.name : mid;
    models[mid] = modelBlock(mid, name, output, context);
  }
  for (const mid of providerModelIdsInUse(id, state)) {
    if (models[mid]) continue;
    if (!inUseModelAllowed(id, mid, offered)) continue;
    const prev = previous[mid];
    models[mid] = modelBlock(mid, prev?.name, prev?.limit?.output, prev?.limit?.context);
  }
  const apiKeyEnv = String(body.apiKeyEnv || "").trim();
  const block = {
    npm: body.npm || "@ai-sdk/openai-compatible",
    name: body.name || id,
    options: {
      ...(body.baseURL ? { baseURL: body.baseURL } : {}),
      ...(apiKeyEnv ? { apiKey: `{env:${apiKeyEnv}}` } : {}),
      ...(body.headers ? { headers: body.headers } : {}),
    },
    models,
  };
  cfg.provider[id] = block;
  writeOpenCodeConfig(cfg);
  if (body.apiKey) setAuth(id, body.apiKey);
  return listProviders().find((p) => p.id === id);
}

export function setAuth(id, apiKey) {
  const auth = readAuth();
  auth[id] = { type: "api", key: String(apiKey) };
  writeAuth(auth);
  return { id, stored: true };
}

export function removeProvider(id) {
  const cfg = readOpenCodeConfig();
  if (cfg.provider) delete cfg.provider[id];
  if (cfg.providers) delete cfg.providers[id];
  writeOpenCodeConfig(cfg);
  const auth = readAuth();
  delete auth[id];
  writeAuth(auth);
  return { ok: true };
}

function globalAuthPaths() {
  return [join(homedir(), ".local/share/opencode", "auth.json"), join(homedir(), ".config/opencode", "auth.json")];
}

/** Provider ids stored by the OpenCode TUI. Values are never returned. */
export function readGlobalAuthIds() {
  const ids = new Set();
  for (const path of globalAuthPaths()) {
    const raw = readJson(path, null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    for (const id of Object.keys(raw)) {
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function flattenProviderModels(raw, connectedLookup = {}) {
  if (!raw || typeof raw !== "object") return [];
  const out = [];
  for (const [id, block] of Object.entries(raw)) {
    const models = block?.models && typeof block.models === "object" ? block.models : {};
    for (const [mid, m] of Object.entries(models)) {
      out.push({
        providerID: id,
        modelID: mid,
        name: (m && m.name) || mid,
        connected: Boolean(connectedLookup[id]),
        source: "config",
      });
    }
  }
  return out;
}

export function globalOpenCodePaths() {
  if (process.env.OPENCODE_CONFIG) return [process.env.OPENCODE_CONFIG];
  const home = homedir();
  return [
    join(home, ".config", "opencode", "opencode.json"),
    join(home, ".opencode", "opencode.json"),
  ];
}

export function readGlobalOpenCodeConfig() {
  for (const path of globalOpenCodePaths()) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* skip broken global config */
    }
  }
  return {};
}

export function listConfiguredModels() {
  const workspace = listProviders().flatMap((p) =>
    p.models.map((m) => ({
      providerID: p.id,
      modelID: m.id,
      name: m.name,
      connected: p.connected,
      source: "workspace",
    })),
  );
  const globalCfg = readGlobalOpenCodeConfig();
  const globalAuth = Object.fromEntries(readGlobalAuthIds().map((id) => [id, true]));
  const global = flattenProviderModels(providerBlocks(globalCfg), globalAuth);
  const seen = new Set(workspace.map((m) => `${m.providerID}/${m.modelID}`));
  const extra = global.filter((m) => !seen.has(`${m.providerID}/${m.modelID}`));
  return [...workspace, ...extra];
}

export function mergeModelLists(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const m of list || []) {
      const key = `${m.providerID}/${m.modelID}`;
      if (!m.providerID || !m.modelID || seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

export function listModels() {
  return listConfiguredModels();
}

/** Env vars the OpenCode serve child needs for roster-flow-opencode plugin tools. */
export const PLUGIN_PASSTHROUGH_ENV = ["WIKIFLOW_URL", "WIKIFLOW_TOKEN"];

const BUILTIN_KEY_ENV = {
  xai: "XAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/** Every `{env:NAME}` a provider block references, plus the built-in key vars. */
export function providerKeyEnvNames(...configs) {
  const names = new Set(Object.values(BUILTIN_KEY_ENV));
  for (const cfg of configs) {
    for (const raw of Object.values(providerBlocks(cfg || {}))) {
      for (const m of JSON.stringify(raw || {}).matchAll(/\{env:([^}]+)\}/g)) names.add(m[1]);
    }
  }
  return [...names];
}

/** Merge stored Settings keys into env so `{env:VAR}` in opencode.json resolves. */
export function serveChildEnv(base = process.env) {
  const env = { ...base };
  const cfg = readOpenCodeConfig();
  const passthrough = [...PLUGIN_PASSTHROUGH_ENV, ...providerKeyEnvNames(cfg, readGlobalOpenCodeConfig())];
  for (const name of passthrough) {
    if (base[name] === undefined && process.env[name] !== undefined) env[name] = process.env[name];
  }
  const auth = readAuth();
  const fallback = BUILTIN_KEY_ENV;
  for (const [id, rec] of Object.entries(auth)) {
    const key = typeof rec === "string" ? rec : rec?.key;
    if (!key) continue;
    const raw = providerBlocks(cfg)[id];
    const fromCfg = String(raw?.options?.apiKey || raw?.settings?.apiKey || "").match(/\{env:([^}]+)\}/)?.[1];
    const name = fromCfg || fallback[id] || `${String(id).toUpperCase().replace(/-/g, "_")}_API_KEY`;
    if (!env[name]) env[name] = key;
  }
  return env;
}

export function hasProviderKey() {
  const env = serveChildEnv();
  return Boolean(
    env.XAI_API_KEY ||
      env.ANTHROPIC_API_KEY ||
      env.OPENAI_API_KEY ||
      env.GOOGLE_GENERATIVE_AI_API_KEY ||
      listProviders().some((p) => p.connected),
  );
}

/**
 * Whether OpenCode actually loaded `providerID/modelID`. `loaded` is the live
 * list from the serve (`{ providerID, modelID }[]`); null means unknown.
 */
export function isLoadedModel(loaded, providerID, modelID) {
  if (!Array.isArray(loaded)) return null;
  return loaded.some((m) => m.providerID === providerID && (!modelID || m.modelID === modelID));
}

export function loadedProviderIds(loaded) {
  return Array.isArray(loaded) ? [...new Set(loaded.map((m) => m.providerID).filter(Boolean))] : [];
}

/** OpenCode ships this provider with no key. It is not a Roster fallback. */
export function isBuiltinProvider(providerID) {
  return String(providerID || "").toLowerCase() === "opencode";
}

const reachCache = new Map();

/** True when something accepts TCP connections on the provider base URL. */
export function endpointAccepts(baseURL, timeoutMs = 300) {
  if (!baseURL) return true;
  const cached = reachCache.get(baseURL);
  if (cached && Date.now() - cached.at < 5000) return cached.ok;
  let host;
  let port;
  try {
    const url = new URL(baseURL);
    host = url.hostname;
    port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  } catch {
    return false;
  }
  if (!host || !port) return false;
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      "const net=require('node:net'); const s=net.connect({host:process.argv[1], port:Number(process.argv[2])}); const t=setTimeout(()=>{s.destroy(); process.exit(1);}, Number(process.argv[3])); s.on('connect',()=>{clearTimeout(t); s.end(); process.exit(0);}); s.on('error',()=>process.exit(1));",
      host,
      String(port),
      String(timeoutMs),
    ],
    { timeout: timeoutMs + 250 },
  );
  const ok = probe.status === 0;
  reachCache.set(baseURL, { ok, at: Date.now() });
  return ok;
}

/**
 * A model may be written into the shared OpenCode config only when its provider
 * is configured, connected, and accepting connections. The built-in `opencode`
 * provider is never written: one bad agent model reloads the whole serve.
 */
export function modelAllowedInConfig(model) {
  const parsed = parseModelRef(model);
  if (!parsed?.providerID || !parsed.modelID) return false;
  if (isBuiltinProvider(parsed.providerID)) return false;
  const provider = listProviders().find((p) => p.id === parsed.providerID);
  if (!provider?.connected) return false;
  if ((provider.models || []).length && !provider.models.some((m) => m.id === parsed.modelID)) return false;
  if (provider.baseURL && !endpointAccepts(provider.baseURL)) return false;
  return true;
}

/** A connected configured model, restricted to ones the serve loaded when `loaded` is known. */
export function firstConnectedModel(loaded = null, models = listModels()) {
  const pool = (models || []).filter(
    (m) => m.connected && !isBuiltinProvider(m.providerID) && isLoadedModel(loaded, m.providerID, m.modelID) !== false,
  );
  if (!pool.length) return null;
  const preferred = [
    ["infiniterouter-dev", "big-pickle"],
    ["infiniterouter-dev", "auto"],
    ["infiniterouter", "small-tier"],
    ["standardcompute", "StandardComputeRouter"],
    ["xai", "grok-4"],
  ];
  for (const [providerID, modelID] of preferred) {
    const hit = pool.find((m) => m.providerID === providerID && m.modelID === modelID);
    if (hit) return hit;
  }
  return pool[0];
}

export function keyStatusForModel(model, loaded = null) {
  const parsed = parseModelRef(model) || {
    providerID: inferProviderId(model),
    modelID: String(model || "")
      .split("/")
      .filter(Boolean)
      .pop() || "",
  };
  const providers = listProviders();
  const p = providers.find((x) => x.id === parsed.providerID);
  const env = serveChildEnv();
  const envName = p?.apiKeyEnv || BUILTIN_KEY_ENV[parsed.providerID];
  const inGlobal = Boolean(providerBlocks(readGlobalOpenCodeConfig())[parsed.providerID]);
  return {
    providerID: parsed.providerID || "",
    modelID: parsed.modelID || "",
    configured: Boolean(p || inGlobal),
    connected: Boolean((inGlobal && p?.connected) || p?.hasStoredKey || (envName && env[envName])),
    loaded: isLoadedModel(loaded, parsed.providerID, parsed.modelID),
    providerLoaded: isLoadedModel(loaded, parsed.providerID),
    loadedProviders: loadedProviderIds(loaded),
  };
}

/** Connected by key and, when the live list is known, loaded by OpenCode. */
export function isUsable(st) {
  return Boolean(st?.connected) && st?.loaded !== false;
}

const AUTH_PRESETS = {
  xai: {
    name: "xAI",
    npm: "@ai-sdk/openai-compatible",
    baseURL: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    models: { "grok-4": { name: "Grok 4" } },
  },
  anthropic: {
    name: "Anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    models: { "claude-sonnet-4": { name: "Claude Sonnet 4" } },
  },
  openai: {
    name: "OpenAI",
    apiKeyEnv: "OPENAI_API_KEY",
    models: { "gpt-4.1": { name: "GPT-4.1" } },
  },
  google: {
    name: "Google",
    apiKeyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    models: { "gemini-2.5-pro": { name: "Gemini 2.5 Pro" } },
  },
};

/** Write built-in provider blocks when OpenCode already has that login. Never copies keys. */
export function ensureAuthProviders() {
  const ids = new Set(readGlobalAuthIds());
  const env = process.env;
  if (env.XAI_API_KEY) ids.add("xai");
  if (env.ANTHROPIC_API_KEY) ids.add("anthropic");
  if (env.OPENAI_API_KEY) ids.add("openai");
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) ids.add("google");
  const cfg = readOpenCodeConfig();
  const existing = providerBlocks(cfg);
  let changed = false;
  for (const id of ids) {
    if (existing[id] || !AUTH_PRESETS[id]) continue;
    const preset = AUTH_PRESETS[id];
    const block = {
      npm: preset.npm || "@ai-sdk/openai-compatible",
      name: preset.name || id,
      options: {
        ...(preset.baseURL ? { baseURL: preset.baseURL } : {}),
        ...(preset.apiKeyEnv ? { apiKey: `{env:${preset.apiKeyEnv}}` } : {}),
      },
      models: preset.models || {},
    };
    cfg.provider = cfg.provider || {};
      cfg.provider[id] = block;
      changed = true;
  }
  if (changed) writeOpenCodeConfig(cfg);
  return changed;
}

export function parseModelRef(model) {
  const normalized = normalizeModelId(model);
  if (!normalized) return null;
  const slash = normalized.indexOf("/");
  if (slash > 0) {
    return { providerID: normalized.slice(0, slash), modelID: normalized.slice(slash + 1) };
  }
  return null;
}

export function resolveSeatModel(seat, modelOverride, loaded = null) {
  const models = listModels();
  const raw = modelOverride || seat?.model;
  const parsed = parseModelRef(raw);
  if (parsed) {
    const exact = models.find((m) => m.providerID === parsed.providerID && m.modelID === parsed.modelID);
    return exact ? { providerID: exact.providerID, modelID: exact.modelID } : parsed;
  }
  if (raw) {
    const exact = models.find((m) => m.modelID === raw || m.name === raw);
    if (exact) return { providerID: exact.providerID, modelID: exact.modelID };
  }
  const guess = inferProviderId(raw);
  const fromGuess = models.find((m) => m.providerID === guess);
  if (fromGuess) return { providerID: fromGuess.providerID, modelID: raw || fromGuess.modelID };
  const connected = firstConnectedModel(loaded);
  if (connected) return { providerID: connected.providerID, modelID: connected.modelID };
  return guess && raw ? { providerID: guess, modelID: raw } : undefined;
}

export function resolveUsableModel(seat, modelOverride, loaded = null) {
  const explicit = String(modelOverride || seat?.model || "").trim();
  const resolved = resolveSeatModel(seat, modelOverride, loaded);
  if (!explicit) {
    if (resolved) {
      const st = keyStatusForModel(`${resolved.providerID}/${resolved.modelID}`, loaded);
      if (isUsable(st)) return resolved;
    }
    const fallback = firstConnectedModel(loaded);
    if (fallback) return { providerID: fallback.providerID, modelID: fallback.modelID };
    return resolved;
  }
  // An assigned model that the serve did not load must stay assigned. Swapping
  // in firstConnectedModel makes the wake look started while nothing is sent.
  const parsed = parseModelRef(explicit);
  const chosen = parsed || (resolved?.providerID ? resolved : null);
  if (!chosen?.providerID) return resolved;
  return { providerID: chosen.providerID, modelID: chosen.modelID };
}

export function inferProviderId(model) {
  if (!model) return "";
  if (/grok|xai/i.test(model)) return "xai";
  if (/claude|sonnet|opus|haiku/i.test(model)) return "anthropic";
  if (/gpt|o[0-9]/i.test(model)) return "openai";
  if (/gemini|gemma/i.test(model)) return "google";
  return "";
}
