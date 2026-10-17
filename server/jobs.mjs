/**
 * Persistent jobs (issue #69, milestone M2).
 *
 * A job is a unit of work a caller hands to a seat or a team. Submit wakes the
 * resolved seat through the existing bus and posts the brief into the room.
 * `fileRefs` stay paths. Byte storage lives in `files.mjs`. `budget` is stored
 * and enforced per caller in a later milestone.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { uid } from "./store.mjs";
import { canCancelJob, canCompleteJob, canReadJob } from "./job-access.mjs";

export const JOB_STATUSES = ["queued", "running", "needs_human", "done", "failed", "cancelled"];
export const TERMINAL_STATUSES = ["done", "failed", "cancelled"];
export const ROUTING_MODES = ["supervisor", "round_robin", "specialist"];
export const CALLBACK_SECRET_MIN_BYTES = 32;
export const DEFAULT_CALLBACK_GRACE_MS = 10 * 60 * 1000;
export const MAX_CALLBACK_GRACE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CALLBACK_DNS_TIMEOUT_MS = 5000;
/** Gaps between delivery attempts. Three tries: immediately, then these delays. */
export const CALLBACK_RETRY_DELAYS_MS = [200, 800];
const TERMINAL = new Set(TERMINAL_STATUSES);
const OPEN = new Set(["queued", "running", "needs_human"]);

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

function pushEvent(job, type, extra = {}) {
  job.events.push({
    id: uid("evt"),
    type,
    at: job.updatedAt,
    status: job.status,
    ...extra,
  });
}

/** Jobs stored before credentials were rejected may still carry user:pass@. */
function publicCallbackUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    caller: { ...job.caller },
    target: job.target,
    assignee: job.assignee,
    teamId: job.teamId,
    routing: job.routing,
    specialist: job.specialist,
    brief: job.brief,
    fileRefs: (job.fileRefs || []).map((f) => ({ ...f })),
    files: (job.files || []).map((f) => ({ name: f.name, size: f.size, sha256: f.sha256, updatedAt: f.updatedAt })),
    priority: job.priority || null,
    status: job.status,
    result: job.result,
    cost: job.cost,
    tokens: job.tokens ? { ...job.tokens } : null,
    budget: job.budget ? { ...job.budget } : null,
    runId: job.runId,
    channel: job.channel,
    callbackUrl: publicCallbackUrl(job.callbackUrl),
    wake: job.wake ? { ...job.wake } : null,
    callback: job.callback ? { ...job.callback } : null,
    reportedBy: job.reportedBy || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    events: (job.events || []).map((e) => ({ ...e })),
  };
}

function requireJob(state, id) {
  const job = (state.jobs || []).find((j) => j.id === id);
  if (!job) throw fail(404, "job not found");
  return job;
}

export function getJob(state, id) {
  const job = (state.jobs || []).find((j) => j.id === id);
  return job ? publicJob(job) : null;
}

export function listJobs(state, { status, target, assignee } = {}) {
  if (status && !JOB_STATUSES.includes(status)) throw fail(400, `status must be one of ${JOB_STATUSES.join(", ")}`);
  const jobs = (state.jobs || []).filter((j) => {
    if (status && j.status !== status) return false;
    if (target && j.target !== target) return false;
    if (assignee && j.assignee !== assignee) return false;
    return true;
  });
  return jobs.slice().reverse().map(publicJob);
}

function normalizeFileRefs(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw fail(400, "fileRefs must be an array of { path, name? }");
  if (raw.length > 32) throw fail(400, "fileRefs accepts at most 32 entries");
  return raw.map((entry, i) => {
    const where = `fileRefs[${i}]`;
    if (typeof entry === "string") {
      const path = entry.trim();
      if (!path) throw fail(400, `${where} path is required`);
      return { path: path.slice(0, 240) };
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw fail(400, `${where} must be { path, name? }`);
    const path = String(entry.path || "").trim();
    if (!path) throw fail(400, `${where}.path is required`);
    const ref = { path: path.slice(0, 240) };
    if (entry.name) ref.name = String(entry.name).slice(0, 180);
    return ref;
  });
}

function ipv4Bytes(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => n > 255)) return null;
  return nums;
}

