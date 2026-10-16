import { getState, mutate, uid } from "./store.mjs";
import { blockLatestRun, postBus, wakeSeat, pullAssistant, pullFailure } from "./bus.mjs";
import { parseMentions, CONDUCTOR_ID } from "./mentions.mjs";
import { resolveMembers, responderCandidates, roomLimits } from "./channels.mjs";
import { normalizeRespond } from "./room-config.mjs";
import { isOpenCodeAdapter } from "./adapters.mjs";
import { seatOverBudget } from "./budget.mjs";
import { teamWakeTarget } from "./teams.mjs";
import {
  ensure,
  status as harnessStatus,
  sessionTranscript,
  harnessKindForSeat,
  loadedModels,
  knownLoadedModels,
} from "./harness.mjs";
import { emit } from "./trace.mjs";
import { cleanupRoomSessions } from "./room-sessions.mjs";
import { noteBotWake, planBotMentions, resetThreads, startThread, threadStats } from "./threads.mjs";
import { firstConnectedModel, isUsable, keyStatusForModel } from "./providers.mjs";

const followingSeats = new Map();
/** `${seat}|${room}` → the thread of that seat's latest wake in the room. */
const seatThreads = new Map();
let syncTimer = null;

export const deps = {
  wakeSeat,
  pullAssistant,
  pullFailure,
  ensure,
  harnessStatus,
  loadedModels,
  knownLoadedModels,
  followTicks: 40,
  followDelayMs: 1500,
  keyStatus: keyStatusForModel,
  fallbackModel: firstConnectedModel,
};

function clock() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function postMessage(channel, who, kind, text, extra = {}) {
  const msg = { id: uid("msg"), channel, who, kind, text, time: clock(), ...extra };
  if (!msg.seatId) {
    const s = getState().seats.find((x) => x.name === who || x.id === who);
    msg.seatId = s?.id;
  }
  mutate((s) => {
    s.messages = [...s.messages, msg];
  });
  return msg;
}

export function rememberSessionRoom(seatId, channelId) {
  if (!seatId || !channelId) return;
  mutate((s) => {
    s.sessionRooms = { ...(s.sessionRooms || {}), [seatId]: channelId };
  });
}

function roomRecord(state, id) {
  return (state.channels || []).find((c) => c.id === id) || null;
}

function responderTargets(room, state, firstId = null) {
  const mode = normalizeRespond(room.respond);
  if (mode === "quiet") return [];
  if (mode === "conductor") return [{ to: CONDUCTOR_ID, reason: "implicit", candidates: [CONDUCTOR_ID] }];
  let candidates = responderCandidates(room, state);
  if (firstId && !room.leadSeatId) candidates = [firstId, ...candidates.filter((c) => c !== firstId)];
  return [{ to: candidates[0], reason: "implicit", candidates }];
}

export function implicitTargets(channelId, state = getState()) {
  const id = String(channelId || "");
  const room = roomRecord(state, id);
  if (id.startsWith("team-")) {
    if (room) return responderTargets(room, state);
    return [{ to: `team:${id.slice("team-".length)}`, reason: "team-room" }];
  }
  if (id.startsWith("project-")) {
    const projectId = id.slice("project-".length);
    const project = (state.projects || []).find((p) => p.id === projectId);
    const pm = project?.pmSeatId && (state.seats || []).find((s) => s.id === project.pmSeatId);
    if (room) return responderTargets(room, state, pm?.kind === "bot" ? pm.id : null);
    if (pm?.kind === "bot") return [{ to: pm.id, reason: "project-pm" }];
    return [{ to: CONDUCTOR_ID, reason: "project-channel" }];
  }
  if (id.startsWith("dm-")) {
    const seatId = id.slice("dm-".length);
    const seat = (state.seats || []).find((s) => s.id === seatId);
    if (seat?.kind === "bot") return [{ to: seatId, reason: "dm" }];
    return [];
  }
  if (id.startsWith("session-")) return [];
  return responderTargets(room || { id, seatIds: [], teamIds: [] }, state);
}

