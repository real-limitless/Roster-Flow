import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { DEMO_TOKEN, skipOnboarding } from "./flags.mjs";

const scrypt = promisify(scryptCb);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export { DEMO_TOKEN, skipOnboarding };

export function parseBearer(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  const match = /^Bearer\s+(\S+)/i.exec(String(header));
  return match ? match[1] : "";
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email || "",
    role: user.role || "owner",
    seatId: user.seatId || "you",
  };
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return { salt: salt.toString("hex"), hash: Buffer.from(hash).toString("hex") };
}

export async function verifyPassword(password, saltHex, hashHex) {
  if (!password || !saltHex || !hashHex) return false;
  const hash = await scrypt(String(password), Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function addFirstUser(state, { name, email, password } = {}) {
  if ((state.users || []).length) throw fail(409, "owner already exists");
  const n = String(name || "").trim();
  const e = String(email || "")
    .trim()
    .toLowerCase();
  const p = String(password || "");
  if (!n) throw fail(400, "name required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw fail(400, "valid email required");
  if (p.length < 8) throw fail(400, "password must be at least 8 characters");
  const { salt, hash } = await hashPassword(p);
  const user = {
    id: `usr-${randomBytes(6).toString("hex")}`,
    name: n,
    email: e,
    role: "owner",
    seatId: "you",
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  state.users = [user];
  return user;
}

export function createAuthSession(state, userId) {
  const token = randomBytes(32).toString("hex");
  const rec = {
    token,
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_MS).toISOString(),
  };
  const now = Date.now();
  state.authSessions = [...(state.authSessions || []).filter((s) => new Date(s.expiresAt).getTime() > now), rec];
  return rec;
}

export function userFromToken(state, token) {
  if (!token) return null;
  if (skipOnboarding() && token === DEMO_TOKEN) {
    const owner = (state.users || [])[0];
    return owner || { id: "demo", name: "You", email: "demo@localhost", role: "owner", seatId: "you" };
  }
  const rec = (state.authSessions || []).find((s) => s.token === token);
  if (!rec) return null;
  if (new Date(rec.expiresAt).getTime() <= Date.now()) return null;
  return (state.users || []).find((u) => u.id === rec.userId) || null;
}

export function revokeSession(state, token) {
  state.authSessions = (state.authSessions || []).filter((s) => s.token !== token);
}

export async function loginUser(state, { email, password } = {}) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  const user = (state.users || []).find((u) => u.email === e);
  if (!user || !(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
    throw fail(401, "invalid email or password");
  }
  const session = createAuthSession(state, user.id);
  return { token: session.token, user: publicUser(user) };
}
