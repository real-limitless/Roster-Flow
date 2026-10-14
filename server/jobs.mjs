/**
 * Persistent jobs (issue #69, milestone M2).
 *
 * A job is a unit of work a caller hands to a seat or a team. Submit wakes the
 * resolved seat through the existing bus and posts the brief into the room.
 * File bytes and budgets are not handled here: `fileRefs` is a list of paths
 * for a later file store, and `budget` is stored and not enforced.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { uid } from "./store.mjs";

export const JOB_STATUSES = ["queued", "running", "needs_human", "done", "failed", "cancelled"];
export const TERMINAL_STATUSES = ["done", "failed", "cancelled"];
export const ROUTING_MODES = ["supervisor", "round_robin", "specialist"];
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
    status: job.status,
    result: job.result,
    cost: job.cost,
    tokens: job.tokens ? { ...job.tokens } : null,
    budget: job.budget ? { ...job.budget } : null,
    runId: job.runId,
    channel: job.channel,
    callbackUrl: job.callbackUrl,
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

function ipv4Parts(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function ipv4Blocked(ip) {
  const p = ipv4Parts(ip);
  if (!p) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function ipv6Bytes(ip) {
  const raw = String(ip).toLowerCase().split("%")[0];
  if (!raw.includes(":")) return null;
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const parse = (side) => (side ? side.split(":").map((h) => Number.parseInt(h, 16)) : []);
  const left = parse(halves[0]);
  const right = halves.length === 2 ? parse(halves[1]) : [];
  if ([...left, ...right].some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
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

function ipv6Blocked(ip) {
  const bytes = ipv6Bytes(ip);
  if (!bytes) return true;
  const mapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) return ipv4Blocked(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  if (bytes.every((b) => b === 0)) return true;
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  return false;
}

export function callbackAddressBlocked(address) {
  const family = isIP(address);
  if (family === 4) return ipv4Blocked(address);
  if (family === 6) return ipv6Blocked(address);
  const dotted = String(address).match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return ipv4Blocked(dotted[1]);
  return true;
}

function decimalIPv4(host) {
  if (!/^\d+$/.test(host)) return null;
  const n = Number(host);
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function callbackAllowlist(env) {
  return String(env?.ROSTER_CALLBACK_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
}

async function callbackAddresses(hostname, lookupImpl) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw fail(400, "callbackUrl host is required");
  if (isIP(host)) return [host];
  const legacy = decimalIPv4(host);
  if (legacy) return [legacy];
  let rows;
  try {
    rows = await (lookupImpl || lookup)(host, { all: true, verbatim: true });
  } catch {
    throw fail(400, "callbackUrl host did not resolve");
  }
  const list = Array.isArray(rows) ? rows : [rows];
  const addresses = list.map((row) => (typeof row === "string" ? row : row?.address)).filter(Boolean);
  if (!addresses.length) throw fail(400, "callbackUrl host did not resolve");
  return addresses;
}

/**
 * http(s) only. After DNS, reject loopback, private, link-local, and metadata
 * addresses. `ROSTER_CALLBACK_ALLOWLIST` (comma-separated hosts) opts a host in.
 */
export async function normalizeCallback(raw, { env = process.env, lookup: lookupImpl = lookup } = {}) {
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
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw fail(400, "callbackUrl host is required");
  if (callbackAllowlist(env).includes(host)) return url.toString();
  const addresses = await callbackAddresses(host, lookupImpl);
  if (addresses.some((address) => callbackAddressBlocked(address))) {
    throw fail(400, "callbackUrl resolves to a blocked address");
  }
  return url.toString();
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
    files.length ? `File refs (stored only, not fetched): ${files.join(", ")}` : "",
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

export async function createJob(state, body = {}, caller = {}, opts) {
  const callbackUrl = await normalizeCallback(body.callbackUrl, opts);
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

/** POST the job snapshot. Failures are recorded; they do not fail the status change. */
export async function deliverCallback(job, fetchImpl = globalThis.fetch, opts) {
  if (!job?.callbackUrl) return { skipped: true };
  try {
    await normalizeCallback(job.callbackUrl, opts);
  } catch (err) {
    return { ok: false, status: null, error: String(err?.message || err).slice(0, 300), at: nowIso() };
  }
  try {
    const res = await fetchImpl(job.callbackUrl, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ event: "job.status", job: publicJob(job) }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, status: res.status, error: "callback redirect blocked", at: nowIso() };
    }
    return { ok: res.ok, status: res.status, at: nowIso() };
  } catch (err) {
    return { ok: false, status: null, error: String(err?.message || err).slice(0, 300), at: nowIso() };
  }
}

function seatLabel(state, seatId, fallback) {
  const seat = (state.seats || []).find((s) => s.id === seatId);
  return seat?.name || fallback || seatId || "job";
}

export async function publishNewJob(body, caller, deps, opts) {
  const callbackUrl = await normalizeCallback(body.callbackUrl, opts);
  let created;
  deps.mutate((s) => {
    created = placeJob(s, body, caller, callbackUrl);
  });
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

export async function settleJob(id, action, body, caller, deps) {
  let job;
  deps.mutate((s) => {
    job = action === "cancel" ? cancelJob(s, id, body, caller) : reportJob(s, id, body, caller);
  });
  if (body?.announce !== false) {
    const from = body?.from || caller.seatId || job.assignee;
    const kind = job.status === "needs_human" ? "ask_human" : job.status === "cancelled" ? "job_cancelled" : "job_complete";
    announce(deps, job, from, kind);
  }
  if (shouldCallback(job)) {
    const attempt = await (deps.deliverCallback || deliverCallback)(job);
    if (!attempt?.skipped) {
      deps.mutate((s) => {
        job = recordCallback(s, id, attempt);
      });
    }
  }
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
