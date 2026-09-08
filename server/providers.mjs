/** OpenChamber-shaped write-through to OpenCode config + local auth sidecar. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { normalizeModelId } from "./seed.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ocDir = join(root, ".opencode");
const ocPath = join(ocDir, "opencode.json");
const authPath = join(root, ".roster-flow", "auth.json");

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
    plugin: ["roster-flow-opencode"],
    provider: {},
    providers: {},
  });
}

function providerBlocks(cfg) {
  const a = cfg.provider && typeof cfg.provider === "object" ? cfg.provider : {};
  const b = cfg.providers && typeof cfg.providers === "object" ? cfg.providers : {};
  return { ...a, ...b };
}

export function writeOpenCodeConfig(cfg) {
  mkdirSync(ocDir, { recursive: true });
  if (!cfg.plugin) cfg.plugin = ["roster-flow-opencode"];
  else if (!cfg.plugin.includes("roster-flow-opencode")) cfg.plugin.push("roster-flow-opencode");
  writeFileSync(ocPath, JSON.stringify(cfg, null, 2));
  return cfg;
}

function readAuth() {
  return readJson(authPath, {});
}

function writeAuth(auth) {
  mkdirSync(dirname(authPath), { recursive: true });
  writeFileSync(authPath, JSON.stringify(auth, null, 2));
}

export function listProviders() {
  const cfg = readOpenCodeConfig();
  const provider = providerBlocks(cfg);
  const auth = readAuth();
  return Object.entries(provider).map(([id, raw]) => {
    const models = raw.models && typeof raw.models === "object" ? raw.models : {};
    const settings = raw.settings || raw.options || {};
    const keyEnv = String(settings.apiKey || "").match(/\{env:([^}]+)\}/)?.[1];
    const connected = Boolean(auth[id] || (keyEnv && process.env[keyEnv]));
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

export function upsertProvider(body) {
  const id = String(body.id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  if (!id) throw Object.assign(new Error("provider id required"), { status: 400 });
  const cfg = readOpenCodeConfig();
  cfg.provider = cfg.provider || {};
  cfg.providers = cfg.providers || {};
  const models = {};
  for (const m of body.models || []) {
    const mid = String(m.id || m).trim();
    if (!mid) continue;
    models[mid] = { name: String(m.name || mid) };
  }
  const apiKeyEnv = String(body.apiKeyEnv || "").trim();
  const block = {
    npm: body.npm || "@ai-sdk/openai-compatible",
    package: body.package || body.npm || "@ai-sdk/openai-compatible",
    name: body.name || id,
    options: {
      ...(body.baseURL ? { baseURL: body.baseURL } : {}),
      ...(apiKeyEnv ? { apiKey: `{env:${apiKeyEnv}}` } : {}),
      ...(body.headers ? { headers: body.headers } : {}),
    },
    settings: {
      ...(body.baseURL ? { baseURL: body.baseURL } : {}),
      ...(apiKeyEnv ? { apiKey: `{env:${apiKeyEnv}}` } : {}),
    },
    models,
  };
  cfg.provider[id] = block;
  cfg.providers[id] = block;
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
  const global = flattenProviderModels(providerBlocks(globalCfg));
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

/** Merge stored Settings keys into env so `{env:VAR}` in opencode.json resolves. */
export function serveChildEnv(base = process.env) {
  const env = { ...base };
  const auth = readAuth();
  const cfg = readOpenCodeConfig();
  const fallback = {
    xai: "XAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
  };
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

export function keyStatusForModel(model) {
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
  const fallback = {
    xai: "XAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
  };
  const envName = p?.apiKeyEnv || fallback[parsed.providerID];
  return {
    providerID: parsed.providerID || "",
    modelID: parsed.modelID || "",
    configured: Boolean(p),
    connected: Boolean(p?.connected || (envName && env[envName])),
  };
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

export function resolveSeatModel(seat, modelOverride) {
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
  const connected = models.find((m) => m.connected);
  if (connected) return { providerID: connected.providerID, modelID: connected.modelID };
  return guess && raw ? { providerID: guess, modelID: raw } : undefined;
}

export function inferProviderId(model) {
  if (!model) return "";
  if (/grok|xai/i.test(model)) return "xai";
  if (/claude|sonnet|opus|haiku/i.test(model)) return "anthropic";
  if (/gpt|o[0-9]/i.test(model)) return "openai";
  if (/gemini|gemma/i.test(model)) return "google";
  return "";
}
