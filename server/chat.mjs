import { getState, mutate, uid } from "./store.mjs";
import { postBus, wakeSeat, pullAssistant } from "./bus.mjs";
import { parseMentions, CONDUCTOR_ID } from "./mentions.mjs";
import { resolveMembers } from "./channels.mjs";
import { teamWakeTarget } from "./teams.mjs";
import { ensure, status as harnessStatus, sessionTranscript, harnessKindForSeat } from "./harness.mjs";
import { emit } from "./trace.mjs";
import { firstConnectedModel, keyStatusForModel } from "./providers.mjs";

const followingSeats = new Map();
let syncTimer = null;

export const deps = {
  wakeSeat,
  pullAssistant,
  ensure,
  harnessStatus,
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

export function implicitTargets(channelId, state = getState()) {
  const id = String(channelId || "");
  if (id.startsWith("team-")) {
    return [{ to: `team:${id.slice("team-".length)}`, reason: "team-room" }];
  }
  if (id.startsWith("project-")) {
    const projectId = id.slice("project-".length);
    const project = (state.projects || []).find((p) => p.id === projectId);
    const pm = project?.pmSeatId && (state.seats || []).find((s) => s.id === project.pmSeatId);
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
  return [{ to: CONDUCTOR_ID, reason: "channel" }];
}

export function collectWakeTargets(channelId, text, state = getState()) {
  const mentions = parseMentions(text, state);
  const targets = [];
  const seen = new Set();
  const notify = [];

  function add(to, reason) {
    if (!to || seen.has(to)) return;
    seen.add(to);
    targets.push({ to, reason });
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
    for (const t of implicitTargets(channelId, state)) add(t.to, t.reason);
  }

  return { mentions, targets, notify };
}

function statusMessage(channelId, text) {
  const last = (getState().messages || []).filter((m) => m.channel === channelId && m.system).slice(-1)[0];
  if (last?.text === text) return last;
  return postMessage(channelId, "System", "bot", text, { system: true });
}

export function providerHint(seat) {
  const st = deps.keyStatus(seat?.model);
  const name = seat?.name || "This seat";
  const model = seat?.model || "the assigned model";
  if (st.connected) return null;
  if (!st.providerID) return `${name} has no provider for ${model}. Add one in Settings.`;
  if (!st.configured) {
    return `${name} uses ${model}, but ${st.providerID} is not in Settings. Add that provider and an API key, then send again.`;
  }
  return `No API key for ${st.providerID}. ${name} cannot call ${st.modelID || model}. Add the key in Settings, then send again.`;
}

export function seatModelPlan(seat) {
  const assigned = seat?.model || "";
  const st = deps.keyStatus(assigned);
  if (st.connected) return { ok: true, model: assigned, hint: null, fallback: false };
  const fb = deps.fallbackModel?.();
  if (fb?.providerID && fb?.modelID) {
    const ref = `${fb.providerID}/${fb.modelID}`;
    const name = seat?.name || "This seat";
    return {
      ok: true,
      model: ref,
      fallback: true,
      hint: `${name} is set to ${assigned || "no model"}, which is not connected. Using ${ref} instead.`,
    };
  }
  return { ok: false, model: assigned, hint: providerHint(seat), fallback: false };
}

function looksLikeWakePrompt(text) {
  const t = String(text || "");
  return /^You are .+ on the Roster-flow org chart/.test(t) || t.includes("Propose ONE OrgPlan");
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

async function runWakes(channelId, text, from, targets) {
  const results = [];
  for (const target of targets) {
    const ready = await ensureForTarget(target.to, channelId);
    const seatId = resolvedSeatId(target.to, getState());
    rememberSessionRoom(seatId, channelId);
    if (!ready.ok) {
      results.push({ offline: true, seat: seatId, harness: ready.kind, error: ready.error });
      continue;
    }
    const plan = seatModelPlan(ready.seat);
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
      results.push({ seat: seatId, error: plan.hint, nokey: true });
      continue;
    }
    emit({
      scope: "chat",
      step: "seat.wake",
      channel: channelId,
      seat: seatId,
      detail: { reason: target.reason, model, harness: ready.kind },
    });
    const woke = await deps.wakeSeat(target.to, text, { from, kind: target.reason, channel: channelId });
    if (woke?.offline) {
      statusMessage(channelId, `Harness offline: ${ready.kind} serve is not up.`);
    } else if (woke?.error) {
      statusMessage(channelId, `Wake failed for ${ready.seat?.name || seatId}: ${woke.error}`);
    } else if (woke?.human) {
      statusMessage(channelId, `${ready.seat?.name || seatId} is a human seat — notified, no model.`);
    }
    results.push(woke);
  }
  const seats = results
    .filter((w) => w && (w.sessionId || (w.seat && !w.offline && !w.error && !w.human)))
    .map((w) => w.seat)
    .filter(Boolean);
  if (seats.length) await followChannel(channelId, seats);
  return results;
}

export function routeChannelMessage({ channelId, text, from = "you", wake = true }) {
  const state = getState();
  const { mentions, targets, notify } = collectWakeTargets(channelId, text, state);

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

  if (wake && targets.length) {
    const first = targets[0];
    const seatId = resolvedSeatId(first.to, state);
    const seat = (state.seats || []).find((s) => s.id === seatId);
    const kind = seat ? harnessKindForSeat(seat) : "company";
    const h = deps.harnessStatus(kind);
    const plan = seatModelPlan(seat);
    if (h.harness !== "up") statusMessage(channelId, `Starting ${kind} harness…`);
    else statusMessage(channelId, `Waking ${seat?.name || seatId} (${plan.model || seat?.model || "default"})…`);
    if (plan.hint) statusMessage(channelId, plan.hint);
  }
  const pending =
    wake && targets.length
      ? runWakes(channelId, text, from, targets)
      : Promise.resolve([]);
  if (wake && !targets.length) {
    emit({ level: "warn", scope: "chat", step: "chat.nowake", channel: channelId, detail: { from } });
  }
  return { mentions, wakes: wake ? targets.length : 0, notify, targets, pending };
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

export async function followChannel(channelId, seatIds = [], ticks = deps.followTicks) {
  const existing = followingSeats.get(channelId);
  if (existing) {
    for (const id of seatIds) existing.add(id);
    return;
  }
  const seats = new Set(seatIds.filter(Boolean));
  followingSeats.set(channelId, seats);
  const seen = new Set();
  let replies = 0;
  const missingKey = [...seats].some((id) => {
    const seat = getState().seats.find((s) => s.id === id);
    return !seatModelPlan(seat).ok;
  });
  const limit = missingKey ? Math.min(ticks, 6) : ticks;
  try {
    for (let i = 0; i < limit; i++) {
      absorbBusSeats(channelId, seats);
      for (const seatId of [...seats]) {
        const parts = await deps.pullAssistant(seatId);
        for (const p of parts) {
          if (!p.id || seen.has(p.id)) continue;
          seen.add(p.id);
          if (getState().messages.some((m) => m.text === p.text && m.channel === channelId)) continue;
          const seat = getState().seats.find((s) => s.id === seatId);
          postMessage(channelId, seat?.name || seatId, "bot", p.text, { seatId, mirrored: true, sessionId: p.id });
          replies += 1;
          emit({
            scope: "chat",
            step: "seat.reply",
            channel: channelId,
            seat: seatId,
            detail: { messageId: p.id },
          });
        }
      }
      if (replies) continue;
      await new Promise((r) => setTimeout(r, deps.followDelayMs));
    }
    if (!replies && seats.size) {
      const first = [...seats][0];
      const seat = getState().seats.find((s) => s.id === first);
      const hint = providerHint(seat);
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
    }
  } finally {
    followingSeats.delete(channelId);
  }
  return replies;
}

export function mirrorTranscript(channelId, seatId, parts) {
  const seat = getState().seats.find((s) => s.id === seatId);
  const posted = [];
  for (const p of parts || []) {
    if (!p?.id || !p.text) continue;
    if (looksLikeWakePrompt(p.text)) continue;
    if (getState().messages.some((m) => (m.sessionId === p.id || m.text === p.text) && m.channel === channelId)) continue;
    const role = p.role === "user" ? "human" : "bot";
    const who = role === "human" ? "You" : seat?.name || seatId;
    posted.push(
      postMessage(channelId, who, role, p.text, {
        seatId: role === "human" ? "you" : seatId,
        mirrored: true,
        sessionId: p.id,
      }),
    );
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

export async function syncBoundSessions() {
  const state = getState();
  const maps = [
    { sessions: state.sessions || {} },
    { sessions: state.systemSessions || {} },
  ];
  for (const { sessions } of maps) {
    for (const [seatId, sessionId] of Object.entries(sessions)) {
      if (!sessionId) continue;
      const channelId = state.sessionRooms?.[seatId] || `dm-${seatId}`;
      try {
        const msgs = await deps.pullAssistant(seatId);
        mirrorTranscript(channelId, seatId, msgs);
      } catch {
        /* session gone */
      }
    }
  }
}

export function startSessionSync(intervalMs = 2500) {
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    void syncBoundSessions();
  }, intervalMs);
  if (typeof syncTimer.unref === "function") syncTimer.unref();
}

export { sessionTranscript };
