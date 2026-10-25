/**
 * In-memory rate limit and brute-force lockout for login, access, setup, and Slack.
 * One bucket per client IP, shared across those routes.
 */

const hits = new Map();
const failures = new Map();

function readInt(name, fallback, min, max, env) {
  const raw = env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function authGuardLimits(env = process.env) {
  return {
    windowMs: readInt("ROSTER_AUTH_RATE_WINDOW_MS", 10 * 60 * 1000, 1000, 24 * 60 * 60 * 1000, env),
    max: readInt("ROSTER_AUTH_RATE_MAX", 30, 1, 1_000_000, env),
    lockAfter: readInt("ROSTER_AUTH_LOCKOUT_AFTER", 8, 1, 1_000_000, env),
    lockMs: readInt("ROSTER_AUTH_LOCKOUT_MS", 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000, env),
  };
}

export function authGuardKind(method, pathname) {
  const path = String(pathname || "");
  if (path === "/api/v1/auth/login") return "login";
  if (path === "/api/v1/access") return "access";
  if (path.startsWith("/api/v1/setup/")) return "setup";
  if (path === "/api/v1/slack" || path.startsWith("/api/v1/slack/")) return "slack";
  return "";
}

function bucketKey(ip) {
  const value = String(ip || "unknown").slice(0, 80);
  return value || "unknown";
}

function retryAfter(ms) {
  return Math.max(1, Math.ceil(ms / 1000));
}

function prune(now, windowMs) {
  if (hits.size < 4000 && failures.size < 4000) return;
  for (const [key, stamps] of hits) {
    const recent = stamps.filter((t) => now - t < windowMs);
    if (recent.length) hits.set(key, recent);
    else hits.delete(key);
  }
  for (const [key, rec] of failures) {
    if (!rec.lockedUntil || rec.lockedUntil <= now) failures.delete(key);
  }
}

/** Count one request. Returns a 429 decision, or null when the request may proceed. */
export function chargeAuthRate(ip, now = Date.now(), env = process.env) {
  const limits = authGuardLimits(env);
  const key = bucketKey(ip);
  prune(now, limits.windowMs);
  const fail = failures.get(key);
  if (fail?.lockedUntil > now) {
    return {
      retryAfter: retryAfter(fail.lockedUntil - now),
      error: "too many failed attempts",
      reason: "lockout",
    };
  }
  if (fail?.lockedUntil && fail.lockedUntil <= now) failures.delete(key);

  const recent = (hits.get(key) || []).filter((t) => now - t < limits.windowMs);
  if (recent.length >= limits.max) {
    hits.set(key, recent);
    return {
      retryAfter: retryAfter(limits.windowMs - (now - recent[0])),
      error: "too many requests",
      reason: "rate",
    };
  }
  recent.push(now);
  hits.set(key, recent);
  return null;
}

export function recordAuthFailure(ip, now = Date.now(), env = process.env) {
  const limits = authGuardLimits(env);
  const key = bucketKey(ip);
  const prev = failures.get(key);
  const expired = prev?.lockedUntil && prev.lockedUntil <= now;
  const count = (expired ? 0 : prev?.count || 0) + 1;
  failures.set(key, {
    count,
    lockedUntil: count >= limits.lockAfter ? now + limits.lockMs : 0,
  });
}

export function clearAuthFailures(ip) {
  failures.delete(bucketKey(ip));
}

export function resetAuthGuard() {
  hits.clear();
  failures.clear();
}
