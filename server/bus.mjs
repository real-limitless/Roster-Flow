import { getState, mutate, clock, uid } from "./store.mjs";
import {
  createSession,
  promptSession,
  sessionMessages,
  assistantText,
  status as harnessStatus,
  harnessKindForSeat,
  sessionKeyForKind,
  loadedModels,
  describeOpenCodeError,
  lastAssistantFailure,
  turnUsage,
} from "./harness.mjs";
import { isBuiltinProvider, isLoadedModel, loadedProviderIds, modelAllowedInConfig, resolveUsableModel } from "./providers.mjs";
import { teamWakeTarget } from "./teams.mjs";
import { modelChainForSeat } from "./models.mjs";
import { CONDUCTOR_ID } from "./mentions.mjs";
import { emit } from "./trace.mjs";
import { goalPackLines } from "./goals.mjs";
import { wakeBlocked } from "./seats.mjs";
import { isOpenCodeAdapter, wakeAdapter } from "./adapters.mjs";
import { applyTurnUsage, estimateTokens, meterWake } from "./budget.mjs";
import { dropRoomSession, liveRoomSession, roomContext, roomSessionTitle, setRoomSession } from "./room-sessions.mjs";
import { syncSeatAgent } from "./agents.mjs";

export const deps = {
  createSession,
  promptSession,
  sessionMessages,
  harnessStatus,
  loadedModels,
};

function modelRef(model) {
  return model?.providerID ? `${model.providerID}/${model.modelID || ""}` : String(model || "");
}

function sessionMap(state, seat) {
  const key = sessionKeyForKind(harnessKindForSeat(seat));
  return { key, sessions: state[key] || {} };
}

const pendingWakes = new WeakMap();

export function blockLatestRun(seatId, reason) {
  const runs = getState().runs || [];
  const run = [...runs].reverse().find((r) => r.seatId === seatId && (r.status === "running" || r.status === "starting"));
  if (run) noteRun(run.id, seatId, "blocked", reason || "did not start");
  return run?.id || null;
}

function noteRun(runId, seatId, status, reason) {
  if (!runId) return;
  mutate((s) => {
    const runs = Array.isArray(s.runs) ? s.runs : [];
    let run = runs.find((r) => r.id === runId);
    if (!run) {
      run = { id: runId, seatId: seatId || null, at: new Date().toISOString() };
      s.runs = [...runs, run];
    }
    run.status = status;
    run.seatId = seatId || run.seatId || null;
    run.reason = reason || null;
    run.updatedAt = new Date().toISOString();
  });
}

async function announceWake(meta, text) {
  if (!meta || meta.announce === false || !meta.channel || !text) return;
  const { postMessage } = await import("./chat.mjs");
  postMessage(meta.channel, "System", "bot", text, { system: true, runId: meta.runId || null });
}

/** The in-flight wake for a bus entry, if `postBus` started one. */
export function pendingWake(entry) {
  return pendingWakes.get(entry) || null;
}

export function postBus({ from, to, kind = "send_message", text, runId, wake = false, channel, jobId }) {
  const waking = Boolean(wake) && !String(to || "").startsWith("channel:");
  const resolvedRunId = runId || (waking ? uid("run") : null);
  const room = channel || (waking ? "ship" : null);
  const entry = {
    id: uid("bus"),
    from,
    to,
    kind,
    text,
    channel: room,
    runId: resolvedRunId,
    time: new Date().toISOString(),
    clock: clock(),
    ...(jobId ? { jobId } : {}),
  };
  mutate((s) => {
    s.bus = [...(s.bus || []), entry];
  });
  if (waking) {
    pendingWakes.set(
      entry,
      wakeSeat(to, text, { from, kind, runId: resolvedRunId, channel: room, jobId, announce: true }),
    );
  }
  return entry;
}

function seatById(id) {
  return getState().seats.find((x) => x.id === id);
}

/**
 * The seat's OpenCode session. With `channel`, its session for that room
 * (`roster:<seat>:<room>`); without, its DM session (`roster:<seat>`), which
 * the Harness attach pane, heartbeats, and bus mail use.
 */
