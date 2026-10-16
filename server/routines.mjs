import { slugify } from "./seed.mjs";

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function nid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function looksLikeDeploy(text, impliesDeploy = false) {
  if (impliesDeploy) return true;
  return /\bdeploy(ing|ment)?\b|\bto prod(?:uction)?\b|\bproduction deploy\b/i.test(String(text || ""));
}

export function deployDenied(seat, { prompt, impliesDeploy } = {}) {
  if (!seat) return false;
  if (!(seat.deny || []).includes("deploy")) return false;
  return looksLikeDeploy(prompt, impliesDeploy);
}

export function createRoutine(state, body = {}) {
  const title = String(body.title || "").trim();
  const seatId = String(body.seatId || "").trim();
  if (!title) fail(400, "title required");
  if (!seatId) fail(400, "seatId required");
  const seat = (state.seats || []).find((s) => s.id === seatId);
  if (!seat) fail(404, "seat not found");
  const prompt = String(body.prompt || "");
  const impliesDeploy = Boolean(body.impliesDeploy);
  if (deployDenied(seat, { prompt, impliesDeploy })) fail(400, "routine implies deploy and seat denies deploy");
  const rec = {
    id: slugify(body.id || title) || nid("rtn"),
    seatId,
    title,
    intervalMinutes: Math.max(1, Number(body.intervalMinutes) || 60),
    cron: body.cron ? String(body.cron) : undefined,
    timezone: body.timezone ? String(body.timezone) : "UTC",
    webhookSecret: body.webhookSecret ? String(body.webhookSecret) : undefined,
    prompt,
    skillId: body.skillId || undefined,
    enabled: body.enabled !== false,
    impliesDeploy,
    lastRunAt: null,
    lastError: null,
    activeRunId: null,
  };
  if ((state.routines || []).some((r) => r.id === rec.id)) fail(409, "routine exists");
  state.routines = [...(state.routines || []), rec];
  return rec;
}

export function patchRoutine(state, id, body = {}) {
  const rec = (state.routines || []).find((r) => r.id === id);
  if (!rec) return null;
  if (body.title !== undefined) rec.title = String(body.title);
  if (body.prompt !== undefined) rec.prompt = String(body.prompt);
  if (body.intervalMinutes !== undefined) rec.intervalMinutes = Math.max(1, Number(body.intervalMinutes) || rec.intervalMinutes);
  if (body.cron !== undefined) rec.cron = body.cron ? String(body.cron) : undefined;
  if (body.timezone !== undefined) rec.timezone = String(body.timezone);
  if (body.webhookSecret !== undefined) rec.webhookSecret = body.webhookSecret ? String(body.webhookSecret) : undefined;
  if (body.skillId !== undefined) rec.skillId = body.skillId || undefined;
  if (body.enabled !== undefined) rec.enabled = Boolean(body.enabled);
  if (body.impliesDeploy !== undefined) rec.impliesDeploy = Boolean(body.impliesDeploy);
  if (body.seatId !== undefined) rec.seatId = String(body.seatId);
  const seat = (state.seats || []).find((s) => s.id === rec.seatId);
  if (seat && deployDenied(seat, rec)) fail(400, "routine implies deploy and seat denies deploy");
  return rec;
}

function sameMinute(isoOrMs, now) {
  const t = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(t)) return false;
  return Math.floor(t / 60000) === Math.floor(now / 60000);
}

export function hasWakeThisMinute(state, seatId, now) {
  const seat = (state.seats || []).find((s) => s.id === seatId);
  return (state.bus || []).some((e) => {
    const to = String(e.to || "");
    const hits = to === seatId || (seat?.team && to === `team:${seat.team}`);
    if (!hits) return false;
    return sameMinute(e.time, now);
  });
}

function intervalElapsed(rec, now) {
  if (!rec.lastRunAt) return true;
  const last = Date.parse(rec.lastRunAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= rec.intervalMinutes * 60 * 1000;
}

function skipReason(state, rec, now, { force = false } = {}) {
  if (!rec.enabled && !force) return "disabled";
  const seat = (state.seats || []).find((s) => s.id === rec.seatId);
  if (!seat) return "seat not found";
  if (seat.status === "paused") return "paused";
  if (deployDenied(seat, rec)) return "deploy denied";
  if (rec.activeRunId) return "overlap";
  if (!force && !intervalElapsed(rec, now)) return "interval";
  return null;
}

function recordRun(state, rec, now, coalesced) {
  const runId = nid("rr");
  const iso = new Date(now).toISOString();
  rec.lastRunAt = iso;
  rec.lastError = null;
  rec.activeRunId = coalesced ? null : runId;
  state.routineRuns = [
    ...(state.routineRuns || []),
    { id: runId, routineId: rec.id, seatId: rec.seatId, at: iso, coalesced: Boolean(coalesced) },
  ];
  return { id: rec.id, seatId: rec.seatId, prompt: rec.prompt, runId, coalesced: Boolean(coalesced) };
}

export function tickRoutines(state, now) {
  const due = [];
  for (const rec of state.routines || []) {
    const skip = skipReason(state, rec, now);
    if (skip === "paused" || skip === "deploy denied") {
      rec.lastError = skip;
      continue;
    }
    if (skip) continue;
    due.push(recordRun(state, rec, now, hasWakeThisMinute(state, rec.seatId, now)));
  }
  return due;
}

export function runRoutineNow(state, id, now = Date.now()) {
  const rec = (state.routines || []).find((r) => r.id === id);
  if (!rec) fail(404, "routine not found");
  const skip = skipReason(state, rec, now, { force: true });
  if (skip === "paused") fail(409, "seat is paused");
  if (skip === "deploy denied") fail(400, "routine implies deploy and seat denies deploy");
  if (skip === "overlap") fail(409, "routine already running");
  return { routine: rec, ...recordRun(state, rec, now, false) };
}

export function clearRoutineActive(state, runId) {
  for (const rec of state.routines || []) {
    if (rec.activeRunId === runId) rec.activeRunId = null;
  }
}

export function publicRoutine(rec) {
  if (!rec) return rec;
  const { webhookSecret, ...rest } = rec;
  return { ...rest, hasWebhookSecret: Boolean(webhookSecret) };
}
