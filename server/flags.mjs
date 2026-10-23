/** Env flags shared by seed, auth, and setup (no module cycles). */

let skipNoticeSent = false;

function envFlag(name, env = process.env) {
  const v = String(env[name] || "").trim();
  return v === "1" || /^true$/i.test(v);
}

function envName(env, key) {
  return String(env[key] || "").trim().toLowerCase();
}

/** NODE_ENV or ENVIRONMENT is the word local. development and dev do not count. */
export function isExplicitlyLocal(env = process.env) {
  return envName(env, "NODE_ENV") === "local" || envName(env, "ENVIRONMENT") === "local";
}

/** NODE_ENV or ENVIRONMENT is local, dev, or development. */
export function isLocalOrDev(env = process.env) {
  const ok = new Set(["local", "dev", "development"]);
  return ok.has(envName(env, "NODE_ENV")) || ok.has(envName(env, "ENVIRONMENT"));
}

export function resetSkipOnboardingNotice() {
  skipNoticeSent = false;
}

export function skipOnboarding(env = process.env) {
  if (!envFlag("ROSTER_SKIP_ONBOARDING", env)) return false;
  if (isExplicitlyLocal(env)) return true;
  if (!skipNoticeSent) {
    skipNoticeSent = true;
    console.warn("ROSTER_SKIP_ONBOARDING is set but ignored because NODE_ENV/ENVIRONMENT is not local");
  }
  return false;
}

export function demoMode() {
  return envFlag("ROSTER_DEMO");
}

/** Interval for reseeding the starter company. 0 disables the timer. Default 30m when demo is on. */
export function demoResetMs() {
  if (!demoMode()) return 0;
  const raw = process.env.ROSTER_DEMO_RESET_MS;
  if (raw === undefined || String(raw).trim() === "") return 30 * 60 * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/** POST /api/v1/reset stays on for local Playwright / standup. Public demo locks it unless ROSTER_ALLOW_RESET=1. */
export function allowStateReset() {
  if (envFlag("ROSTER_ALLOW_RESET")) return true;
  return !demoMode();
}

export const DEMO_TOKEN = "roster-demo";
