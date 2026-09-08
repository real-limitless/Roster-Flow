/** Env flags shared by seed, auth, and setup (no module cycles). */

export function skipOnboarding() {
  const v = String(process.env.ROSTER_SKIP_ONBOARDING || "").trim();
  return v === "1" || /^true$/i.test(v);
}

export const DEMO_TOKEN = "roster-demo";