export async function ensureSeatSession(to, { channel = null } = {}) {
  const seat = seatById(to);
  if (!seat || seat.kind !== "bot") return null;
  const kind = harnessKindForSeat(seat);
  const h = deps.harnessStatus(kind);
  if (h.harness !== "up") return null;
  if (channel) {
    const entry = liveRoomSession(getState(), seat, channel);
    if (entry) return entry.sessionId;
    const ses = await deps.createSession({ title: roomSessionTitle(to, channel), agent: to }, kind);
    const id = ses?.id || ses?.sessionID;
    if (!id) return null;
    setRoomSession(to, channel, { sessionId: id, harness: kind, cursor: null, lastWakeAt: new Date().toISOString() });
    emit({ scope: "harness", step: "session.room", seat: to, channel, detail: { sessionId: id, harness: kind } });
    return id;
  }
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

export const IMPLICIT = "implicit";

const ROOM_KINDS = new Set([IMPLICIT, "mention-seat", "mention-team", "mention-channel", "team-room", "project-pm", "project-channel", "dm"]);

/** The room whose session a wake runs in, or null for the seat's DM session (its own DM, bus mail, heartbeats). */
export function roomSessionChannel(meta = {}, seatId) {
  const room = String(meta.channel || "");
  if (!room || !ROOM_KINDS.has(meta.kind)) return null;
  if (room === `dm-${seatId}` || room.startsWith("session-")) return null;
  return room;
}

/** Lines that tell a seat woken from a room how its reply gets back there. */
export const PASS = "PASS";

/** A team-mode reply that means "nothing to add"; it is not posted. */
export function isPass(text) {
  return /^\s*PASS\.?\s*$/i.test(String(text || ""));
}

export function roomReplyLines(meta = {}) {
  if (!meta.channel || !ROOM_KINDS.has(meta.kind)) return [];
  const room = `#${meta.channel}`;
  const mention = `To bring in another member of ${room}, @mention their seat id in your reply; that wakes them here.`;
  const hop = meta.thread?.hop > 0
    ? [`@${meta.thread.from} mentioned you in ${room} (hop ${meta.thread.hop} of ${meta.thread.maxHops}). Answer them; @mention someone else only if they must act.`]
    : [];
  if (meta.kind === IMPLICIT && meta.teamMode) {
    return [
      `A human wrote in ${room} without mentioning anyone. Several members of ${room} were asked.`,
      `Reply only if you can help; otherwise reply with exactly ${PASS}. Roster-flow posts your text to ${room}, except ${PASS}. Do not use roster_report for this reply.`,
      mention,
    ];
  }
  if (meta.kind === IMPLICIT) {
    return [
      `A human wrote in ${room} without mentioning anyone. You are the seat answering for ${room}.`,
      `Reply in plain text, briefly, as yourself. Roster-flow posts your text to ${room}. Do not use roster_report for this reply.`,
      mention,
    ];
  }
  return [...hop, `Reply in plain text. Roster-flow posts your text to ${room}.`, mention];
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
          meta.jobId
            ? `Job ${meta.jobId}. Finish with roster_report jobId=${meta.jobId}. Park with roster_ask_human jobId=${meta.jobId}.`
            : "",
          ...roomReplyLines(meta),
          ...(meta.context?.length
            ? [`Messages in #${meta.channel} since your last turn there (oldest first):`, ...meta.context]
            : []),
          `Message from ${meta.from || "bus"} (${meta.kind || "send_message"}):`,
          text,
          meta.kind === IMPLICIT
            ? "Answer that message in plain text. Use roster_send_message / roster_handoff only if they asked for work another seat owns."
            : "Use roster_send_message / roster_handoff / roster_report to talk to peers. Do not impersonate them.",
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
  const explicit = String(seat?.model || "").trim();
  const chain = modelChainForSeat(seat, team).filter((ref) => {
    const providerID = String(ref || "").split("/")[0];
    if (isBuiltinProvider(providerID) && String(ref) !== explicit) return false;
    return true;
  });
  const loaded = await deps.loadedModels(kind).catch(() => null);
  const resolved = chain.length ? chain.map((m) => resolveUsableModel(seat, m, loaded)) : [resolveUsableModel(seat, undefined, loaded)];
  // Sending a model OpenCode did not load fails inside the serve (prompt_async
  // still returns 204), so the seat would never reply. Stop here instead.
  // The built-in `opencode` provider is not a fallback: it is loaded but unconfigured.
  const refs = resolved.filter((m) => {
    if (!m?.providerID || !m?.modelID) return false;
    if (isBuiltinProvider(m.providerID) && `${m.providerID}/${m.modelID}` !== explicit) return false;
    return isLoadedModel(loaded, m.providerID, m.modelID) !== false;
  });
  if (!refs.length) {
    const want = modelRef(resolved[0]) || seat.model || "the seat model";
    const have = loadedProviderIds(loaded);
    const err = new Error(
      `${want} is not loaded by the ${kind} OpenCode harness (loaded: ${have.join(", ") || "none"}). Check ${String(want).split("/")[0]} in Settings → Providers, then restart the harness.`,
    );
    err.code = "PROVIDER_NOT_LOADED";
    err.status = 409;
    throw err;
  }
  let lastErr = null;
  for (const model of refs) {
    const ref = modelRef(model);
    if (ref && modelAllowedInConfig(ref)) {
      try {
        syncSeatAgent({ ...seat, model: ref });
      } catch {
        /* the prompt still carries the model if the agent file cannot be written */
      }
    }
    const body = promptBody(seat, to, text, meta, {
      providerID: model.providerID,
      modelID: model.modelID,
    });
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
      if (err.status === 404) throw err;
      const described = describeOpenCodeError(err, { model: modelRef(model), kind });
      lastErr = Object.assign(new Error(described.message), { status: described.status, code: described.code, cause: err });
    }
  }
  if (lastErr) throw lastErr;
  return { sessionId, seat: to, model: refs[0], harness: kind };
}