/** True when the room is quiet, so un-mentioned posts only notify the humans in it. */
export function quietRoom(channelId, state = getState()) {
  const id = String(channelId || "");
  if (id.startsWith("dm-") || id.startsWith("session-")) return false;
  const room = roomRecord(state, id);
  return Boolean(room) && normalizeRespond(room.respond) === "quiet";
}

export function collectWakeTargets(channelId, text, state = getState()) {
  const mentions = parseMentions(text, state);
  const targets = [];
  const seen = new Set();
  const notify = [];

  function add(to, reason, extra = {}) {
    if (!to || seen.has(to)) return;
    seen.add(to);
    targets.push({ to, reason, ...extra });
  }

  const wantChannel = mentions.some((m) => m.kind === "channel");
  const room = (state.channels || []).find((c) => c.id === channelId);
  if (wantChannel) {
    const members = resolveMembers(room || { id: channelId, seatIds: [], teamIds: [] }, state);
    for (const seat of members) notify.push(seat.id);
    add(CONDUCTOR_ID, "mention-channel");
  }

  for (const m of mentions) {
    if (m.kind === "team") add(`team:${m.id}`, "mention-team");
    if (m.kind === "seat") {
      const seat = (state.seats || []).find((s) => s.id === m.id);
      if (seat?.kind === "bot") add(m.id, "mention-seat");
      else if (seat) notify.push(seat.id);
    }
  }

  if (!targets.length) {
    for (const { to, reason, ...extra } of implicitTargets(channelId, state)) add(to, reason, extra);
  }

  return { mentions, targets, notify };
}

function statusMessage(channelId, text) {
  const last = (getState().messages || []).filter((m) => m.channel === channelId && m.system).slice(-1)[0];
  if (last?.text === text) return last;
  return postMessage(channelId, "System", "bot", text, { system: true });
}

/** `loaded` is the serve's live model list (see harness.loadedModels); null when unknown. */
export function providerHint(seat, loaded = null) {
  const st = deps.keyStatus(seat?.model, loaded);
  const name = seat?.name || "This seat";
  const model = seat?.model || "the assigned model";
  if (isUsable(st)) return null;
  if (!st.providerID) return `${name} has no provider for ${model}. Add one in Settings.`;
  if (!st.configured) {
    return `${name} uses ${model}, but ${st.providerID} is not in Settings. Add that provider and an API key, then send again.`;
  }
  if (!st.connected) {
    return `No API key for ${st.providerID}. ${name} cannot call ${st.modelID || model}. Add the key in Settings, then send again.`;
  }
  const have = (st.loadedProviders || []).join(", ") || "none";
  if (st.providerLoaded === false || st.loaded === false) {
    return `${model} is not loaded by the harness (loaded: ${have}).`;
  }
  return `${name} cannot use ${model}. Check Settings → Providers, then send again.`;
}

export function seatModelPlan(seat, loaded = null) {
  const assigned = String(seat?.model || "").trim();
  const st = deps.keyStatus(assigned, loaded);
  if (assigned) {
    if (isUsable(st)) return { ok: true, model: assigned, hint: null, fallback: false };
    return { ok: false, model: assigned, hint: providerHint(seat, loaded), fallback: false };
  }
  const fb = deps.fallbackModel?.(loaded);
  if (fb?.providerID && fb?.modelID) {
    const ref = `${fb.providerID}/${fb.modelID}`;
    const name = seat?.name || "This seat";
    return {
      ok: true,
      model: ref,
      fallback: true,
      hint: `${name} has no model assigned. Using ${ref}.`,
    };
  }
  return { ok: false, model: "", hint: providerHint(seat, loaded), fallback: false };
}

function looksLikeWakePrompt(text) {
  const t = String(text || "");
  return /You are .+ on the Roster-flow org chart/.test(t) || t.includes("Propose ONE OrgPlan");
}

function resolvedSeatId(to, state = getState()) {
  if (String(to).startsWith("team:")) return teamWakeTarget(to, state.teams || []) || to;
  return to;
}

