import { getState, mutate, clock, uid } from "./store.mjs";
import { createSession, promptSession, status as harnessStatus } from "./harness.mjs";

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

export async function wakeSeat(to, text, meta = {}) {
  if (String(to).startsWith("team:") || String(to).startsWith("channel:")) return null;
  const seat = seatById(to);
  if (!seat || seat.kind !== "bot") return null;
  const h = harnessStatus();
  if (h.harness !== "up") return { offline: true, seat: to };
  try {
    const state = getState();
    let sessionId = state.sessions[to];
    if (!sessionId) {
      const ses = await createSession({ title: `roster:${to}`, agent: to });
      sessionId = ses?.id || ses?.sessionID;
      if (sessionId) {
        mutate((s) => {
          s.sessions[to] = sessionId;
        });
      }
    }
    if (!sessionId) return { error: "no session", seat: to };
    const model = seat.model
      ? { providerID: inferProvider(seat.model), modelID: seat.model }
      : undefined;
    await promptSession(sessionId, {
      agent: to,
      model,
      parts: [
        {
          type: "text",
          text: [
            `You are ${seat.name} (${seat.role}) on the Roster-flow org chart.`,
            `Job: ${seat.job}`,
            `Allow: ${seat.tools.join(", ")}. Deny: ${seat.deny.join(", ") || "—"}.`,
            `Message from ${meta.from || "bus"} (${meta.kind || "send_message"}):`,
            text,
            "Use roster_send_message / roster_handoff / roster_report to talk to peers. Do not impersonate them.",
          ].join("\n"),
        },
      ],
    });
    return { sessionId, seat: to };
  } catch (err) {
    return { error: String(err.message || err), seat: to };
  }
}

function inferProvider(model) {
  if (/grok|xai/i.test(model)) return "xai";
  if (/claude|sonnet|opus|haiku/i.test(model)) return "anthropic";
  if (/gpt|o[0-9]/i.test(model)) return "openai";
  return "xai";
}

export function cycleSafe(from, to) {
  if (from === to) return false;
  const recent = (getState().bus || []).slice(-12);
  const ping = recent.filter((b) => b.from === from && b.to === to).length;
  const pong = recent.filter((b) => b.from === to && b.to === from).length;
  return ping + pong < 8;
}