function meterPromptedWake(to, text, meta, result, started) {
  mutate((s) => {
    meterWake(s, {
      seatId: to,
      runId: meta.runId,
      model: result?.model,
      inputTokens: estimateTokens(text) + 480,
      outputTokens: 200,
      ms: Date.now() - started,
      source: meta.kind || "wake",
      channelId: meta.channel || null,
      threadId: meta.thread?.threadId || null,
    });
  });
  const live = (getState().seats || []).find((s) => s.id === to);
  if (live?.pauseReason === "budget") return { ...result, paused: true, reason: "budget" };
  return result;
}

async function finishPrompted(to, seat, text, runMeta, result, started) {
  const metered = meterPromptedWake(to, text, runMeta, result, started);
  if (metered.paused) {
    noteRun(runMeta.runId, to, "blocked", "budget");
    await announceWake(runMeta, `${seat.name} did not keep run ${runMeta.runId}: the seat is paused (budget).`);
    return { ...metered, runId: runMeta.runId, started: false };
  }
  noteRun(runMeta.runId, to, "running", null);
  return { ...metered, runId: runMeta.runId, started: true };
}

function bindRun(meta, seatId) {
  const runId = meta.runId || uid("run");
  noteRun(runId, seatId, "starting", null);
  return { ...meta, runId };
}