async function ensureForTarget(to, channelId) {
  const state = getState();
  const seatId = resolvedSeatId(to, state);
  const seat = (state.seats || []).find((s) => s.id === seatId);
  const kind = seat ? harnessKindForSeat(seat) : String(to).startsWith("team:") ? "company" : "system";
  const current = deps.harnessStatus(kind);
  if (current.harness !== "up") {
    const already = (getState().messages || []).some(
      (m) => m.channel === channelId && m.system && m.text === `Starting ${kind} harness…`,
    );
    if (!already) statusMessage(channelId, `Starting ${kind} harness…`);
  }
  emit({ scope: "chat", step: "harness.ensure", channel: channelId, seat: seatId, detail: { kind } });
  try {
    await deps.ensure({ kind });
    return { ok: true, kind, seat };
  } catch (err) {
    const error = String(err.message || err);
    statusMessage(channelId, `Harness offline: ${error}`);
    emit({
      level: "error",
      scope: "chat",
      step: "harness.error",
      channel: channelId,
      seat: seatId,
      detail: { kind, error },
    });
    return { ok: false, kind, seat, error };
  }
}

function seatOf(id, state = getState()) {
  return (state.seats || []).find((s) => s.id === id) || null;
}

/** Null when the seat can take a wake now, else a short reason. */
export function responderSkipReason(seat, state = getState()) {
  if (!seat) return "not on the chart";
  if (seat.status === "paused") return seat.pauseReason === "budget" ? "paused (budget)" : "paused";
  if (seatOverBudget(seat)) return "over its token budget";
  if (!isOpenCodeAdapter(seat)) return null;
  const plan = seatModelPlan(seat, deps.knownLoadedModels?.(harnessKindForSeat(seat)) ?? null);
  return plan.ok ? null : plan.hint || `${seat.model || "no model"} is not usable`;
}

/** Put the first awake candidate first. When nobody is awake the order is kept so the first seat reports why. */
export function pickResponder(candidates, state = getState()) {
  const skipped = [];
  for (const id of candidates) {
    const why = responderSkipReason(seatOf(id, state), state);
    if (!why) return { order: [id, ...candidates.filter((c) => c !== id)], skipped };
    skipped.push({ seat: id, why });
  }
  return { order: [...candidates], skipped: [] };
}

function skipLine(skipped, state = getState()) {
  return skipped.map((s) => `${seatOf(s.seat, state)?.name || s.seat} (${s.why.replace(/\.$/, "")})`).join("; ");
}

async function wakeTarget(channelId, text, from, target) {
  const state = getState();
  const seatId = resolvedSeatId(target.to, state);
  const direct = seatOf(seatId, state);
  if (String(channelId).startsWith("dm-")) rememberSessionRoom(seatId, channelId);
  const meta = { from, kind: target.reason, channel: channelId, announce: false, ...(target.meta || {}) };
  if (meta.thread) seatThreads.set(`${seatId}|${channelId}`, meta.thread);
  if (direct && direct.kind === "bot" && !direct.mcpGuest && !isOpenCodeAdapter(direct)) {
    emit({ scope: "chat", step: "seat.wake", channel: channelId, seat: seatId, detail: { reason: target.reason, adapter: direct.adapter } });
    return deps.wakeSeat(target.to, text, { ...meta, announce: true });
  }
  const ready = await ensureForTarget(target.to, channelId);
  if (!ready.ok) return { offline: true, seat: seatId, harness: ready.kind, error: ready.error, started: false };
  const loaded = await Promise.resolve(deps.loadedModels?.(ready.kind)).catch(() => null);
  const plan = seatModelPlan(ready.seat, loaded ?? null);
  const model = plan.model || ready.seat?.model || "default";
  const wakeLine = `Waking ${ready.seat?.name || seatId} (${model})…`;
  const alreadyWake = (getState().messages || []).some((m) => m.channel === channelId && m.system && m.text === wakeLine);
  if (!alreadyWake) statusMessage(channelId, wakeLine);
  if (plan.hint) {
    statusMessage(channelId, plan.hint);
    emit({
      level: "warn",
      scope: "chat",
      step: plan.ok ? "seat.fallback" : "seat.nokey",
      channel: channelId,
      seat: seatId,
      detail: { model, hint: plan.hint, fallback: plan.fallback },
    });
  }
  if (!plan.ok) {
    const woke = await deps.wakeSeat(target.to, text, meta);
    return {
      ...woke,
      seat: woke?.seat || seatId,
      error: woke?.error || plan.hint,
      nokey: !woke?.started,
      runId: woke?.runId || null,
      started: Boolean(woke?.started),
    };
  }
  emit({
    scope: "chat",
    step: "seat.wake",
    channel: channelId,
    seat: seatId,
    detail: { reason: target.reason, model, harness: ready.kind },
  });
  const woke = await deps.wakeSeat(target.to, text, meta);
  if (woke?.paused) {
    statusMessage(channelId, `${ready.seat?.name || seatId} is paused — wake skipped.`);
  } else if (woke?.offline) {
    statusMessage(channelId, `Harness offline: ${ready.kind} serve is not up.`);
  } else if (woke?.error) {
    statusMessage(channelId, `Wake failed for ${ready.seat?.name || seatId}: ${woke.error}`);
  } else if (woke?.human) {
    statusMessage(channelId, `${ready.seat?.name || seatId} is a human seat — notified, no model.`);
  }
  return woke;
}

