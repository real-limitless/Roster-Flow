/**
 * Harness autostart (issue #68).
 *
 * When an owner exists and a provider is configured, boot starts company and
 * system `opencode serve`. A missing binary is logged and left offline; it
 * does not take down the API.
 *
 * ROSTER_PROVIDER_ID            seed this provider on boot (requires MODELS)
 * ROSTER_PROVIDER_NAME          display name (defaults to the id)
 * ROSTER_PROVIDER_NPM           defaults to @ai-sdk/openai-compatible
 * ROSTER_PROVIDER_BASE_URL
 * ROSTER_PROVIDER_API_KEY_ENV   env var name written as {env:NAME}
 * ROSTER_PROVIDER_MODELS        comma-separated model ids
 * ROSTER_HARNESS_AUTOSTART      auto (default), 1 (skip the provider check), 0 (never)
 * ROSTER_DISABLE_HARNESS_AUTOSTART=1  alias for ROSTER_HARNESS_AUTOSTART=0 (provider seed still runs)
 */
import { getState } from "./store.mjs";
import { featherlessOfferedModelIds, inUseModelAllowed } from "./featherless-catalog.mjs";
import { canonicalProviderId, configuredProviderModels, hasProviderKey, listProviders, upsertProvider } from "./providers.mjs";
import { ensure } from "./harness.mjs";

