import { getState, mutate, clock, uid } from "./store.mjs";
import {
  createSession,
  promptSession,
  sessionMessages,
  assistantText,
  status as harnessStatus,
  harnessKindForSeat,
  sessionKeyForKind,
} from "./harness.mjs";
import { resolveUsableModel } from "./providers.mjs";
import { teamWakeTarget } from "./teams.mjs";
import { modelChainForSeat } from "./models.mjs";
import { CONDUCTOR_ID } from "./mentions.mjs";
import { emit } from "./trace.mjs";
import { goalPackLines } from "./goals.mjs";
import { wakeBlocked } from "./seats.mjs";

export const deps = {
  createSession,
  promptSession,
  sessionMessages,
  harnessStatus,
};

function sessionMap(state, seat) {
  const key = sessionKeyForKind(harnessKindForSeat(seat));
  return { key, sessions: state[key] || {} };
}

export function postBus({ from, to, kind = "send_message", text, runId, wake = false, channel }) {
  const entry = {
    id: uid("bus"),
    from,
    to,
    kind,
    text,
    channel: channel || null,
    runId: runId || null,
    time: new Date().toISOString(),
    clock: clock(),
  };
  mutate((s) => {
    s.bus = [...(s.bus || []), entry];
  });
  if (wake) void wakeSeat(to, text, { from, kind, runId: entry.runId });
  return entry;
}

function seatById(id) {
  return getState().seats.find((x) => x.id === id);
}

export async function ensureSeatSession(to) {
  const seat = seatById(to);
  if (!seat || seat.kind !== "bot") return null;
  const kind = harnessKindForSeat(seat);
  const h = deps.harnessStatus(kind);
  if (h.harness !== "up") return null;
  const { key, sessions } = sessionMap(getState(), seat);
  let sessionId = sessions[to];
  if (sessionId) return sessionId;
  const ses = await deps.createSession({ title: `roster:${to}`, agent: to }, kind);
  sessionId = ses?.id || ses?.sessionID;
  if (sessionId) {
    mutate((s) => {
      s[key] = { ...(s[key] || {}), [to]: sessionId };
    });
  }
  return sessionId || null;
}

export function promptBody(seat, to, text, meta, model) {
  const pack = goalPackLines(getState(), { seat, runId: meta.runId });
  return {
    agent: to,
    model,
    parts: [
      {
        type: "text",
        text: [
          ...pack,
          `You are ${seat.name} (${seat.role}) on the Roster-flow org chart.`,
          seat.seatType ? `Seat type: ${seat.seatType}` : "",
          seat.team ? `Team: ${seat.team}` : "",
          seat.id === CONDUCTOR_ID ? "You own @channel. Notify members; only hand work to bots whose job matches." : "",
          meta.channel ? `Current room: #${meta.channel}` : "",
          seat.persona ? `Persona: ${seat.persona}` : "",
          `Job: ${seat.job}`,
          seat.instructions ? `Instructions:\n${seat.instructions}` : "",
          `Allow: ${(seat.tools || []).join(", ")}. Deny: ${(seat.deny || []).join(", ") || "—"}.`,
          meta.via ? `This mail was addressed to ${meta.via}.` : "",
          `Message from ${meta.from || "bus"} (${meta.kind || "send_message"}):`,
          text,
          "Use roster_send_message / roster_handoff / roster_report to talk to peers. Do not impersonate them.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  };
}

async function promptWithFallback(sessionId, seat, to, text, meta) {
  const state = getState();
  const kind = harnessKindForSeat(seat);
  const team = seat.team ? (state.teams || []).find((t) => t.id === seat.team) : null;
  if (team && team.modelStrategy === "round_robin") {
    mutate((s) => {
      const t = (s.teams || []).find((x) => x.id === team.id);
      if (t) t.rrIndex = team.rrIndex;
    });
  }
  const chain = modelChainForSeat(seat, team);
  const refs = chain.length ? chain.map((m) => resolveUsableModel(seat, m)) : [resolveUsableModel(seat)];
  let lastErr = null;
  for (const model of refs) {
    const body = promptBody(seat, to, text, meta, model);
    try {
      await deps.promptSession(sessionId, body, kind);
      emit({
        scope: "chat",
        step: "seat.prompted",
        seat: to,
        channel: meta.channel || null,
        detail: { sessionId, model, harness: kind },
      });
      return { sessionId, seat: to, model, harness: kind };
    } catch (err) {
      lastErr = err;
      if (err.status === 404) throw err;
    }
  }
  if (lastErr) throw lastErr;
  return { sessionId, seat: to, model: refs[0], harness: kind };
}

export async function wakeSeat(to, text, meta = {}) {
  if (String(to).startsWith("channel:")) return null;
  if (String(to).startsWith("team:")) {
    const target = teamWakeTarget(to, getState().teams || []);
    if (!target) return { error: "team has no supervisor", seat: to };
    return wakeSeat(target, text, { ...meta, via: to });
  }
  const seat = seatById(to);
  if (!seat) return { error: "seat not found", seat: to };
  if (seat.kind !== "bot") return { human: true, seat: to };
  const blocked = wakeBlocked(getState(), seat, meta);
  if (blocked) {
    emit({
      level: "warn",
      scope: "chat",
      step: "seat.paused",
      seat: to,
      channel: meta.channel || null,
      detail: { reason: blocked.reason, runId: meta.runId || null },
    });
    return { paused: true, seat: to, reason: blocked.reason };
  }
  const kind = harnessKindForSeat(seat);
  const h = deps.harnessStatus(kind);
  if (h.harness !== "up") {
    emit({
      level: "warn",
      scope: "chat",
      step: "seat.offline",
      seat: to,
      channel: meta.channel || null,
      detail: { harness: kind },
    });
    return { offline: true, seat: to, harness: kind };
  }
  try {
    let sessionId = await ensureSeatSession(to);
    if (!sessionId) return { error: "no session", seat: to, harness: kind };
    try {
      return await promptWithFallback(sessionId, seat, to, text, meta);
    } catch (err) {
      if (err.status === 404) {
        mutate((s) => {
          const key = sessionKeyForKind(kind);
          if (s[key]) delete s[key][to];
        });
        sessionId = await ensureSeatSession(to);
        if (!sessionId) return { error: "no session after recreate", seat: to, harness: kind };
        return await promptWithFallback(sessionId, seat, to, text, meta);
      }
      throw err;
    }
  } catch (err) {
    const error = String(err.message || err);
    emit({
      level: "error",
      scope: "chat",
      step: "seat.error",
      seat: to,
      channel: meta.channel || null,
      detail: { harness: kind, error },
    });
    return { error, seat: to, harness: kind };
  }
}

export async function pullAssistant(to) {
  const seat = seatById(to);
  if (!seat) return [];
  const kind = harnessKindForSeat(seat);
  const sessionId = sessionMap(getState(), seat).sessions[to];
  if (!sessionId) return [];
  try {
    const msgs = await deps.sessionMessages(sessionId, kind);
    return assistantText(msgs);
  } catch {
    return [];
  }
}

export function cycleSafe(from, to) {
  if (from === to) return false;
  const recent = (getState().bus || []).slice(-12);
  const ping = recent.filter((b) => b.from === from && b.to === to).length;
  const pong = recent.filter((b) => b.from === to && b.to === from).length;
  return ping + pong < 8;
}