/** Wake each target. An implicit target falls through its candidates while a seat is paused or has no usable model. */
async function startWakes(channelId, text, from, targets) {
  const results = [];
  for (const target of targets) {
    const order = target.candidates?.length ? target.candidates : [target.to];
    let woke = null;
    for (let i = 0; i < order.length; i++) {
      woke = await wakeTarget(channelId, text, from, { ...target, to: order[i] });
      const retry = woke && (woke.nokey || woke.paused) && i < order.length - 1;
      if (!retry) break;
      const next = seatOf(order[i + 1]);
      statusMessage(channelId, `Trying ${next?.name || order[i + 1]} instead.`);
    }
    results.push(woke);
  }
  return results;
}

/** Woken OpenCode seats and the session each wake ran in. */
function repliers(results) {
  const woken = results
    .filter((w) => w && w.started !== false && !w.nokey && (w.sessionId || (w.seat && !w.offline && !w.error && !w.human && !w.guest)))
    .filter((w) => w.seat && isOpenCodeAdapter(seatOf(w.seat) || {}));
  return {
    seats: woken.map((w) => w.seat),
    sessions: Object.fromEntries(woken.filter((w) => w.sessionId).map((w) => [w.seat, w.sessionId])),
  };
}

const implicitInflight = new Map();
const implicitStarts = new Map();

export function resetChatRuntime() {
  implicitInflight.clear();
  implicitStarts.clear();
  followingSeats.clear();
  seatThreads.clear();
  routedReplies.clear();
  resetThreads();
}

/** Record an implicit wake for the room unless it already had `limit` in the last minute. */
function takeImplicitSlot(channelId, limit, now = Date.now()) {
  const recent = (implicitStarts.get(channelId) || []).filter((t) => now - t < 60_000);
  if (recent.length >= limit) {
    implicitStarts.set(channelId, recent);
    return false;
  }
  recent.push(now);
  implicitStarts.set(channelId, recent);
  return true;
}

function queueImplicit(channelId, text) {
  const slot = implicitInflight.get(channelId);
  slot.queued.push(text);
  const seat = seatOf(slot.seatId);
  if (slot.queued.length === 1) statusMessage(channelId, `${seat?.name || slot.seatId} is still answering. Your next message goes to them when they finish.`);
  emit({ scope: "chat", step: "chat.queued", channel: channelId, seat: slot.seatId, detail: { queued: slot.queued.length } });
}