function ipv6Bytes(ip) {
  let raw = String(ip).toLowerCase().split("%")[0];
  if (!raw.includes(":")) return null;
  const dotted = raw.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = ipv4Bytes(dotted[2]);
    if (!v4) return null;
    raw = `${dotted[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const parse = (side) => (side ? side.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? Number.parseInt(h, 16) : Number.NaN)) : []);
  const left = parse(halves[0]);
  const right = halves.length === 2 ? parse(halves[1]) : [];
  if ([...left, ...right].some((n) => Number.isNaN(n))) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const words = halves.length === 2 ? [...left, ...Array(missing).fill(0), ...right] : left;
  if (words.length !== 8) return null;
  const bytes = [];
  for (const word of words) {
    bytes.push((word >> 8) & 0xff, word & 0xff);
  }
  return bytes;
}

function parseAddress(address) {
  const s = String(address || "").replace(/^\[|\]$/g, "");
  if (isIP(s) === 4) return { family: 4, bytes: ipv4Bytes(s) };
  const bytes = ipv6Bytes(s);
  return bytes ? { family: 6, bytes } : null;
}

function cidrs(list) {
  return list.map((entry) => {
    const [ip, bits] = entry.split("/");
    return { bytes: parseAddress(ip).bytes, bits: Number(bits) };
  });
}

function inCidrs(bytes, table) {
  return table.some(({ bytes: base, bits }) => {
    if (base.length !== bytes.length) return false;
    for (let i = 0; i < bits; i += 8) {
      const mask = (0xff << (8 - Math.min(8, bits - i))) & 0xff;
      if ((bytes[i >> 3] & mask) !== (base[i >> 3] & mask)) return false;
    }
    return true;
  });
}

const IPV4_BLOCKED = cidrs([
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "192.88.99.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
]);
const IPV6_BLOCKED = cidrs([
  "::/96",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
  "100::/64",
  "2001::/32",
  "2001:2::/48",
  "2001:10::/28",
  "2001:db8::/32",
  "2002::/16",
  "fc00::/7",
  "fe80::/10",
  "fec0::/10",
  "ff00::/8",
]);
// 0.0.0.0/8, link-local, and cloud metadata. ROSTER_CALLBACK_ALLOWLIST cannot opt these in.
const IPV4_NEVER = cidrs(["0.0.0.0/8", "169.254.0.0/16", "100.100.100.200/32", "168.63.129.16/32"]);
const IPV6_NEVER = cidrs(["fe80::/10", "fd00:ec2::254/128"]);

const V4_MAPPED = cidrs(["::ffff:0:0/96"]);
const V4_COMPAT = cidrs(["::/96"]);
const NAT64 = cidrs(["64:ff9b::/96"]);
const NAT64_LOCAL = cidrs(["64:ff9b:1::/48"]);
const SIX_TO_FOUR = cidrs(["2002::/16"]);
const TEREDO = cidrs(["2001::/32"]);

function isIpv6Loopback(b) {
  for (let i = 0; i < 15; i++) if (b[i] !== 0) return false;
  return b[15] === 1;
}

/** Every IPv4 address an IPv6 address can carry (RFC 4291, 6052, 3056, 4380). */
function embeddedIPv4(b) {
  const at = (...i) => i.map((n) => b[n]);
  const out = [];
  // `::1` is IPv6 loopback. It is also the deprecated IPv4-compatible form of
  // 0.0.0.1; keep the loopback identity so an allowlisted `::1` still works.
  const compat = inCidrs(b, V4_COMPAT) && !isIpv6Loopback(b);
  if (inCidrs(b, V4_MAPPED) || compat || inCidrs(b, NAT64)) out.push(at(12, 13, 14, 15));
  // RFC 6052 layouts for /48, /56, /64, and /96 prefixes inside the local-use block.
  if (inCidrs(b, NAT64_LOCAL)) out.push(at(6, 7, 9, 10), at(7, 9, 10, 11), at(9, 10, 11, 12), at(12, 13, 14, 15));
  if (inCidrs(b, SIX_TO_FOUR)) out.push(at(2, 3, 4, 5));
  if (inCidrs(b, TEREDO)) out.push(at(4, 5, 6, 7), at(12, 13, 14, 15).map((n) => n ^ 0xff));
  return out;
}

/** "never": link-local, metadata, or unparseable. "blocked": not public. "public": ok. */
function addressVerdict(address) {
  const parsed = parseAddress(address);
  if (!parsed?.bytes) return "never";
  const { family, bytes } = parsed;
  if (family === 4) {
    if (inCidrs(bytes, IPV4_NEVER)) return "never";
    return inCidrs(bytes, IPV4_BLOCKED) ? "blocked" : "public";
  }
  const embedded = embeddedIPv4(bytes);
  if (inCidrs(bytes, IPV6_NEVER) || embedded.some((v4) => inCidrs(v4, IPV4_NEVER))) return "never";
  if (inCidrs(bytes, IPV6_BLOCKED) || embedded.some((v4) => inCidrs(v4, IPV4_BLOCKED))) return "blocked";
  return "public";
}

export function callbackAddressBlocked(address, { allowlisted = false } = {}) {
  const verdict = addressVerdict(address);
  if (verdict === "never") return true;
  return verdict === "blocked" && !allowlisted;
}

function decimalIPv4(host) {
  if (!/^\d+$/.test(host)) return null;
  const n = Number(host);
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** Same host form `new URL` produces, so `2001:0db8::1` matches `2001:db8::1`. */
function canonicalHost(host) {
  const bare = String(host || "").replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!bare || !bare.includes(":")) return bare;
  try {
    return new URL(`http://[${bare}]`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return bare;
  }
}

/**
 * `ROSTER_CALLBACK_ALLOWLIST`: comma-separated `host` or `host:port` (IPv6 as
 * `[addr]` or `[addr]:port`). Matching is exact and case-insensitive; a bare host
 * matches any port. Prefer `host:port`. IPv6 entries are normalized to the URL
 * form. Hosts must be ASCII (punycode `xn--` for IDNs) because URL parsing
 * punycodes the callback host; non-ASCII entries never match and are dropped.
 * `*.host` wildcards never match.
 */
