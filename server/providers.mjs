/** OpenChamber-shaped write-through to OpenCode config + local auth sidecar. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
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

const FALLBACK_CATALOG = [
  { providerID: "xai", modelID: "grok-4", name: "Grok 4" },
  { providerID: "anthropic", modelID: "claude-sonnet", name: "Claude Sonnet" },
  { providerID: "openai", modelID: "gpt-5", name: "GPT-5" },
];

export function listModels() {
  const fromProviders = listProviders().flatMap((p) =>
    p.models.map((m) => ({
      providerID: p.id,
      modelID: m.id,
      name: m.name,
      connected: p.connected,
    })),
  );
  const seen = new Set(fromProviders.map((m) => `${m.providerID}/${m.modelID}`));
  const extra = FALLBACK_CATALOG.filter((m) => !seen.has(`${m.providerID}/${m.modelID}`)).map((m) => ({
    ...m,
    connected: false,
    fallback: true,
  }));
  return [...fromProviders, ...extra];
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

export function parseModelRef(model) {
  const normalized = normalizeModelId(model);
  if (!normalized) return null;
  const slash = normalized.indexOf("/");
  if (slash > 0) {
    return { providerID: normalized.slice(0, slash), modelID: normalized.slice(slash + 1) };
  }
  return null;
}

export function resolveSeatModel(seat) {
  const models = listModels();
  const parsed = parseModelRef(seat?.model);
  if (parsed) {
    const exact = models.find((m) => m.providerID === parsed.providerID && m.modelID === parsed.modelID);
    return exact ? { providerID: exact.providerID, modelID: exact.modelID } : parsed;
  }
  if (seat?.model) {
    const exact = models.find((m) => m.modelID === seat.model || m.name === seat.model);
    if (exact) return { providerID: exact.providerID, modelID: exact.modelID };
  }
  const guess = inferProviderId(seat?.model);
  const fromGuess = models.find((m) => m.providerID === guess);
  if (fromGuess) return { providerID: fromGuess.providerID, modelID: seat?.model || fromGuess.modelID };
  const connected = models.find((m) => m.connected);
  if (connected) return { providerID: connected.providerID, modelID: connected.modelID };
  return guess && seat?.model ? { providerID: guess, modelID: seat.model } : undefined;
}

export function inferProviderId(model) {
  if (!model) return "";
  if (/grok|xai/i.test(model)) return "xai";
  if (/claude|sonnet|opus|haiku/i.test(model)) return "anthropic";
  if (/gpt|o[0-9]/i.test(model)) return "openai";
  if (/gemini|gemma/i.test(model)) return "google";
  return "";
}