export async function wakeSeat(to, text, meta = {}) {
  if (String(to).startsWith("channel:")) return null;
  if (String(to).startsWith("team:")) {
    const target = teamWakeTarget(to, getState().teams || []);
    if (!target) {
      const runId = meta.runId || null;
      if (runId) noteRun(runId, null, "blocked", "team has no supervisor");
      await announceWake(meta, `${to} did not start a run: that team has no supervisor.`);
      return { error: "team has no supervisor", seat: to, runId, started: false };
    }
    return wakeSeat(target, text, { ...meta, via: to });
  }
  const seat = seatById(to);
  if (!seat) {
    const runId = meta.runId || null;
    if (runId) noteRun(runId, to, "blocked", "seat not found");
    await announceWake(meta, `${to} did not start a run: that seat does not exist.`);
    return { error: "seat not found", seat: to, runId, started: false };
  }
  if (seat.mcpGuest) {
    emit({
      scope: "chat",
      step: "seat.mcp-guest",
      seat: to,
      channel: meta.channel || null,
      detail: { origin: seat.origin || "mcp" },
    });
    if (meta.runId) noteRun(meta.runId, to, "blocked", "mcp guest");
    await announceWake(meta, `${seat.name} is an MCP guest. The wake notifies the chair and does not start an OpenCode run.`);
    return { guest: true, seat: to, origin: seat.origin || "mcp", runId: meta.runId || null, started: false };
  }
  if (seat.kind !== "bot") {
    if (meta.runId) noteRun(meta.runId, to, "blocked", "human");
    await announceWake(meta, `${seat.name} was notified. Human seats do not start an OpenCode run.`);
    return { human: true, seat: to, runId: meta.runId || null, started: false };
  }
  const runMeta = bindRun(meta, to);
  let blocked = null;
  mutate((s) => {
    const live = (s.seats || []).find((x) => x.id === to);
    blocked = wakeBlocked(s, live, runMeta);
  });
  if (blocked) {
    emit({
      level: "warn",
      scope: "chat",
      step: "seat.paused",
      seat: to,
      channel: runMeta.channel || null,
      detail: { reason: blocked.reason, runId: runMeta.runId },
    });
    noteRun(runMeta.runId, to, "blocked", blocked.reason);
    await announceWake(runMeta, `${seat.name} did not start run ${runMeta.runId}: the seat is paused (${blocked.reason}).`);
    return { paused: true, seat: to, reason: blocked.reason, runId: runMeta.runId, started: false };
  }
  if (!isOpenCodeAdapter(seat)) {
    const adapted = await wakeAdapter(seat, text, runMeta);
    const started = !adapted?.error && !adapted?.offline;
    noteRun(runMeta.runId, to, started ? "running" : "blocked", started ? null : adapted?.error || adapted?.reason || "adapter did not start");
    if (!started) {
      await announceWake(runMeta, `${seat.name} did not start run ${runMeta.runId}: ${adapted?.error || adapted?.reason || "the adapter did not start a run"}.`);
    }
    return { ...adapted, runId: runMeta.runId, started };
  }
  const kind = harnessKindForSeat(seat);
  const h = deps.harnessStatus(kind);
  if (h.harness !== "up") {
    emit({
      level: "warn",
      scope: "chat",
      step: "seat.offline",
      seat: to,
      channel: runMeta.channel || null,
      detail: { harness: kind },
    });
    noteRun(runMeta.runId, to, "blocked", "harness offline");
    await announceWake(runMeta, `${seat.name} did not start run ${runMeta.runId}: the ${kind} OpenCode harness is offline.`);
    return { offline: true, seat: to, harness: kind, runId: runMeta.runId, started: false };
  }
  const room = roomSessionChannel(runMeta, to);
  const context = room ? roomContext(getState(), to, room, { exclude: text }) : null;
  const promptMeta = context?.lines.length ? { ...runMeta, context: context.lines } : runMeta;
  const markRoom = (sessionId) => {
    if (room) setRoomSession(to, room, { cursor: context.cursor, lastWakeAt: new Date().toISOString() });
    else if (ROOM_KINDS.has(runMeta.kind) && runMeta.channel && !String(runMeta.channel).startsWith("session-")) {
      mutate((s) => {
        s.sessionRooms = { ...(s.sessionRooms || {}), [to]: runMeta.channel };
      });
    }
    return sessionId;
  };
  try {
    const started = Date.now();
    let sessionId = await ensureSeatSession(to, { channel: room });
    if (!sessionId) {
      noteRun(runMeta.runId, to, "blocked", "no session");
      await announceWake(runMeta, `${seat.name} did not start run ${runMeta.runId}: OpenCode did not open a session.`);
      return { error: "no session", seat: to, harness: kind, runId: runMeta.runId, started: false };
    }
    try {
      const result = await promptWithFallback(sessionId, seat, to, text, promptMeta);
      markRoom(sessionId);
      return finishPrompted(to, seat, text, runMeta, result, started);
    } catch (err) {
      if (err.status === 404) {
        if (room) dropRoomSession(to, room);
        else {
          mutate((s) => {
            const key = sessionKeyForKind(kind);
            if (s[key]) delete s[key][to];
          });
        }
        sessionId = await ensureSeatSession(to, { channel: room });
        if (!sessionId) {
          noteRun(runMeta.runId, to, "blocked", "no session");
          await announceWake(runMeta, `${seat.name} did not start run ${runMeta.runId}: OpenCode did not open a session.`);
          return { error: "no session after recreate", seat: to, harness: kind, runId: runMeta.runId, started: false };
        }
        const result = await promptWithFallback(sessionId, seat, to, text, promptMeta);
        markRoom(sessionId);
        return finishPrompted(to, seat, text, runMeta, result, started);
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
      channel: runMeta.channel || null,
      detail: { harness: kind, error, code: err.code || null },
    });
    noteRun(runMeta.runId, to, "blocked", error);
    await announceWake(runMeta, `${seat.name} did not start run ${runMeta.runId}: ${error}`);
    return { error, code: err.code || null, seat: to, harness: kind, runId: runMeta.runId, started: false };
  }
}

/** `sessionId` when given, else the seat's DM session. */
function sessionFor(seat, sessionId) {
  return sessionId || sessionMap(getState(), seat).sessions[seat.id] || null;
}

/** The latest turn failure (e.g. provider 401) since `since` ms in the session, or null. */
export async function pullFailure(to, since = 0, { sessionId: wanted = null } = {}) {
  const seat = seatById(to);
  if (!seat) return null;
  const kind = harnessKindForSeat(seat);
  const sessionId = sessionFor(seat, wanted);
  if (!sessionId) return null;
  try {
    return lastAssistantFailure(await deps.sessionMessages(sessionId, kind), { since, kind });
  } catch {
    return null;
  }
}

/** Correct the wake's estimated usage row with the tokens OpenCode reported for the turn. */
export async function meterTurn(to, { sessionId = null, since = 0, runId = null } = {}) {
  const seat = seatById(to);
  if (!seat || !runId) return null;
  const id = sessionFor(seat, sessionId);
  if (!id) return null;
  const usage = turnUsage(await deps.sessionMessages(id, harnessKindForSeat(seat)), since);
  if (!usage) return null;
  let out = null;
  mutate((s) => {
    out = applyTurnUsage(s, { seatId: to, runId, usage });
  });
  if (out) {
    emit({
      scope: "chat",
      step: "seat.metered",
      seat: to,
      detail: { runId, tokens: out.row.tokens, cost: usage.cost, messages: usage.messages },
    });
  }
  return out;
}

export async function pullAssistant(to, { sessionId: wanted = null } = {}) {
  const seat = seatById(to);
  if (!seat) return [];
  const kind = harnessKindForSeat(seat);
  const sessionId = sessionFor(seat, wanted);
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
