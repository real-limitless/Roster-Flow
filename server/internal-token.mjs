import { randomBytes, timingSafeEqual } from "node:crypto";
import { TOKEN_PREFIX } from "./tokens.mjs";

/**
 * The bearer token CORE gives its own OpenCode serves for the roster plugin.
 * It lives only in memory, so every CORE restart rotates it, and it only
 * reaches the routes the plugin's tools and hooks call.
 */
let current = mint();

function mint() {
  return `${TOKEN_PREFIX}int_${randomBytes(24).toString("hex")}`;
}

export function internalPluginToken() {
  return current;
}

/** Tests only: start over with a fresh token. */
export function rotateInternalPluginToken() {
  current = mint();
  return current;
}

export function isInternalPluginToken(token) {
  if (typeof token !== "string" || token.length !== current.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(current));
}

const ID = "[^/]+";
// `callback-secret` is a reserved jobs path. A job id of that name is not a plugin route.
const JOB_ID = "(?!callback-secret$)[^/]+";
const ALLOWED = [
  ["GET", `/api/v1/seats`],
  ["GET", `/api/v1/seats/${ID}`],
  ["GET", `/api/v1/seats/${ID}/inbox`],
  ["GET", `/api/v1/seats/${ID}/channels`],
  ["POST", `/api/v1/seats/${ID}/inbox/read`],
  ["PATCH", `/api/v1/seats/${ID}`],
  ["GET", `/api/v1/teams`],
  ["GET", `/api/v1/projects`],
  ["GET", `/api/v1/projects/${ID}/knowledge`],
  ["GET", `/api/v1/channels`],
  ["GET", `/api/v1/channels/${ID}`],
  ["GET", `/api/v1/channels/${ID}/messages`],
  ["GET", `/api/v1/channels/${ID}/thinking`],
  ["GET", `/api/v1/sessions/${ID}/room`],
  ["POST", `/api/v1/messages`],
  ["POST", `/api/v1/bus/send`],
  ["GET", `/api/v1/tasks`],
  ["POST", `/api/v1/tasks`],
  ["POST", `/api/v1/tasks/${ID}/claim`],
  ["POST", `/api/v1/tasks/${ID}/complete`],
  ["GET", `/api/v1/jobs/${JOB_ID}`],
  ["POST", `/api/v1/jobs/${JOB_ID}/complete`],
  ["POST", `/api/v1/architect/chat`],
].map(([method, path]) => ({ method, re: new RegExp(`^${path}$`) }));

export function internalTokenAllows(method, pathname) {
  return ALLOWED.some((r) => r.method === method && r.re.test(pathname));
}

/** Seat edits the plugin may make with the internal token (the session hook records `lastSession`). */
export const INTERNAL_SEAT_FIELDS = ["lastSession"];