export function providerFromEnv(env = process.env) {
  const id = String(env.ROSTER_PROVIDER_ID || "").trim();
  if (!id) return null;
  const models = String(env.ROSTER_PROVIDER_MODELS || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((mid) => ({ id: mid, name: mid }));
  if (!models.length) return null;
  const name = String(env.ROSTER_PROVIDER_NAME || "").trim() || id;
  const npm = String(env.ROSTER_PROVIDER_NPM || "").trim();
  const baseURL = String(env.ROSTER_PROVIDER_BASE_URL || "").trim();
  const apiKeyEnv = String(env.ROSTER_PROVIDER_API_KEY_ENV || "").trim();
  return {
    id,
    name,
    ...(npm ? { npm } : {}),
    ...(baseURL ? { baseURL } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    models,
  };
}

const PROVIDER_KEY_ENVS = [
  "XAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "FEATHERLESS_API_KEY",
];

/** True when this env can seed a provider or already holds a provider key. */
export function envHasProvider(env = process.env) {
  if (providerFromEnv(env)) return true;
  const named = String(env.ROSTER_PROVIDER_API_KEY_ENV || "").trim();
  if (named && String(env[named] || "").trim()) return true;
  return PROVIDER_KEY_ENVS.some((name) => String(env[name] || "").trim());
}

/** True when env seed, a live provider key, or a configured model list is present. */
export function providerConfigured(env = process.env) {
  if (envHasProvider(env)) return true;
  try {
    if (hasProviderKey()) return true;
    return listProviders().some((p) => (p.models || []).length > 0);
  } catch {
    return false;
  }
}

/** `auto` (default), `1` (always try once an owner exists), or `0` (never). */
export function harnessAutostartMode(env = process.env) {
  if (String(env.ROSTER_DISABLE_HARNESS_AUTOSTART || "") === "1") return "0";
  const raw = String(env.ROSTER_HARNESS_AUTOSTART || "").trim().toLowerCase();
  if (["0", "false", "off", "no", "never"].includes(raw)) return "0";
  if (["1", "true", "on", "yes", "always"].includes(raw)) return "1";
  return "auto";
}

export function shouldAutostartHarness(state, env = process.env, configured = providerConfigured(env)) {
  const mode = harnessAutostartMode(env);
  if (mode === "0") return false;
  if (!(state?.users || []).length) return false;
  if (mode === "1") return true;
  return Boolean(configured);
}

/**
 * Env model list plus every model a seat or team already assigns on this provider.
 * A short ROSTER_PROVIDER_MODELS value must not drop DeepSeek-V4.1-Flash or Qwen.
 */
export function withSeatModels(spec, state, offered) {
  if (!spec?.id) return spec;
  const prefix = `${String(spec.id).trim().toLowerCase()}/`;
  const models = [...(spec.models || [])];
  const have = new Set(models.map((m) => m.id));
  const refs = [];
  for (const seat of state?.seats || []) refs.push(seat?.model, seat?.fallbackModel);
  for (const team of state?.teams || []) {
    refs.push(team?.defaultModel, team?.fallbackModel, ...(team?.allowedModels || []));
  }
  for (const ref of refs) {
    const raw = String(ref || "").trim();
    if (!raw.toLowerCase().startsWith(prefix)) continue;
    const id = raw.slice(prefix.length);
    if (!id || have.has(id)) continue;
    if (!inUseModelAllowed(spec.id, id, offered)) continue;
    have.add(id);
    models.push({ id, name: id });
  }
  return { ...spec, models };
}

/**
 * Drop stored Featherless ids the upstream catalog does not offer.
 * A null catalog means the read failed: keep every stored id.
 */
export function pruneUnlistedModels(models, offered) {
  if (!offered) return models || [];
  return (models || []).filter((m) => offered.has(String(m?.id || "").trim()));
}

/** Env and in-use models plus every model already stored for this provider. */
export function withPersistedModels(spec, persisted = []) {
  const models = [...(spec?.models || [])];
  const have = new Set(models.map((m) => m.id));
  for (const m of persisted) {
    const id = String(m?.id || "").trim();
    if (!id || have.has(id)) continue;
    have.add(id);
    models.push({ id, name: m.name || id, ...(m.limit ? { limit: m.limit } : {}) });
  }
  return { ...spec, models };
}

/**
 * Idempotent. No-op when ROSTER_PROVIDER_ID is unset. Does not throw on a missing model list.
 * When the Featherless catalog is readable, stored ids it does not offer are pruned.
 * When it is not, stored and in-use ids stay.
 */
function commitProviderSeed(env, state, offered) {
  const spec = providerFromEnv(env);
  const current = state ?? getState();
  const persisted = pruneUnlistedModels(configuredProviderModels(spec.id), offered);
  const merged = withSeatModels(withPersistedModels(spec, persisted), current, offered);
  const provider = upsertProvider(merged, current, offered);
  return { seeded: true, provider };
}

/** Fetch the catalog after boot has already served the permissive model list. */
function pruneFeatherlessWhenCatalogArrives(env, opts = {}) {
  const spec = providerFromEnv(env);
  return featherlessOfferedModelIds({
    fetchImpl: opts.fetchImpl,
    baseURL: spec?.baseURL || "https://api.featherless.ai/v1",
    apiKey: String(env.FEATHERLESS_API_KEY || ""),
    log: opts.log,
  }).then((offered) => {
    if (!offered) return { pruned: false };
    return { pruned: true, ...commitProviderSeed(env, getState(), offered) };
  });
}

export async function seedProviderFromEnv(env = process.env, state, opts = {}) {
  const id = String(env.ROSTER_PROVIDER_ID || "").trim();
  if (!id) return { seeded: false };
  const spec = providerFromEnv(env);
  if (!spec) return { seeded: false, reason: "ROSTER_PROVIDER_MODELS is required to seed a provider" };
  const current = state ?? getState();
  const deferCatalog = opts.backgroundCatalog === true && !("offered" in opts) && canonicalProviderId(spec.id) === "featherless";
  if (deferCatalog) {
    const seeded = commitProviderSeed(env, current, null);
    return { ...seeded, catalog: "pending", pending: pruneFeatherlessWhenCatalogArrives(env, opts) };
  }
  let offered;
  if ("offered" in opts) offered = opts.offered;
  else if (canonicalProviderId(spec.id) === "featherless") {
    offered = await featherlessOfferedModelIds({
      fetchImpl: opts.fetchImpl,
      baseURL: spec.baseURL || "https://api.featherless.ai/v1",
      apiKey: String(env.FEATHERLESS_API_KEY || ""),
      log: opts.log,
    });
  }
  return commitProviderSeed(env, current, offered);
}

export async function autostartHarness({ ensureFn = ensure, state = getState(), env = process.env, fetchImpl, log } = {}) {
  // Seed before the auto check so a provider written on this boot counts.
  // A hung Featherless catalog must not keep the harness offline: commit the
  // permissive list now and prune when the catalog arrives.
  let pending = null;
  try {
    const seeded = await seedProviderFromEnv(env, getState() || state, { backgroundCatalog: true, fetchImpl, log });
    pending = seeded?.pending || null;
    if (pending) {
      pending.catch((err) => console.error(`Featherless catalog prune failed: ${err.message}`));
    }
  } catch (err) {
    console.error(`Provider seed from env failed: ${err.message}`);
  }
  if (!shouldAutostartHarness(getState() || state, env)) {
    return { started: false, reason: "autostart off, no owner, or no provider", pending };
  }
  const results = {};
  for (const kind of ["company", "system"]) {
    try {
      results[kind] = await ensureFn({ kind });
    } catch (err) {
      results[kind] = { harness: "offline", error: err.message, code: err.code || null };
      console.error(`harness autostart (${kind}): ${err.message}`);
    }
  }
  return { started: true, results, pending };
}