function runImplicit(channelId, text, from, target) {
  const slot = { seatId: target.to, queued: [] };
  implicitInflight.set(channelId, slot);
  const since = Date.now();
  const started = startWakes(channelId, text, from, [target]);
  const pending = started
    .then(async (results) => {
      const { seats, sessions } = repliers(results);
      if (seats.length) await followChannel(channelId, seats, deps.followTicks, { since, sessions });
      return results;
    })
    .finally(() => {
      if (implicitInflight.get(channelId) !== slot) return;
      implicitInflight.delete(channelId);
      if (!slot.queued.length) return;
      const woke = slot.seatId;
      const follow = slot.queued.length === 1 ? slot.queued[0] : `Follow-up messages:\n${slot.queued.map((t) => `- ${t}`).join("\n")}`;
      void runImplicit(channelId, follow, from, { ...target, to: woke, candidates: [woke] }).pending.catch(() => undefined);
    });
  return { started, pending };
}

export function routeChannelMessage({ channelId, text, from = "you", wake = true, messageId = null }) {
  const state = getState();
  const collected = collectWakeTargets(channelId, text, state);
  const { mentions, notify } = collected;
  const thread = startThread(messageId, from, (state.channels || []).find((c) => c.id === channelId));
  let targets = collected.targets.map((t) => ({ ...t, meta: { ...(t.meta || {}), thread } }));
  const author = seatOf(from, state);
  const implicit = targets.length > 0 && targets.every((t) => t.reason === "implicit");
  if (implicit && author?.kind === "bot") targets = [];

  if (implicit && targets.length) {
    const picked = pickResponder(targets[0].candidates || [targets[0].to], state);
    targets = [{ ...targets[0], to: picked.order[0], candidates: picked.order }];
    if (picked.skipped.length) {
      statusMessage(channelId, `Skipped ${skipLine(picked.skipped, state)}.`);
      emit({ level: "warn", scope: "chat", step: "chat.skip", channel: channelId, detail: { skipped: picked.skipped } });
    }
  }

  emit({
    scope: "chat",
    step: "chat.route",
    channel: channelId,
    detail: { from, mentions: mentions.map((m) => `${m.kind}:${m.id}`), targets: targets.map((t) => t.to) },
  });

  if (mentions.some((m) => m.kind === "channel")) {
    const room = (state.channels || []).find((c) => c.id === channelId);
    const members = resolveMembers(room || { id: channelId, seatIds: [], teamIds: [] }, state);
    for (const seat of members) {
      postBus({ from, to: seat.id, kind: "notify", text, wake: false, channel: channelId });
    }
  }
  for (const id of notify) {
    const already = mentions.some((m) => m.kind === "channel");
    if (already) continue;
    postBus({ from, to: id, kind: "notify", text, wake: false, channel: channelId });
  }

  if (wake && implicit && targets.length && implicitInflight.has(channelId)) {
    queueImplicit(channelId, text);
    const none = Promise.resolve([]);
    return { mentions, wakes: 0, notify, targets: [], queued: true, started: none, pending: none };
  }

  if (wake && implicit && targets.length) {
    const room = (state.channels || []).find((c) => c.id === channelId);
    const limit = roomLimits(room).implicitPerMinute;
    if (!takeImplicitSlot(channelId, limit)) {
      statusMessage(
        channelId,
        `Rate limit: this room answers ${limit} un-mentioned ${limit === 1 ? "message" : "messages"} a minute. @mention a seat to wake it now.`,
      );
      emit({ level: "warn", scope: "chat", step: "chat.ratelimit", channel: channelId, detail: { limit } });
      const none = Promise.resolve([]);
      return { mentions, wakes: 0, notify, targets: [], rateLimited: true, started: none, pending: none };
    }
  }

  if (wake && !targets.length && !mentions.length && author?.kind === "human" && quietRoom(channelId, state)) {
    const room = (state.channels || []).find((c) => c.id === channelId);
    const humans = resolveMembers(room, state).filter((seat) => seat.kind === "human" && seat.id !== from);
    for (const seat of humans) postBus({ from, to: seat.id, kind: "notify", text, wake: false, channel: channelId });
    statusMessage(channelId, "This room is quiet: un-mentioned messages wake nobody. @mention a seat to get a reply.");
    emit({ scope: "chat", step: "chat.quiet", channel: channelId, detail: { notified: humans.map((h) => h.id) } });
    const none = Promise.resolve([]);
    return { mentions, wakes: 0, notify: humans.map((h) => h.id), targets: [], quiet: true, started: none, pending: none };
  }

  if (wake && targets.length) {
    const first = targets[0];
    const seatId = resolvedSeatId(first.to, state);
    const seat = seatOf(seatId, state);
    if (seat && isOpenCodeAdapter(seat)) {
      const kind = harnessKindForSeat(seat);
      const h = deps.harnessStatus(kind);
      const plan = seatModelPlan(seat, deps.knownLoadedModels?.(kind) ?? null);
      if (h.harness !== "up") statusMessage(channelId, `Starting ${kind} harness…`);
      else statusMessage(channelId, `Waking ${seat?.name || seatId} (${plan.model || seat?.model || "default"})…`);
      if (plan.hint) statusMessage(channelId, plan.hint);
    } else if (!seat) {
      const h = deps.harnessStatus("company");
      if (h.harness !== "up") statusMessage(channelId, "Starting company harness…");
    }
  }
  let started = Promise.resolve([]);
  let pending = started;
  if (wake && targets.length && implicit) {
    ({ started, pending } = runImplicit(channelId, text, from, targets[0]));
  } else if (wake && targets.length) {
    const since = Date.now();
    started = startWakes(channelId, text, from, targets);
    pending = started.then(async (results) => {
      const { seats, sessions } = repliers(results);
      if (seats.length) await followChannel(channelId, seats, deps.followTicks, { since, sessions });
      return results;
    });
  }
  if (wake && !targets.length) {
    emit({ level: "warn", scope: "chat", step: "chat.nowake", channel: channelId, detail: { from, reason: implicit ? "bot author" : "no target" } });
  }
  return { mentions, wakes: wake ? targets.length : 0, notify, targets, started, pending };
}

