import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Long-lived scoped API tokens (issue #67).
 * Format: rf_<48 hex>. Only a SHA-256 hash is stored; the plaintext is returned once.
 * Scopes: read (GET/HEAD), write (other methods), admin (token management + setup).
 */
export const TOKEN_PREFIX = "rf_";
export const SCOPES = ["read", "write", "admin"];

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function isApiToken(token) {
  return typeof token === "string" && token.startsWith(TOKEN_PREFIX);
}

function normalizeScopes(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "read").split(",");
  const scopes = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
  if (!scopes.length) throw fail(400, "at least one scope is required");
  const bad = scopes.filter((s) => !SCOPES.includes(s));
  if (bad.length) throw fail(400, `unknown scope: ${bad.join(", ")} (allowed: ${SCOPES.join(", ")})`);
  return scopes;
}

export function publicToken(rec) {
  if (!rec) return null;
  const { hash, ...rest } = rec;
  return rest;
}

/** Adds a token record. Pass `token` to register a known plaintext (env/CLI bootstrap). */
export function createApiToken(state, { name, scopes, expiresAt, expiresInDays, userId, token, seatId: rawSeat } = {}, now = Date.now()) {
  const n = String(name || "").trim();
  if (!n) throw fail(400, "name required");
  const owner = userId || (state.users || [])[0]?.id;
  if (!owner) throw fail(409, "create an owner before issuing API tokens");
  let seatId = null;
  if (rawSeat != null && String(rawSeat).trim()) {
    seatId = String(rawSeat).trim();
    if (!(state.seats || []).some((s) => s.id === seatId)) throw fail(400, "seat not found");
  }
  let expiry = null;
  if (expiresAt) expiry = new Date(expiresAt);
  else if (expiresInDays) expiry = new Date(now + Number(expiresInDays) * 86400000);
  if (expiry && (Number.isNaN(expiry.getTime()) || expiry.getTime() <= now)) throw fail(400, "expiry must be in the future");
  const plaintext = token ? String(token) : `${TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
  if (!isApiToken(plaintext) || plaintext.length < 24) throw fail(400, `token must start with ${TOKEN_PREFIX} and be at least 24 characters`);
  const hash = hashToken(plaintext);
  if ((state.apiTokens || []).some((t) => t.hash === hash)) throw fail(409, "token already registered");
  const rec = {
    id: `tok-${randomBytes(6).toString("hex")}`,
    name: n,
    scopes: normalizeScopes(scopes),
    prefix: plaintext.slice(0, 10),
    hash,
    userId: owner,
    seatId,
    createdAt: new Date(now).toISOString(),
    expiresAt: expiry ? expiry.toISOString() : null,
    revokedAt: null,
    lastUsedAt: null,
  };
  state.apiTokens = [...(state.apiTokens || []), rec];
  return { token: plaintext, record: publicToken(rec) };
}

export function listApiTokens(state) {
  return (state.apiTokens || []).map(publicToken);
}

export function revokeApiToken(state, id, now = Date.now()) {
  const rec = (state.apiTokens || []).find((t) => t.id === id);
  if (!rec) throw fail(404, "token not found");
  if (!rec.revokedAt) rec.revokedAt = new Date(now).toISOString();
  return publicToken(rec);
}

/** Returns { user, token } for a live token, else null. */
export function resolveApiToken(state, token, now = Date.now()) {
  if (!isApiToken(token)) return null;
  const want = Buffer.from(hashToken(token), "hex");
  const rec = (state.apiTokens || []).find((t) => {
    const have = Buffer.from(t.hash, "hex");
    return have.length === want.length && timingSafeEqual(have, want);
  });
  if (!rec || rec.revokedAt) return null;
  if (rec.expiresAt && new Date(rec.expiresAt).getTime() <= now) return null;
  const user = (state.users || []).find((u) => u.id === rec.userId);
  if (!user) return null;
  rec.lastUsedAt = new Date(now).toISOString();
  return { user, token: publicToken(rec) };
}

/** Scope needed for a request. Session logins are not scope-limited. */
export function requiredScope(method, pathname) {
  if (pathname === "/mcp" || pathname.startsWith("/mcp/")) return "read";
  if (pathname.startsWith("/api/v1/tokens") || pathname.startsWith("/api/v1/setup/")) return "admin";
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

export function tokenAllows(tokenRec, method, pathname) {
  if (!tokenRec) return true;
  const need = requiredScope(method, pathname);
  const have = new Set(tokenRec.scopes || []);
  if (have.has("admin")) return true;
  if (need === "read") return have.has("read") || have.has("write");
  return have.has(need);
}

/** Headless: register ROSTER_API_TOKEN (all scopes) once an owner exists. Idempotent. */
export function seedApiTokenFromEnv(state, env = process.env) {
  const token = String(env.ROSTER_API_TOKEN || "").trim();
  if (!token) return { seeded: false };
  if (!(state.users || []).length) return { seeded: false, reason: "no owner" };
  const hash = hashToken(token);
  if ((state.apiTokens || []).some((t) => t.hash === hash)) return { seeded: false, reason: "exists" };
  const scopes = env.ROSTER_API_TOKEN_SCOPES ? env.ROSTER_API_TOKEN_SCOPES : SCOPES;
  const out = createApiToken(state, { name: env.ROSTER_API_TOKEN_NAME || "bootstrap", scopes, token });
  return { seeded: true, record: out.record };
}
