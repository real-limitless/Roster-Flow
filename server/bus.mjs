import { getState, mutate, clock, uid } from "./store.mjs";
import { createSession, promptSession, sessionMessages, assistantText, status as harnessStatus } from "./harness.mjs";
import { resolveSeatModel } from "./providers.mjs";
import { teamWakeTarget } from "./teams.mjs";

export const deps = {
  createSession,
  promptSession,
  sessionMessages,
  harnessStatus,
};

export function postBus({ from, to, kind = "send_message", text, runId, wake = false }) {
  const entry = {
    id: uid("bus"),
    from,
    to,
    kind,
    text,
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
  const h = deps.harnessStatus();
  if (h.harness !== "up") return null;
  let sessionId = getState().sessions?.[to];
  if (sessionId) return sessionId;
  const ses = await deps.createSession({ title: `roster:${to}`, agent: to });
  sessionId = ses?.id || ses?.sessionID;
  if (sessionId) {
    mutate((s) => {
      s.sessions = { ...(s.sessions || {}), [to]: sessionId };
    });
  }
  return sessionId || null;
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
  const h = deps.harnessStatus();
  if (h.harness !== "up") return { offline: true, seat: to };
  try {
    let sessionId = await ensureSeatSession(to);
    if (!sessionId) return { error: "no session", seat: to };
    const model = resolveSeatModel(seat);
    const body = {
      agent: to,
      model,
      parts: [
        {
          type: "text",
          text: [
            `You are ${seat.name} (${seat.role}) on the Roster-flow org chart.`,
            seat.seatType ? `Seat type: ${seat.seatType}` : "",
            seat.team ? `Team: ${seat.team}` : "",
            seat.persona ? `Persona: ${seat.persona}` : "",
            `Job: ${seat.job}`,
            seat.instructions ? `Instructions:\n${seat.instructions}` : "",
            `Allow: ${seat.tools.join(", ")}. Deny: ${seat.deny.join(", ") || "—"}.`,
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
    try {
      await deps.promptSession(sessionId, body);
    } catch (err) {
      if (err.status === 404) {
        mutate((s) => {
          if (s.sessions) delete s.sessions[to];
        });
        sessionId = await ensureSeatSession(to);
        if (!sessionId) return { error: "no session after recreate", seat: to };
        await deps.promptSession(sessionId, body);
      } else {
        throw err;
      }
    }
    return { sessionId, seat: to, model };
  } catch (err) {
    return { error: String(err.message || err), seat: to };
  }
}

export async function pullAssistant(to) {
  const sessionId = getState().sessions?.[to];
  if (!sessionId) return [];
  try {
    const msgs = await deps.sessionMessages(sessionId);
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
