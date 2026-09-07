/** OpenChamber-shaped write-through to OpenCode config + local auth sidecar. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  });
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
  const provider = cfg.provider && typeof cfg.provider === "object" ? cfg.provider : {};
  const auth = readAuth();
  return Object.entries(provider).map(([id, raw]) => {
    const models = raw.models && typeof raw.models === "object" ? raw.models : {};
    const keyEnv = String(raw.options?.apiKey || "").match(/\{env:([^}]+)\}/)?.[1];
    const connected = Boolean(auth[id] || (keyEnv && process.env[keyEnv]));
    return {
      id,
      name: raw.name || id,
      npm: raw.npm || "@ai-sdk/openai-compatible",
      baseURL: raw.options?.baseURL || "",
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
  const models = {};
  for (const m of body.models || []) {
    const mid = String(m.id || m).trim();
    if (!mid) continue;
    models[mid] = { name: String(m.name || mid) };
  }
  const apiKeyEnv = String(body.apiKeyEnv || "").trim();
  cfg.provider[id] = {
    npm: body.npm || "@ai-sdk/openai-compatible",
    name: body.name || id,
    options: {
      ...(body.baseURL ? { baseURL: body.baseURL } : {}),
      ...(apiKeyEnv ? { apiKey: `{env:${apiKeyEnv}}` } : {}),
      ...(body.headers ? { headers: body.headers } : {}),
    },
    models,
  };
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
  writeOpenCodeConfig(cfg);
  const auth = readAuth();
  delete auth[id];
  writeAuth(auth);
  return { ok: true };
}

export function listModels() {
  return listProviders().flatMap((p) =>
    p.models.map((m) => ({
      providerID: p.id,
      modelID: m.id,
      name: m.name,
      connected: p.connected,
    })),
  );
}
