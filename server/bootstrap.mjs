import { createHash, timingSafeEqual } from "node:crypto";
import { addFirstUser, hashPassword } from "./auth.mjs";
import { applyOrgTemplate } from "./setup.mjs";

/**
 * Headless bootstrap (issue #66).
 *
 * ROSTER_BOOTSTRAP_TOKEN  when set, unauthenticated /api/v1/setup/* writes must
 *                         present it (header x-roster-bootstrap-token or body.bootstrapToken).
 * ROSTER_OWNER_EMAIL      seed the owner on boot when no owner exists, with
 * ROSTER_OWNER_PASSWORD   either a plaintext password (>= 8 chars) or
 * ROSTER_OWNER_PASSWORD_HASH  "scrypt$<saltHex>$<hashHex>" (scripts/create-owner.mjs --hash).
 * ROSTER_OWNER_NAME       optional display name (defaults to the email local part).
 * ROSTER_OWNER_TEMPLATE   org template for a seeded owner: empty (default) | starter.
 */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest();
}

export function bootstrapToken(env = process.env) {
  return String(env.ROSTER_BOOTSTRAP_TOKEN || "").trim();
}

export function bootstrapTokenFromRequest(req, body = {}) {
  const h = req?.headers || {};
  return String(h["x-roster-bootstrap-token"] || body?.bootstrapToken || "").trim();
}

/** Throws 401 when a bootstrap token is configured and the request does not carry it. */
export function requireBootstrapToken(req, body = {}, env = process.env) {
  const expected = bootstrapToken(env);
  if (!expected) return true;
  const given = bootstrapTokenFromRequest(req, body);
  if (!given || !timingSafeEqual(digest(given), digest(expected))) {
    throw fail(401, "bootstrap token required");
  }
  return true;
}

/**
 * Once an owner exists, first-user is closed.
 * start-over may reopen setup only after an owner session or the owner's password.
 */
export function setupClosed(state) {
  return (state.users || []).length > 0;
}

export function parsePasswordHash(raw) {
  const m = /^scrypt\$([0-9a-f]+)\$([0-9a-f]+)$/i.exec(String(raw || "").trim());
  if (!m) throw fail(400, "ROSTER_OWNER_PASSWORD_HASH must be scrypt$<saltHex>$<hashHex>");
  return { salt: m[1].toLowerCase(), hash: m[2].toLowerCase() };
}

export async function formatPasswordHash(password) {
  if (String(password || "").length < 8) throw fail(400, "password must be at least 8 characters");
  const { salt, hash } = await hashPassword(password);
  return `scrypt$${salt}$${hash}`;
}

export function ownerFromEnv(env = process.env) {
  const email = String(env.ROSTER_OWNER_EMAIL || "").trim();
  if (!email) return null;
  const password = env.ROSTER_OWNER_PASSWORD;
  const passwordHash = env.ROSTER_OWNER_PASSWORD_HASH;
  if (!password && !passwordHash) {
    throw fail(400, "ROSTER_OWNER_EMAIL is set but neither ROSTER_OWNER_PASSWORD nor ROSTER_OWNER_PASSWORD_HASH is");
  }
  return {
    email,
    name: String(env.ROSTER_OWNER_NAME || "").trim() || email.split("@")[0],
    password: password || undefined,
    passwordHash: passwordHash || undefined,
    template: env.ROSTER_OWNER_TEMPLATE === "starter" ? "starter" : "empty",
  };
}

/**
 * Create the owner and finish onboarding. Used by env seeding and the CLI.
 * Returns { state, user } with a new state object; caller persists it.
 */
export async function seedOwner(state, { email, name, password, passwordHash, template = "empty" }) {
  if (setupClosed(state)) throw fail(409, "owner already exists");
  const scratch = { ...state, users: [] };
  let user;
  if (passwordHash) {
    const parsed = parsePasswordHash(passwordHash);
    user = await addFirstUser(scratch, { name, email, password: "placeholder-not-used" });
    user.passwordSalt = parsed.salt;
    user.passwordHash = parsed.hash;
  } else {
    user = await addFirstUser(scratch, { name, email, password });
  }
  user.seededFrom = passwordHash ? "env-hash" : "env";
  const next = applyOrgTemplate({ ...state, users: [user] }, template === "starter" ? "starter" : "empty", user.name);
  return { state: next, user };
}

/** Seed from env on boot. No-op when no env owner is configured or an owner already exists. */
export async function seedOwnerFromEnv(state, env = process.env) {
  const spec = ownerFromEnv(env);
  if (!spec || setupClosed(state)) return { state, user: null, seeded: false };
  const out = await seedOwner(state, spec);
  return { ...out, seeded: true };
}
