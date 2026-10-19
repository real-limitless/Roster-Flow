/**
 * Featherless GET /v1/models.
 * A failed read returns null so callers keep stored and in-use ids.
 * This module stays free of other server imports so the roster-setup image can copy it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function rosterVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"));
    if (pkg.version) return String(pkg.version);
  } catch {
    /* setup image may not include package.json */
  }
  return "0.1.0";
}

/** Featherless rejects Node's default undici User-Agent with 404 Gone. */
export const ROSTER_USER_AGENT = `roster-flow/${rosterVersion()}`;
/** The catalog payload is several megabytes; keep a successful read for at least an hour. */
export const CATALOG_TTL_MS = 60 * 60 * 1000;
export const CATALOG_TIMEOUT_MS = 20_000;
const moduleCache = { at: 0, baseURL: "", ids: null };

export function resetFeatherlessCatalogCache() {
  moduleCache.at = 0;
  moduleCache.baseURL = "";
  moduleCache.ids = null;
}

export function inUseModelAllowed(providerId, modelId, offered) {
  if (String(providerId || "").trim().toLowerCase() !== "featherless") return true;
  if (!offered) return true;
  return offered.has(modelId);
}

/**
 * Set of model ids Featherless currently offers, or null when the catalog
 * cannot be read. Successful responses are cached for `ttl` milliseconds.
 */
export async function featherlessOfferedModelIds({
  fetchImpl = globalThis.fetch,
  baseURL = "https://api.featherless.ai/v1",
  apiKey = "",
  now = Date.now(),
  log = console.warn,
  ttl = CATALOG_TTL_MS,
  timeoutMs = CATALOG_TIMEOUT_MS,
  cacheStore,
} = {}) {
  const cache = cacheStore || moduleCache;
  const base = String(baseURL || "https://api.featherless.ai/v1").replace(/\/+$/, "");
  if (cache.ids && cache.baseURL === base && now - cache.at < ttl) return cache.ids;
  const headers = { accept: "application/json", "user-agent": ROSTER_USER_AGENT };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  try {
    const res = await fetchImpl(`${base}/models`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res?.ok) throw new Error(`HTTP ${res?.status || "error"}`);
    const data = await res.json();
    const list = data && Array.isArray(data.data) ? data.data : null;
    if (!list) throw new Error("missing data");
    const ids = new Set(list.map((m) => String(m?.id || "").trim()).filter(Boolean));
    cache.ids = ids;
    cache.at = now;
    cache.baseURL = base;
    return ids;
  } catch (err) {
    log(`featherless model catalog unreachable; keeping stored and in-use models: ${err?.message || err}`);
    return null;
  }
}
