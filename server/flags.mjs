/** Env flags shared by seed, auth, and setup (no module cycles). */

function envFlag(name) {
  const v = String(process.env[name] || "").trim();
  return v === "1" || /^true$/i.test(v);
}

export function skipOnboarding() {
  return envFlag("ROSTER_SKIP_ONBOARDING");
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
