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
 * ROSTER_DISABLE_HARNESS_AUTOSTART=1  skip ensure (provider seed still runs)
 */
import { getState } from "./store.mjs";
import { hasProviderKey, listProviders, upsertProvider } from "./providers.mjs";
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

/** True when env seed, a live provider key, or a configured model list is present. */
export function providerConfigured(env = process.env) {
  if (providerFromEnv(env)) return true;
  try {
    if (hasProviderKey()) return true;
    return listProviders().some((p) => (p.models || []).length > 0);
  } catch {
    return false;
  }
}

export function shouldAutostartHarness(state, env = process.env, configured = providerConfigured(env)) {
  if (String(env.ROSTER_DISABLE_HARNESS_AUTOSTART || "") === "1") return false;
  if (!(state?.users || []).length) return false;
  return Boolean(configured);
}

/** Idempotent. No-op when ROSTER_PROVIDER_ID is unset. Does not throw on a missing model list. */
export function seedProviderFromEnv(env = process.env) {
  const id = String(env.ROSTER_PROVIDER_ID || "").trim();
  if (!id) return { seeded: false };
  const spec = providerFromEnv(env);
  if (!spec) return { seeded: false, reason: "ROSTER_PROVIDER_MODELS is required to seed a provider" };
  const provider = upsertProvider(spec);
  return { seeded: true, provider };
}

export async function autostartHarness({ ensureFn = ensure, state = getState(), env = process.env } = {}) {
  if (!shouldAutostartHarness(state, env)) return { started: false };
  const results = {};
  for (const kind of ["company", "system"]) {
    try {
      results[kind] = await ensureFn({ kind });
    } catch (err) {
      results[kind] = { harness: "offline", error: err.message, code: err.code || null };
      console.error(`harness autostart (${kind}): ${err.message}`);
    }
  }
  return { started: true, results };
}
