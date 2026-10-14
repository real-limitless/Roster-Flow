import { COMPANY, SYSTEM, ensure, status as harnessStatus } from "./harness.mjs";
import { hasProviderKey, listProviders, upsertProvider } from "./providers.mjs";

/**
 * Harness auto-start (issue #68).
 *
 * Provider from env (optional):
 *   ROSTER_PROVIDER_ID            e.g. featherless
 *   ROSTER_PROVIDER_BASE_URL      e.g. https://api.featherless.ai/v1
 *   ROSTER_PROVIDER_API_KEY_ENV   name of the env var holding the key (the key itself is never written)
 *   ROSTER_PROVIDER_MODELS        comma-separated model ids
 *   ROSTER_PROVIDER_NAME, ROSTER_PROVIDER_NPM  optional
 * ROSTER_HARNESS_AUTOSTART       auto (default) | 1 (always try) | 0 (never)
 */

const state = { enabled: false, status: "idle", reason: null, error: null, startedAt: null, finishedAt: null };

export function autostartState() {
  return { ...state };
}

export function providerFromEnv(env = process.env) {
  const id = String(env.ROSTER_PROVIDER_ID || "").trim();
  if (!id) return null;
  const apiKeyEnv = String(env.ROSTER_PROVIDER_API_KEY_ENV || "").trim();
  const models = String(env.ROSTER_PROVIDER_MODELS || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return {
    id,
    name: env.ROSTER_PROVIDER_NAME || id,
    ...(env.ROSTER_PROVIDER_NPM ? { npm: env.ROSTER_PROVIDER_NPM } : {}),
    ...(env.ROSTER_PROVIDER_BASE_URL ? { baseURL: env.ROSTER_PROVIDER_BASE_URL } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    models,
  };
}

export function seedProviderFromEnv(env = process.env, upsert = upsertProvider) {
  const spec = providerFromEnv(env);
  if (!spec) return null;
  if (spec.apiKeyEnv && !env[spec.apiKeyEnv]) {
    console.warn(`ROSTER_PROVIDER_API_KEY_ENV=${spec.apiKeyEnv} but that variable is empty; provider ${spec.id} will be offline.`);
  }
  return upsert(spec);
}

/** Decide whether to start the harness on boot. Pure so it can be tested. */
export function shouldAutostart({ env = process.env, hasOwner, providerReady }) {
  const mode = String(env.ROSTER_HARNESS_AUTOSTART || "auto").trim().toLowerCase();
  if (mode === "0" || mode === "false" || mode === "off") return { start: false, reason: "disabled by ROSTER_HARNESS_AUTOSTART" };
  if (mode === "1" || mode === "true" || mode === "on") return { start: true, reason: "forced by ROSTER_HARNESS_AUTOSTART" };
  if (!hasOwner) return { start: false, reason: "no owner yet" };
  if (!providerReady) return { start: false, reason: "no provider with a key configured" };
  return { start: true, reason: "owner and provider configured" };
}

export function providerReady() {
  return hasProviderKey() || listProviders().some((p) => p.connected);
}

/** Start company + system harnesses. Never throws; result is visible via autostartState(). */
export async function autostartHarness({ env = process.env, hasOwner, ensureFn = ensure } = {}) {
  const decision = shouldAutostart({ env, hasOwner, providerReady: providerReady() });
  state.enabled = decision.start;
  state.reason = decision.reason;
  if (!decision.start) {
    state.status = "skipped";
    return autostartState();
  }
  state.status = "starting";
  state.startedAt = new Date().toISOString();
  const errors = [];
  for (const kind of [COMPANY, SYSTEM]) {
    try {
      await ensureFn({ kind });
    } catch (err) {
      errors.push(`${kind}: ${err.message}`);
    }
  }
  state.finishedAt = new Date().toISOString();
  state.status = errors.length ? "failed" : "up";
  state.error = errors.length ? errors.join("; ") : null;
  if (errors.length) console.error(`Harness auto-start failed: ${state.error}`);
  else console.log("Harness auto-start: company and system opencode serve are up.");
  return autostartState();
}

/** Readiness block for /api/v1/health. */
export function harnessReadiness(statusFn = harnessStatus) {
  const company = statusFn(COMPANY);
  const system = statusFn(SYSTEM);
  return {
    ready: company.harness === "up" && system.harness === "up",
    company: company.harness,
    system: system.harness,
    autostart: autostartState(),
  };
}