export function callbackAllowlist(env) {
  const out = [];
  for (const item of String(env?.ROSTER_CALLBACK_ALLOWLIST || "").split(",")) {
    const entry = item.trim().toLowerCase();
    if (!entry || !/^[\x21-\x7e]+$/.test(entry)) continue;
    if (entry.includes("*")) continue;
    let host = entry;
    let port = null;
    const bracketed = entry.match(/^\[([^\]]+)\](?::(\d+))?$/);
    const hostPort = entry.match(/^([^:[\]]+):(\d+)$/);
    if (bracketed) {
      host = bracketed[1];
      port = bracketed[2] ?? null;
    } else if (hostPort) {
      host = hostPort[1];
      port = hostPort[2];
    } else if (entry.includes(":") && isIP(entry) !== 6) {
      continue;
    }
    if (port != null) {
      port = Number(port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    }
    host = canonicalHost(host);
    if (!host) continue;
    out.push({ host, port });
  }
  return out;
}

/** Startup warnings. Entries containing `*` are dropped and never match. */
export function callbackAllowlistWarnings(env = process.env) {
  const warnings = [];
  for (const item of String(env?.ROSTER_CALLBACK_ALLOWLIST || "").split(",")) {
    const entry = item.trim();
    if (entry.includes("*")) {
      warnings.push(
        `ROSTER_CALLBACK_ALLOWLIST entry "${entry}" is ignored and never matches: wildcards are not supported. Prefer an exact host:port.`,
      );
    }
  }
  return warnings;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(fail(400, message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function callbackDnsTimeoutMs(env = process.env, override) {
  if (override != null && override !== "") {
    const picked = Number(override);
    if (Number.isFinite(picked) && picked > 0) return picked;
  }
  const raw = env?.ROSTER_CALLBACK_DNS_TIMEOUT_MS;
  if (raw == null || String(raw).trim() === "") return DEFAULT_CALLBACK_DNS_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CALLBACK_DNS_TIMEOUT_MS;
  return n;
}

async function callbackAddresses(host, lookupImpl, timeoutMs) {
  if (isIP(host)) return [{ address: host, family: isIP(host) }];
  const legacy = decimalIPv4(host);
  if (legacy) return [{ address: legacy, family: 4 }];
  let rows;
  try {
    rows = await withTimeout(
      Promise.resolve().then(() => (lookupImpl || lookup)(host, { all: true, verbatim: true })),
      timeoutMs,
      "callbackUrl host lookup timed out",
    );
  } catch (err) {
    if (err?.status === 400 && /timed out/.test(String(err.message))) throw err;
    throw fail(400, "callbackUrl host did not resolve");
  }
  const list = Array.isArray(rows) ? rows : [rows];
  const addresses = list
    .map((row) => (typeof row === "string" ? row : row?.address))
    .filter(Boolean)
    .map((address) => ({ address, family: isIP(address) }));
  if (!addresses.length) throw fail(400, "callbackUrl host did not resolve");
  return addresses;
}

/**
 * Syntax and scheme only. No DNS. Job create uses this so a hanging lookup
 * cannot stall `POST /api/v1/jobs`.
 */
export function callbackUrlSyntax(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (s.length > 2048) throw fail(400, "callbackUrl is too long");
  let url;
  try {
    url = new URL(s);
  } catch {
    throw fail(400, "callbackUrl must be an http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw fail(400, "callbackUrl must be an http(s) URL");
  if (url.username || url.password) throw fail(400, "callbackUrl must not contain credentials");
  const host = canonicalHost(url.hostname);
  if (!host) throw fail(400, "callbackUrl host is required");
  return url.toString();
}

/**
 * http(s) only, no `user:pass@`. Resolves the host once and checks every
 * address. Loopback, private, documentation, multicast, and other non-public
 * ranges are rejected unless `ROSTER_CALLBACK_ALLOWLIST` names the host.
 * Link-local and metadata addresses are rejected even when it does.
 * Delivery connects only to the returned `addresses`.
 */
export async function resolveCallback(raw, { env = process.env, lookup: lookupImpl = lookup, dnsTimeoutMs } = {}) {
  const href = callbackUrlSyntax(raw);
  if (!href) return null;
  const url = new URL(href);
  const host = canonicalHost(url.hostname);
  const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  const allowlisted = callbackAllowlist(env).some((e) => e.host === host && (e.port == null || e.port === port));
  const addresses = await callbackAddresses(host, lookupImpl, callbackDnsTimeoutMs(env, dnsTimeoutMs));
  if (addresses.some(({ address }) => callbackAddressBlocked(address, { allowlisted }))) {
    throw fail(400, "callbackUrl resolves to a blocked address");
  }
  return { href: url.toString(), url, host, port, addresses };
}

export async function normalizeCallback(raw, opts) {
  const target = await resolveCallback(raw, opts);
  return target ? target.href : null;
}

function normalizePriority(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s || s.length > 32) throw fail(400, "priority must be 1-32 characters");
  return s;
}

function normalizeBudget(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw fail(400, "budget must be { tokens?, cost? }");
  const out = {};
  for (const key of ["tokens", "cost"]) {
    if (raw[key] == null || raw[key] === "") continue;
    const n = Number(raw[key]);
    if (!Number.isFinite(n) || n < 0) throw fail(400, `budget.${key} must be a non-negative number`);
    out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

function normalizeNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw fail(400, `${label} must be a non-negative number`);
  return n;
}

export function normalizeTokens(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || (typeof value === "string" && value.trim() && !value.trim().startsWith("{"))) {
    return { total: normalizeNumber(value, "tokens") };
  }
  let obj = value;
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value);
    } catch {
      throw fail(400, "tokens must be a number or { input, output, total }");
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw fail(400, "tokens must be a number or { input, output, total }");
  const out = {};
  for (const key of ["input", "output", "total"]) {
    if (obj[key] == null || obj[key] === "") continue;
    out[key] = normalizeNumber(obj[key], `tokens.${key}`);
  }
  if (!Object.keys(out).length) throw fail(400, "tokens needs input, output, or total");
  return out;
}

function normalizeChannel(state, raw) {
  const explicit = !(raw == null || String(raw).trim() === "");
  const id = String(explicit ? raw : "ship").replace(/^#/, "").trim();
  if (!id) throw fail(400, "channel required");
  const channels = state.channels || [];
  if (channels.some((c) => c.id === id)) return id;
  if (!explicit && channels.some((c) => c.id === "general")) return "general";
  throw fail(404, "channel not found");
}

function normalizeRunId(raw) {
  if (raw == null || raw === "") return uid("run");
  const s = String(raw).trim();
  if (!s || s.length > 80) throw fail(400, "runId must be 1-80 characters");
  return s;
}

function normalizeCaller(caller = {}) {
  return {
    userId: caller.userId || null,
    seatId: caller.seatId || "you",
    name: caller.name || null,
    tokenId: caller.tokenId || null,
  };
}

function routingMode(raw) {
  if (raw == null || raw === "") return null;
  const mode = String(raw).trim().replace("-", "_");
  if (!ROUTING_MODES.includes(mode)) throw fail(400, `routing must be ${ROUTING_MODES.join(", ")}`);
  return mode;
}

function workerPool(state, team) {
  const skip = new Set([team.supervisorSeatId].filter(Boolean));
  const pool = [];
  for (const id of team.seatIds || []) {
    if (skip.has(id)) continue;
    const seat = (state.seats || []).find((s) => s.id === id);
    if (!seat || seat.kind !== "bot" || seat.seatType === "supervisor") continue;
    pool.push(seat);
  }
  return pool;
}

function supervisorSeat(state, team) {
  const ids = [team.supervisorSeatId, team.genericSeatId, ...(team.seatIds || [])];
  for (const id of ids) {
    if (!id) continue;
    const seat = (state.seats || []).find((s) => s.id === id && s.kind === "bot");
    if (seat) return seat;
  }
  throw fail(409, "team has no supervisor");
}

/**
 * Resolve who a job wakes.
 * `team:` mail on the bus still wakes only the Supervisor (`teamWakeTarget`).
 * Jobs say which mode to use: supervisor (that same behavior), round_robin, or a named specialist.
 */
export function resolveJobTarget(state, { target, routing, specialist } = {}) {
  const raw = String(target || "").trim();
  if (!raw) throw fail(400, "target required");
  if (raw.startsWith("channel:") || raw.startsWith("#")) throw fail(400, "target must be a seat id or team:<id>");
  const mode = routingMode(routing);

  if (raw.startsWith("team:")) {
    const teamId = raw.slice("team:".length);
    const team = (state.teams || []).find((t) => t.id === teamId);
    if (!team) throw fail(404, "team not found");
    const chosen = mode || "supervisor";
    if (specialist && chosen !== "specialist") throw fail(400, "specialist is only used with routing specialist");

    if (chosen === "supervisor") {
      const seat = supervisorSeat(state, team);
      return { target: raw, assignee: seat.id, teamId, routing: "supervisor", specialist: null };
    }

    if (chosen === "specialist") {
      const seatId = String(specialist || "").trim();
      if (!seatId) throw fail(400, "specialist required");
      const seat = (state.seats || []).find((s) => s.id === seatId);
      const onTeam = (team.seatIds || []).includes(seatId);
      if (!seat || !onTeam || seat.kind !== "bot") throw fail(400, "specialist must be a bot seat on this team");
      if (seat.id === team.supervisorSeatId || seat.seatType === "supervisor") {
        throw fail(400, "that seat is the supervisor; use routing supervisor");
      }
      return { target: raw, assignee: seat.id, teamId, routing: "specialist", specialist: seat.id };
    }

    const pool = workerPool(state, team);
    if (!pool.length) throw fail(409, "team has no workers for round-robin");
    const idx = Number.isInteger(team.jobRrIndex) && team.jobRrIndex >= 0 ? team.jobRrIndex : 0;
    const seat = pool[idx % pool.length];
    team.jobRrIndex = (idx + 1) % pool.length;
    return { target: raw, assignee: seat.id, teamId, routing: "round_robin", specialist: null };
  }

  if (mode) throw fail(400, "routing applies to team targets");
  if (specialist) throw fail(400, "specialist applies to team targets");
  const seat = (state.seats || []).find((s) => s.id === raw);
  if (!seat) throw fail(404, "seat not found");
  return { target: raw, assignee: seat.id, teamId: seat.team || null, routing: null, specialist: null };
}

export function jobWakeText(job) {
  const files = (job.fileRefs || []).map((f) => f.path).filter(Boolean);
  return [
    `Job ${job.id} for ${job.target}${job.routing ? ` (${job.routing}${job.specialist ? ` ${job.specialist}` : ""})` : ""}.`,
    job.brief,
    files.length ? `File refs (paths only): ${files.join(", ")}` : "",
    (job.files || []).length ? `Job files: ${(job.files || []).map((f) => f.name).join(", ")}` : "",
    `When you finish, call roster_report with jobId "${job.id}".`,
    `To park for a human, call roster_ask_human with jobId "${job.id}".`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function jobRoomLine(job) {
  const who = job.assignee || job.target;
  const route = job.routing ? `, ${job.routing}` : "";
  const files = (job.fileRefs || []).map((f) => f.name || f.path).filter(Boolean);
  return [`Job ${job.id} ${job.status} → ${who} (${job.target}${route})`, job.brief, files.length ? `Files: ${files.join(", ")}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function jobStatusLine(job) {
  return [`Job ${job.id} ${job.status}`, job.result || ""].filter(Boolean).join("\n");
}

function placeJob(state, body, caller, callbackUrl) {
  const brief = String(body.brief ?? body.text ?? "").trim();
  if (!brief) throw fail(400, "brief required");
  if (brief.length > 20000) throw fail(400, "brief is too long");
  const fileRefs = normalizeFileRefs(body.fileRefs ?? body.files);
  const budget = normalizeBudget(body.budget);
  const priority = normalizePriority(body.priority);
  const channel = normalizeChannel(state, body.channel);
  const runId = normalizeRunId(body.runId);
  const route = resolveJobTarget(state, body);
  const at = nowIso();
  const job = {
    id: uid("job"),
    caller: normalizeCaller(caller),
    ...route,
    brief,
    fileRefs,
    status: "queued",
    result: null,
    cost: null,
    tokens: null,
    budget,
    priority,
    runId,
    channel,
    callbackUrl,
    wake: null,
    callback: null,
    reportedBy: null,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    finishedAt: null,
    events: [],
  };
  pushEvent(job, "submitted");
  state.jobs = [...(state.jobs || []), job];
  return publicJob(job);
}

export async function createJob(state, body = {}, caller = {}) {
  const callbackUrl = callbackUrlSyntax(body.callbackUrl);
  return placeJob(state, body, caller, callbackUrl);
}

function summarizeWake(wake) {
  if (!wake || typeof wake !== "object") return null;
  const out = {};
  for (const key of ["sessionId", "seat", "offline", "paused", "human", "error", "reason", "harness"]) {
    if (wake[key] !== undefined) out[key] = key === "error" ? String(wake[key]).slice(0, 500) : wake[key];
  }
  return out;
}

export function applyWake(state, id, wake) {
  const job = requireJob(state, id);
  job.wake = summarizeWake(wake);
  job.updatedAt = nowIso();
  if (TERMINAL.has(job.status)) return publicJob(job);
  if (wake?.sessionId) {
    job.status = "running";
    job.startedAt = job.startedAt || job.updatedAt;
    pushEvent(job, "running");
  } else if (wake?.human) {
    job.status = "needs_human";
    pushEvent(job, "needs_human", { reason: "target is a human seat" });
  } else if (wake?.paused) {
    pushEvent(job, "wake_blocked", { reason: wake.reason || "paused" });
  } else if (wake?.offline) {
    pushEvent(job, "wake_offline");
  } else if (wake?.error) {
    pushEvent(job, "wake_error", { error: String(wake.error).slice(0, 500) });
  }
  return publicJob(job);
}

function normalizeReportStatus(raw) {
  const status = String(raw || "done").trim();
  if (!["done", "failed", "needs_human"].includes(status)) throw fail(400, "status must be done, failed, or needs_human");
  return status;
}

export function reportJob(state, id, body = {}, caller = {}) {
  const job = requireJob(state, id);
  if (!canReadJob(job, caller)) throw fail(404, "job not found");
  if (!canCompleteJob(job, caller)) throw fail(403, "this caller cannot complete that job");
  if (TERMINAL.has(job.status)) throw fail(409, `job is ${job.status}`);
  const status = normalizeReportStatus(body.status);
  const result = String(body.result ?? body.text ?? "").trim();
  if (!result) throw fail(400, "result required");
  if (result.length > 100000) throw fail(400, "result is too long");
  job.status = status;
  job.result = result;
  if (body.cost != null && body.cost !== "") job.cost = normalizeNumber(body.cost, "cost");
  if (body.tokens != null && body.tokens !== "") job.tokens = normalizeTokens(body.tokens);
  job.reportedBy = body.from || caller.seatId || null;
  job.updatedAt = nowIso();
  if (TERMINAL.has(status)) job.finishedAt = job.updatedAt;
  else job.finishedAt = null;
  pushEvent(job, status);
  return publicJob(job);
}

export function cancelJob(state, id, body = {}, caller = {}) {
  const job = requireJob(state, id);
  if (!canReadJob(job, caller)) throw fail(404, "job not found");
  if (!canCancelJob(job, caller)) throw fail(403, "this caller cannot cancel that job");
  if (TERMINAL.has(job.status)) throw fail(409, `job is ${job.status}`);
  if (!OPEN.has(job.status)) throw fail(409, `job is ${job.status}`);
  const reason = String(body.reason ?? body.result ?? "").trim();
  job.status = "cancelled";
  if (reason) job.result = reason.slice(0, 100000);
  job.reportedBy = caller.seatId || null;
  job.updatedAt = nowIso();
  job.finishedAt = job.updatedAt;
  pushEvent(job, "cancelled");
  return publicJob(job);
}

export function isWaitSatisfied(job, { since } = {}) {
  if (!job) return false;
  if (since) return new Date(job.updatedAt).getTime() > new Date(since).getTime();
  return job.status === "needs_human" || TERMINAL.has(job.status);
}

export function parseTimeout(raw, fallback = 25000) {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 60000) throw fail(400, "timeout must be an integer from 0 to 60000");
  return n;
}

export function parseSince(raw) {
  if (raw == null || raw === "") return null;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) throw fail(400, "since must be an ISO timestamp");
  return new Date(t).toISOString();
}

export function recordCallback(state, id, attempt) {
  const job = requireJob(state, id);
  job.callback = {
    at: attempt.at || nowIso(),
    ok: Boolean(attempt.ok),
    status: attempt.status ?? null,
    error: attempt.error || null,
  };
  job.updatedAt = nowIso();
  pushEvent(job, "callback", { ok: job.callback.ok, status: job.callback.status });
  return publicJob(job);
}

export function shouldCallback(job) {
  return Boolean(job?.callbackUrl) && (job.status === "needs_human" || TERMINAL.has(job.status));
}

export const CALLBACK_HEADERS = Object.freeze({
  signature: "x-roster-signature",
  timestamp: "x-roster-timestamp",
  jobId: "x-roster-job-id",
});

export function assertCallbackSecret(env = process.env) {
  const value = String(env?.ROSTER_CALLBACK_SECRET || "").trim();
  if (!value) return "";
  if (Buffer.byteLength(value) < CALLBACK_SECRET_MIN_BYTES) {
    const err = new Error(`ROSTER_CALLBACK_SECRET must be at least ${CALLBACK_SECRET_MIN_BYTES} bytes`);
    err.status = 500;
    throw err;
  }
  return value;
}

function envCallbackSecret(env) {
  return assertCallbackSecret(env);
}

export function callbackGraceMs(env = process.env) {
  const raw = env?.ROSTER_CALLBACK_GRACE_MS;
  if (raw == null || String(raw).trim() === "") return DEFAULT_CALLBACK_GRACE_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return n > 0 ? MAX_CALLBACK_GRACE_MS : DEFAULT_CALLBACK_GRACE_MS;
  return Math.min(MAX_CALLBACK_GRACE_MS, Math.max(0, n));
}

function previousStillValid(prev, now) {
  return Boolean(prev?.value && prev.until && new Date(prev.until).getTime() > now);
}

function activePrevious(state, now) {
  const prev = state.callbackSecret?.previous;
  if (!prev) return null;
  if (!previousStillValid(prev, now)) {
    delete state.callbackSecret.previous;
    return null;
  }
  return { secret: prev.value, until: prev.until };
}

/** One signing secret per instance. `ROSTER_CALLBACK_SECRET` overrides the stored one and disables rotate. */
export function ensureCallbackSecret(state, env = process.env, now = Date.now()) {
  const fromEnv = envCallbackSecret(env);
  if (fromEnv) return fromEnv;
  if (!state.callbackSecret?.value) {
    state.callbackSecret = { value: `rfcb_${randomBytes(32).toString("hex")}`, createdAt: new Date(now).toISOString() };
  } else {
    activePrevious(state, now);
  }
  return state.callbackSecret.value;
}

export function callbackSecretInfo(state, env = process.env, now = Date.now()) {
  const secret = ensureCallbackSecret(state, env, now);
  const fromEnv = Boolean(envCallbackSecret(env));
  return {
    secret,
    source: fromEnv ? "env" : "state",
    createdAt: fromEnv ? null : state.callbackSecret.createdAt,
    previous: fromEnv ? null : activePrevious(state, now),
    algorithm: "HMAC-SHA256",
    headers: { ...CALLBACK_HEADERS },
    signingString: "<timestamp>.<jobId>.<body>",
  };
}

export function rotateCallbackSecret(state, env = process.env, now = Date.now()) {
  if (envCallbackSecret(env)) throw fail(409, "callback secret is set by ROSTER_CALLBACK_SECRET");
  const current = state.callbackSecret?.value || null;
  const grace = callbackGraceMs(env);
  const previous = current && grace > 0 ? { value: current, until: new Date(now + grace).toISOString() } : undefined;
  state.callbackSecret = {
    value: `rfcb_${randomBytes(32).toString("hex")}`,
    createdAt: new Date(now).toISOString(),
    ...(previous ? { previous } : {}),
  };
  return callbackSecretInfo(state, env, now);
}

/** `v1=` + hex HMAC-SHA256 of `<timestamp>.<jobId>.<body>`, body being the exact bytes sent. */
export function signCallback(secret, timestamp, jobId, body) {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${jobId}.${body}`).digest("hex")}`;
}

function signatureMatches(secret, timestamp, jobId, body, got) {
  if (!secret) return false;
  const want = Buffer.from(signCallback(secret, timestamp, jobId, String(body)));
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Receiver-side check. `headers` uses lower-case keys, as Node's `req.headers` does.
 * `previous` is `{ secret, until }` from the callback-secret response. It is accepted
 * only while `until` is still in the future.
 */
export function verifyCallback(secret, headers, body, { toleranceSec = 300, now = Date.now(), previous } = {}) {
  const timestamp = String(headers?.[CALLBACK_HEADERS.timestamp] || "");
  const jobId = String(headers?.[CALLBACK_HEADERS.jobId] || "");
  const got = Buffer.from(String(headers?.[CALLBACK_HEADERS.signature] || ""));
  if (!/^\d+$/.test(timestamp) || !jobId) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSec) return false;
  const secrets = [secret];
  if (previous?.secret && previous.until && new Date(previous.until).getTime() > now) secrets.push(previous.secret);
  if (!secrets.some((candidate) => signatureMatches(candidate, timestamp, jobId, body, got))) return false;
  try {
    return JSON.parse(String(body))?.job?.id === jobId;
  } catch {
    return false;
  }
}

/** A `lookup` for net/tls that only ever answers with addresses already checked. */
export function pinnedLookup(addresses) {
  return (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const family = options?.family === 4 || options?.family === 6 ? options.family : 0;
    const list = family ? addresses.filter((a) => a.family === family) : addresses;
    if (!list.length) {
      const err = new Error(`no checked address for ${hostname}`);
      err.code = "ENOTFOUND";
      process.nextTick(callback, err);
      return;
    }
    if (options?.all) {
      process.nextTick(callback, null, list.map((a) => ({ address: a.address, family: a.family })));
      return;
    }
    process.nextTick(callback, null, list[0].address, list[0].family);
  };
}

/** Connects to a checked address. Host header and TLS SNI stay the original hostname. */
export function postPinned(target, { headers, body, timeoutMs }) {
  const secure = target.url.protocol === "https:";
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request({
      method: "POST",
      host: target.host,
      port: target.port,
      path: `${target.url.pathname}${target.url.search}`,
      headers: { ...headers, host: target.url.host, "content-length": Buffer.byteLength(body) },
      lookup: pinnedLookup(target.addresses),
      agent: false,
      ...(secure && !isIP(target.host) ? { servername: target.host } : {}),
    });
    const timer = setTimeout(() => req.destroy(new Error("callback timed out")), timeoutMs);
    req.on("response", (res) => {
      clearTimeout(timer);
      resolve({ status: res.statusCode });
      res.destroy();
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end(body);
  });
}

/**
 * POST the signed job snapshot. The host is resolved and checked in this call,
 * and the connection goes only to those addresses, so a DNS answer that changes
 * between check and connect cannot redirect it. Redirects are not followed.
 * Failures are recorded; they do not fail the status change.
 */
export async function deliverCallback(job, { secret, timeoutMs = 5000, now = Date.now, timestamp: timestampOpt, ...opts } = {}) {
  if (!job?.callbackUrl) return { skipped: true };
  const failed = (err, status = null) => ({ ok: false, status, error: String(err?.message || err).slice(0, 300), at: nowIso() });
  if (!secret) return failed("callback signing secret is not configured");
  let target;
  try {
    target = await resolveCallback(job.callbackUrl, opts);
  } catch (err) {
    return failed(err);
  }
  const body = JSON.stringify({ event: "job.status", job: publicJob(job) });
  const timestamp = timestampOpt || String(Math.floor(now() / 1000));
  try {
    const res = await postPinned(target, {
      body,
      timeoutMs,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        [CALLBACK_HEADERS.timestamp]: timestamp,
        [CALLBACK_HEADERS.jobId]: job.id,
        [CALLBACK_HEADERS.signature]: signCallback(secret, timestamp, job.id, body),
      },
    });
    if (res.status >= 300 && res.status < 400) return failed("callback redirect blocked", res.status);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, at: nowIso() };
  } catch (err) {
    return failed(err);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function callbackRetryable(attempt) {
  if (!attempt || attempt.ok || attempt.skipped) return false;
  if (typeof attempt.status === "number" && attempt.status < 500) return false;
  return !/blocked|credentials|redirect|signing secret|must be an http|too long/.test(String(attempt.error || ""));
}

const pendingCallbacks = new Set();
const CALLBACK_DELIVERY_CONCURRENCY = 2;
let callbackInFlight = 0;
const callbackSlotWaiters = [];

function takeCallbackSlot() {
  if (callbackInFlight < CALLBACK_DELIVERY_CONCURRENCY) {
    callbackInFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    callbackSlotWaiters.push(resolve);
  });
}

function releaseCallbackSlot() {
  const next = callbackSlotWaiters.shift();
  if (next) {
    next();
    return;
  }
  callbackInFlight -= 1;
}

/** Tests wait for background delivery. Submit and complete do not. */
export function flushCallbacks() {
  return Promise.allSettled([...pendingCallbacks]);
}

/**
 * POST the callback without blocking the caller. Retries reuse the same
 * timestamp and signature so a receiver can drop duplicates by (jobId, ts, signature).
 */
function scheduleCallback(deps, job, opts = {}) {
  if (!shouldCallback(job)) return;
  const timestamp = String(Math.floor((opts.now ? opts.now() : Date.now()) / 1000));
  const delays = opts.retryDelaysMs || CALLBACK_RETRY_DELAYS_MS;
  const task = (async () => {
    await takeCallbackSlot();
    try {
      let secret;
      let stored = job;
      deps.mutate((s) => {
        secret = ensureCallbackSecret(s, opts.env);
        const live = (s.jobs || []).find((j) => j.id === job.id) || job;
        stored = publicJob(live);
      });
      let attempt = { ok: false, error: "callback was not attempted", at: nowIso() };
      const tries = delays.length + 1;
      for (let i = 0; i < tries; i++) {
        if (i > 0 && delays[i - 1]) await sleep(delays[i - 1]);
        try {
          attempt = await (deps.deliverCallback || deliverCallback)(stored, { ...opts, secret, timestamp });
        } catch (err) {
          attempt = { ok: false, error: String(err?.message || err).slice(0, 300), at: nowIso() };
        }
        if (!callbackRetryable(attempt)) break;
      }
      if (attempt?.skipped) return;
      deps.mutate((s) => {
        recordCallback(s, job.id, attempt);
      });
    } finally {
      releaseCallbackSlot();
    }
  })().catch((err) => {
    console.error("callback delivery", err);
  });
  pendingCallbacks.add(task);
  void task.finally(() => pendingCallbacks.delete(task));
}

function seatLabel(state, seatId, fallback) {
  const seat = (state.seats || []).find((s) => s.id === seatId);
  return seat?.name || fallback || seatId || "job";
}

export async function publishNewJob(body, caller, deps, opts) {
  const callbackUrl = callbackUrlSyntax(body.callbackUrl);
  let created;
  deps.mutate((s) => {
    created = placeJob(s, body, caller, callbackUrl);
  });
  if (typeof deps.attachFiles === "function") {
    deps.mutate((s) => deps.attachFiles(s, created.id));
  }
  const live = deps.getState().jobs.find((j) => j.id === created.id) || created;
  const text = jobWakeText(live);
  const from = live.caller?.seatId || "you";
  deps.postMessage(live.channel, seatLabel(deps.getState(), from, live.caller?.name), "job", jobRoomLine(live), {
    seatId: from,
    jobId: live.id,
    files: live.fileRefs,
  });
  const bus = deps.postBus({
    from,
    to: live.assignee,
    kind: "job",
    text,
    wake: false,
    channel: live.channel,
    runId: live.runId,
    jobId: live.id,
  });
  const wake = await deps.wakeSeat(live.assignee, text, {
    from,
    kind: "job",
    runId: live.runId,
    jobId: live.id,
    channel: live.channel,
    via: String(live.target).startsWith("team:") ? live.target : undefined,
  });
  let job = created;
  deps.mutate((s) => {
    job = applyWake(s, created.id, wake);
  });
  if (job.status === "needs_human") {
    deps.postMessage(job.channel, seatLabel(deps.getState(), job.assignee, job.assignee), "job", jobStatusLine(job), {
      seatId: job.assignee,
      jobId: job.id,
    });
    scheduleCallback(deps, job, opts);
  }
  return { job, bus, wake };
}

async function announce(deps, job, fromId, kind) {
  const from = fromId || job.assignee || "you";
  const text = jobStatusLine(job);
  deps.postMessage(job.channel, seatLabel(deps.getState(), from, from), "job", text, {
    seatId: from,
    jobId: job.id,
  });
  deps.postBus({
    from,
    to: `channel:${job.channel}`,
    kind,
    text,
    wake: false,
    channel: job.channel,
    runId: job.runId,
    jobId: job.id,
  });
}

export async function followUpJob(id, body, caller, deps) {
  const text = String(body?.text || "").trim();
  if (!text) throw fail(400, "text required");
  if (text.length > 20000) throw fail(400, "text is too long");
  let job;
  deps.mutate((s) => {
    const raw = requireJob(s, id);
    if (!canReadJob(raw, caller)) throw fail(404, "job not found");
    if (TERMINAL.has(raw.status)) throw fail(409, "job is finished");
    raw.updatedAt = nowIso();
    pushEvent(raw, "follow_up");
    job = publicJob(raw);
  });
  const from = caller.seatId || "you";
  deps.postMessage(job.channel, seatLabel(deps.getState(), from, caller.name), "job", text, {
    seatId: from,
    jobId: job.id,
  });
  deps.postBus({
    from,
    to: job.assignee,
    kind: "send_message",
    text,
    wake: false,
    channel: job.channel,
    runId: job.runId,
    jobId: job.id,
  });
  await deps.wakeSeat(job.assignee, text, {
    from,
    kind: "send_message",
    runId: job.runId,
    jobId: job.id,
    channel: job.channel,
  });
  return job;
}

export async function settleJob(id, action, body, caller, deps, opts) {
  let job;
  deps.mutate((s) => {
    job = action === "cancel" ? cancelJob(s, id, body, caller) : reportJob(s, id, body, caller);
  });
  if (body?.announce !== false) {
    const from = body?.from || caller.seatId || job.assignee;
    const kind = job.status === "needs_human" ? "ask_human" : job.status === "cancelled" ? "job_cancelled" : "job_complete";
    announce(deps, job, from, kind);
  }
  scheduleCallback(deps, job, opts);
  return job;
}

export async function waitForJob(id, query, deps, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const timeout = parseTimeout(query.timeout);
  const since = parseSince(query.since);
  const deadline = Date.now() + timeout;
  for (;;) {
    const job = getJob(deps.getState(), id);
    if (!job) return null;
    const ready = isWaitSatisfied(job, { since });
    if (ready || Date.now() >= deadline) return { job, timedOut: !ready };
    await sleep(200);
  }
}