function absorbBusSeats(channelId, seats) {
  for (const b of (getState().bus || []).slice(-40)) {
    if (b.channel && b.channel !== channelId) continue;
    if (b.kind !== "handoff" && b.kind !== "send_message") continue;
    const to = String(b.to || "");
    if (!to || to.startsWith("channel:")) continue;
    if (to.startsWith("team:")) {
      const resolved = teamWakeTarget(to, getState().teams || []);
      if (resolved) seats.add(resolved);
      continue;
    }
    seats.add(to);
  }
}

/**
 * Mirror replies into the room until they arrive or the ticks run out.
 * `sessions` maps a seat to the session its wake ran in; seats without one
 * (bus mail picked up from the room) are read from their DM session.
 * `own` polls in a separate loop even when the room is already followed.
 */
export async function followChannel(
  channelId,
  seatIds = [],
  ticks = deps.followTicks,
  { since = 0, sessions: bound = {}, own = false } = {},
) {
  const existing = followingSeats.get(channelId);
  if (existing && !own) {
    for (const id of seatIds) existing.seats.add(id);
    Object.assign(existing.sessions, bound);
    return;
  }
  const seats = new Set(seatIds.filter(Boolean));
  const follow = { seats, sessions: { ...bound } };
  if (!existing) followingSeats.set(channelId, follow);
  const seen = new Set();
  const failed = new Set();
  const answered = new Set();
  let replies = 0;
  const missingKey = [...seats].some((id) => {
    const seat = getState().seats.find((s) => s.id === id);
    return !seatModelPlan(seat, deps.knownLoadedModels?.(seat ? harnessKindForSeat(seat) : "company") ?? null).ok;
  });
  const limit = missingKey ? Math.min(ticks, 6) : ticks;
  try {
    for (let i = 0; i < limit; i++) {
      absorbBusSeats(channelId, seats);
      for (const seatId of [...seats]) {
        if (failed.has(seatId)) continue;
        const sessionId = follow.sessions[seatId] || null;
        const parts = await deps.pullAssistant(seatId, { sessionId });
        let posted = 0;
        for (const p of parts) {
          if (!p.id || seen.has(p.id)) continue;
          seen.add(p.id);
          if (since && p.created && p.created < since) continue;
          if (alreadyMirrored(p.id)) {
            // Session sync can post the reply before this loop reads it; it still answers this wake.
            const prior = mirroredReply(p.id, channelId, seatId);
            if (prior) {
              posted += 1;
              replies += 1;
              answered.add(seatId);
              routeOnce(channelId, seatId, prior);
            }
            continue;
          }
          const seat = getState().seats.find((s) => s.id === seatId);
          const msg = postMessage(channelId, seat?.name || seatId, "bot", p.text, { seatId, mirrored: true, sessionId: p.id, ...threadCaption(seatId, channelId) });
          posted += 1;
          replies += 1;
          answered.add(seatId);
          routeOnce(channelId, seatId, msg);
          emit({
            scope: "chat",
            step: "seat.reply",
            channel: channelId,
            seat: seatId,
            detail: { messageId: p.id },
          });
        }
        if (posted || !deps.pullFailure) continue;
        const failure = await deps.pullFailure(seatId, since, { sessionId });
        if (!failure) continue;
        failed.add(seatId);
        const seat = getState().seats.find((s) => s.id === seatId);
        statusMessage(channelId, `${seat?.name || seatId} could not reply: ${failure.text}`);
        emit({
          level: "error",
          scope: "chat",
          step: "seat.failed",
          channel: channelId,
          seat: seatId,
          detail: { code: failure.code, error: failure.text },
        });
      }
      if ([...seats].every((id) => failed.has(id) || answered.has(id))) break;
      await new Promise((r) => setTimeout(r, deps.followDelayMs));
    }
    const waiting = [...seats].filter((id) => !failed.has(id));
    if (!replies && waiting.length) {
      const first = waiting[0];
      const seat = getState().seats.find((s) => s.id === first);
      const hint = providerHint(seat, deps.knownLoadedModels?.(seat ? harnessKindForSeat(seat) : "company") ?? null);
      statusMessage(
        channelId,
        hint || `${seat?.name || first} did not reply. Open Debug for the last pipeline steps.`,
      );
      emit({
        level: "warn",
        scope: "chat",
        step: "seat.noreply",
        channel: channelId,
        seat: first,
        detail: { hint: hint || "noreply" },
      });
      if (ticks > 0) blockLatestRun(first, hint || "did not reply");
    }
  } finally {
    if (followingSeats.get(channelId) === follow) followingSeats.delete(channelId);
  }
  return replies;
}

