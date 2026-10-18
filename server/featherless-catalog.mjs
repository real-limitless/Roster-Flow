/**
 * Featherless GET /v1/models, cached briefly.
 * A failed read returns null so callers keep the current in-use set.
 * This module stays dependency-free so the roster-setup image can copy it.
 */

const TTL_MS = 60_000;
const TIMEOUT_MS = 1500;
const moduleCache = { at: 0, baseURL: "", ids: null };

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
  ttl = TTL_MS,
  timeoutMs = TIMEOUT_MS,
  cacheStore,
} = {}) {
  const cache = cacheStore || moduleCache;
  const base = String(baseURL || "https://api.featherless.ai/v1").replace(/\/+$/, "");
  if (cache.ids && cache.baseURL === base && now - cache.at < ttl) return cache.ids;
  const headers = { accept: "application/json" };
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
    log(`featherless model catalog unreachable; keeping in-use models: ${err?.message || err}`);
    return null;
  }
}