/** Thread facts shown under a mirrored reply (`↳ from @x · hop 2/4`). */
function threadCaption(seatId, channelId) {
  const thread = seatThreads.get(`${seatId}|${channelId}`);
  if (!thread?.threadId) return {};
  const room = (getState().channels || []).find((c) => c.id === channelId);
  const limits = roomLimits(room);
  return {
    thread: {
      threadId: thread.threadId,
      hop: thread.hop || 0,
      from: thread.from || null,
      maxHops: limits.maxHops,
      botWakes: threadStats(thread.threadId).botWakes,
      maxBotWakes: limits.maxBotWakesPerThread,
    },
  };
}

/**
 * Route @mentions in a bot reply CORE just mirrored. Only replies to wakes
 * this process started are routed, so a transcript caught up after a restart
 * never wakes anyone.
 */
/** A reply can be seen by more than one follow loop; its @mentions are routed once. */
const routedReplies = new Set();
function routeOnce(channelId, seatId, msg) {
  const key = msg?.sessionId || msg?.id;
  if (!key || routedReplies.has(key)) return null;
  routedReplies.add(key);
  if (routedReplies.size > 2000) routedReplies.delete(routedReplies.values().next().value);
  return routeBotReply(channelId, seatId, msg);
}

export function routeBotReply(channelId, seatId, msg) {
  const thread = seatThreads.get(`${seatId}|${channelId}`);
  if (!thread || !msg?.text || !String(msg.text).includes("@")) return null;
  const state = getState();
  const plan = planBotMentions({ state, channelId, fromSeatId: seatId, text: msg.text, thread });
  for (const to of plan.notify) postBus({ from: seatId, to, kind: "notify", text: msg.text, wake: false, channel: channelId });
  for (const line of plan.stops) statusMessage(channelId, line);
  if (plan.ignored.length || plan.stops.length) {
    emit({ level: "warn", scope: "chat", step: "thread.limit", channel: channelId, seat: seatId, detail: { stops: plan.stops, ignored: plan.ignored, threadId: thread.threadId } });
  }
  if (!plan.wakes.length) return { ...plan, pending: Promise.resolve([]) };
  for (const w of plan.wakes) noteBotWake(thread.threadId, seatId, w.to);
  emit({
    scope: "chat",
    step: "thread.wake",
    channel: channelId,
    seat: seatId,
    detail: { threadId: thread.threadId, hop: plan.wakes[0].meta.thread.hop, targets: plan.wakes.map((w) => w.to) },
  });
  const since = Date.now();
  const pending = startWakes(channelId, msg.text, seatId, plan.wakes).then(async (results) => {
    const { seats, sessions } = repliers(results);
    if (seats.length) await followChannel(channelId, seats, deps.followTicks, { since, sessions, own: true });
    return results;
  });
  pending.catch(() => undefined);
  return { ...plan, pending };
}

/** An OpenCode message id is posted at most once, in whichever room it landed first. */
function alreadyMirrored(sessionMessageId) {
  return (getState().messages || []).some((m) => m.sessionId === sessionMessageId);
}

/** The room message for an OpenCode message id when it is this seat's reply in this room, else null. */
function mirroredReply(sessionMessageId, channelId, seatId) {
  return (getState().messages || []).find((m) => m.sessionId === sessionMessageId && m.channel === channelId && m.seatId === seatId) || null;
}

export function mirrorTranscript(channelId, seatId, parts) {
  const seat = getState().seats.find((s) => s.id === seatId);
  const posted = [];
  for (const p of parts || []) {
    if (!p?.id || !p.text) continue;
    if (looksLikeWakePrompt(p.text)) continue;
    if (alreadyMirrored(p.id)) continue;
    if (p.role === "user" && getState().messages.some((m) => m.text === p.text && m.channel === channelId)) continue;
    const role = p.role === "user" ? "human" : "bot";
    const who = role === "human" ? "You" : seat?.name || seatId;
    const msg = postMessage(channelId, who, role, p.text, {
      seatId: role === "human" ? "you" : seatId,
      mirrored: true,
      sessionId: p.id,
      ...(role === "bot" ? threadCaption(seatId, channelId) : {}),
    });
    posted.push(msg);
    if (role === "bot") routeOnce(channelId, seatId, msg);
  }
  if (posted.length) {
    emit({
      scope: "harness",
      step: "session.mirrored",
      channel: channelId,
      seat: seatId,
      detail: { count: posted.length },
    });
  }
  return posted;
}

/** Every bound session and the room its replies belong in: room sessions to their room, DM sessions to the seat's last DM-session room. */
export function boundSessions(state = getState()) {
  const out = [];
  for (const map of [state.sessions || {}, state.systemSessions || {}]) {
    for (const [seatId, sessionId] of Object.entries(map)) {
      if (sessionId) out.push({ seatId, sessionId, channelId: state.sessionRooms?.[seatId] || `dm-${seatId}` });
    }
  }
  for (const [seatId, rooms] of Object.entries(state.roomSessions || {})) {
    for (const [channelId, entry] of Object.entries(rooms || {})) {
      if (entry?.sessionId) out.push({ seatId, sessionId: entry.sessionId, channelId });
    }
  }
  return out;
}

export async function syncBoundSessions() {
  for (const { seatId, sessionId, channelId } of boundSessions()) {
    try {
      const msgs = await deps.pullAssistant(seatId, { sessionId });
      mirrorTranscript(channelId, seatId, msgs);
    } catch {
      /* session gone */
    }
  }
}

const CLEANUP_EVERY_MS = 60 * 60 * 1000;
let cleanupTimer = null;

export function startSessionSync(intervalMs = 2500) {
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    void syncBoundSessions();
  }, intervalMs);
  if (typeof syncTimer.unref === "function") syncTimer.unref();
  cleanupTimer = setInterval(() => {
    void cleanupRoomSessions().catch(() => undefined);
  }, CLEANUP_EVERY_MS);
  if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();
}

export { sessionTranscript };
