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
  watchProviderTurn,
  ensure,
} from "./harness.mjs";
import { isBuiltinProvider, isLoadedModel, loadedProviderIds, resolveUsableModel } from "./providers.mjs";
import { teamWakeTarget } from "./teams.mjs";
import { modelChainForSeat } from "./models.mjs";
import { CONDUCTOR_ID } from "./mentions.mjs";
import { emit } from "./trace.mjs";
import { goalPackLines } from "./goals.mjs";
import { wakeBlocked } from "./seats.mjs";
import { isOpenCodeAdapter, wakeAdapter } from "./adapters.mjs";
import { estimateTokens, meterWake } from "./budget.mjs";
import { dropRoomSession, liveRoomSession, roomContext, roomSessionTitle, setRoomSession } from "./room-sessions.mjs";
import { agentNeedsServeRestart, syncSeatAgent } from "./agents.mjs";

export const deps = {
  createSession,
  promptSession,
  sessionMessages,
  harnessStatus,
  loadedModels,
  watchProviderTurn,
  ensure,
  agentNeedsServeRestart,
};

function modelRef(model) {
  return model?.providerID ? `${model.providerID}/${model.modelID || ""}` : String(model || "");
}

function sessionMap(state, seat) {
  const key = sessionKeyForKind(harnessKindForSeat(seat));
  return { key, sessions: state[key] || {} };
}

const pendingWakes = new WeakMap();
const inflightWakes = new Map();

export function publishedWake(woke) {
  return {
    seat: woke?.seat || null,
    runId: woke?.runId ?? null,
    started: woke?.started === true,
  };
}

export function blockLatestRun(seatId, reason) {
  const runs = getState().runs || [];
  // A run that already reached the provider stays running. Only an in-flight
  // start can be blocked from here.
  const run = [...runs].reverse().find((r) => r.seatId === seatId && r.status === "starting");
  if (!run) return null;
  noteRun(run.id, seatId, "blocked", reason || "did not start");
  return run.id;
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

const restartWaiting = new Set();

function serveBusy(kind, exceptRunId) {
  const seats = getState().seats || [];
  return (getState().runs || []).some((run) => {
    if (!run || run.id === exceptRunId || restartWaiting.has(run.id)) return false;
    // A turn that has not finished owns the serve. The HTTP started flag is
    // not consulted: starting and running are both busy.
    if (run.status !== "starting" && run.status !== "running") return false;
    const seat = seats.find((item) => item.id === run.seatId);
    if (!seat) return true;
    return harnessKindForSeat(seat) === kind;
  });
}

const restartChains = new Map();

async function restartWhenIdle(kind, runId, stillNeeded) {
  const prev = restartChains.get(kind) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  restartChains.set(kind, prev.then(() => gate, () => gate));
  await prev.catch(() => undefined);
  try {
    if (!stillNeeded()) return;
    await waitForIdleServe(kind, runId);
    if (!stillNeeded()) return;
    await (deps.ensure || ensure)({ kind, forceRestart: true });
  } finally {
    release();
  }
}

/** Hold a serve restart until every other run on this harness has finished. */
export async function waitForIdleServe(kind, exceptRunId, timeoutMs = Number(process.env.ROSTER_RESTART_WAIT_MS) || 90000) {
  const start = Date.now();
  while (serveBusy(kind, exceptRunId)) {
    if (Date.now() - start >= timeoutMs) {
      const err = new Error("the harness is busy with another run, so this seat was not loaded");
      err.status = 409;
      err.code = "HARNESS_BUSY";
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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
export function roomReplyLines(meta = {}) {
  if (!meta.channel || !ROOM_KINDS.has(meta.kind)) return [];
  const room = `#${meta.channel}`;
  const mention = `To bring in another member of ${room}, @mention their seat id in your reply; that wakes them here.`;
  const hop = meta.thread?.hop > 0
    ? [`@${meta.thread.from} mentioned you in ${room} (hop ${meta.thread.hop} of ${meta.thread.maxHops}). Answer them; @mention someone else only if they must act.`]
    : [];
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

async function promptWithFallback(sessionId, seat, to, text, meta, room = null) {
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
    if (isBuiltinProvider(m.providerID)) return false;
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
  let sid = sessionId;
  const first = refs[0];
  const seeded = { ...seat, model: modelRef(first) || seat.model || "" };
  if ((deps.agentNeedsServeRestart || agentNeedsServeRestart)(seeded, kind)) {
    // OpenCode reads agents at process start. A seat hired after boot is invisible
    // until the serve is restarted. Restarting kills every in-flight stream, so
    // this seat waits until the serve is idle instead of restarting immediately.
    syncSeatAgent(seeded);
    restartWaiting.add(meta.runId);
    try {
      await restartWhenIdle(kind, meta.runId, () => (deps.agentNeedsServeRestart || agentNeedsServeRestart)(seeded, kind));
    } finally {
      restartWaiting.delete(meta.runId);
    }
    if (room) dropRoomSession(to, room);
    else {
      mutate((s) => {
        const key = sessionKeyForKind(kind);
        if (s[key]) delete s[key][to];
      });
    }
    sid = await ensureSeatSession(to, { channel: room });
    if (!sid) {
      const err = new Error("no session");
      err.status = 409;
      throw err;
    }
  }
  let lastErr = null;
  for (const model of refs) {
    const body = promptBody(seat, to, text, meta, {
      providerID: model.providerID,
      modelID: model.modelID,
    });
    const askedAt = Date.now();
    const watch = (deps.watchProviderTurn || watchProviderTurn)(sid, kind, undefined, { askedAt });
    try {
      let outcome;
      if (watch.unwatched) {
        await deps.promptSession(sid, body, kind);
        outcome = await watch;
      } else {
        let promptError = null;
        const prompt = deps.promptSession(sid, body, kind).catch((err) => {
          promptError = err;
          return null;
        });
        outcome = await Promise.race([
          watch,
          prompt.then(() => (promptError ? Promise.reject(promptError) : watch)),
        ]);
      }
      if (!outcome?.reached || outcome.error) {
        const err = new Error(outcome?.error || "the provider did not respond in time");
        err.code = outcome?.error ? outcome.code || "PROVIDER_ERROR" : "PROVIDER_TIMEOUT";
        err.status = 502;
        if (!outcome?.done && !outcome?.cancelled) {
          err.lateReply = watch.rest;
          err.askedAt = askedAt;
          err.sid = sid;
          err.kind = kind;
        }
        throw err;
      }
      noteRun(meta.runId, to, "running", null);
      let final = outcome;
      if (!outcome.done && watch.rest) final = await watch.rest;
      if (final?.error && !final?.text && !outcome.text) {
        const err = new Error(final.error);
        err.code = final.code || "PROVIDER_ERROR";
        err.status = 502;
        throw err;
      }
      let providerText = final?.text || outcome.text || "";
      let messageId = final?.messageId || outcome.messageId || null;
      try {
        // A reused session still holds earlier turns. Keep only assistant messages created after this prompt.
        const replies = assistantText(await deps.sessionMessages(sid, kind)).filter((m) => m.text);
        const dated = replies.some((m) => m.created);
        const fresh = dated ? replies.filter((m) => m.created && m.created >= askedAt) : replies.slice(-1);
        const polled = fresh.map((m) => m.text).join("\n");
        if (polled) providerText = polled;
        if (fresh.length) messageId = fresh[fresh.length - 1].id || messageId;
      } catch {
        /* the streamed text is enough */
      }
      emit({
        scope: "chat",
        step: "seat.prompted",
        seat: to,
        channel: meta.channel || null,
        detail: { sessionId: sid, model, harness: kind },
      });
      return { sessionId: sid, seat: to, model, harness: kind, providerText, messageId };
    } catch (err) {
      if (!err.lateReply) watch.cancel?.();
      if (err.status === 404) throw err;
      const described = describeOpenCodeError(err, { model: modelRef(model), kind });
      lastErr = Object.assign(new Error(described.message), {
        status: described.status,
        code: described.code || err.code,
        cause: err,
        lateReply: err.lateReply,
        askedAt: err.askedAt,
        sid: err.sid,
        kind: err.kind,
      });
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
    });
  });
  const live = (getState().seats || []).find((s) => s.id === to);
  if (live?.pauseReason === "budget") return { ...result, paused: true, reason: "budget" };
  return result;
}

async function postSeatReply(to, seat, runMeta, reply, messageId) {
  if (!reply || !runMeta?.channel || !runMeta.runId) return;
  const { postMessage, threadCaption } = await import("./chat.mjs");
  const existing = (getState().messages || []).find(
    (m) =>
      m.channel === runMeta.channel &&
      m.seatId === to &&
      !m.system &&
      ((m.runId === runMeta.runId && m.text === reply) || (messageId && m.sessionId === messageId)),
  );
  if (existing) {
    if (!existing.runId || (messageId && !existing.sessionId)) {
      mutate((s) => {
        const msg = (s.messages || []).find((m) => m.id === existing.id);
        if (!msg) return;
        if (!msg.runId) msg.runId = runMeta.runId;
        if (messageId && !msg.sessionId) msg.sessionId = messageId;
      });
    }
    return;
  }
  postMessage(runMeta.channel, seat.name, "bot", reply, {
    seatId: to,
    mirrored: true,
    runId: runMeta.runId,
    ...(messageId ? { sessionId: messageId } : {}),
    ...threadCaption(to, runMeta.channel),
  });
}

async function recoverLateReply(to, seat, runMeta, reply, messageId) {
  const run = (getState().runs || []).find((item) => item.id === runMeta.runId);
  if (!run || (run.status !== "blocked" && run.status !== "starting")) return;
  noteRun(runMeta.runId, to, "running", null);
  await postSeatReply(to, seat, runMeta, reply, messageId);
  noteRun(runMeta.runId, to, "done", null);
}

async function finishPrompted(to, seat, text, runMeta, result, started) {
  const metered = meterPromptedWake(to, text, runMeta, result, started);
  if (metered.paused) {
    noteRun(runMeta.runId, to, "blocked", "budget");
    await announceWake(runMeta, `${seat.name} did not keep run ${runMeta.runId}: the seat is paused (budget).`);
    return { ...metered, runId: runMeta.runId, started: false };
  }
  noteRun(runMeta.runId, to, "running", null);
  await postSeatReply(to, seat, runMeta, result?.providerText, result?.messageId);
  noteRun(runMeta.runId, to, "done", null);
  return { ...metered, runId: runMeta.runId, started: true };
}

function bindRun(meta, seatId) {
  const runId = meta.runId || uid("run");
  noteRun(runId, seatId, "starting", null);
  return { ...meta, runId };
}

export function wakeSeat(to, text, meta = {}) {
  const key = String(to || "");
  if (key && !key.startsWith("channel:") && !key.startsWith("team:")) {
    const existing = inflightWakes.get(key);
    if (existing) return existing;
    const pending = wakeSeatBody(to, text, meta);
    inflightWakes.set(key, pending);
    const clear = () => {
      if (inflightWakes.get(key) === pending) inflightWakes.delete(key);
    };
    pending.then(clear, clear);
    return pending;
  }
  return wakeSeatBody(to, text, meta);
}

async function wakeSeatBody(to, text, meta = {}) {
  // Only the DM session is mirrored into the room it was last woken from; room wakes have their own session.
  if (meta.channel && !String(to).startsWith("channel:") && !String(to).startsWith("team:") && !roomSessionChannel(meta, String(to))) {
    const { rememberSessionRoom } = await import("./chat.mjs");
    rememberSessionRoom(String(to), meta.channel);
  }
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
      const result = await promptWithFallback(sessionId, seat, to, text, promptMeta, room);
      markRoom(result?.sessionId || sessionId);
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
        const result = await promptWithFallback(sessionId, seat, to, text, promptMeta, room);
        markRoom(result?.sessionId || sessionId);
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
    if (err.lateReply) {
      Promise.resolve(err.lateReply)
        .then(async (final) => {
          let text = final?.text || "";
          let messageId = final?.messageId || null;
          if (err.sid) {
            try {
              const rows = assistantText(await deps.sessionMessages(err.sid, err.kind)).filter(
                (row) => row.text && (!row.created || !err.askedAt || row.created >= err.askedAt),
              );
              if (rows.length) {
                text = rows.map((row) => row.text).join("\n");
                messageId = rows[rows.length - 1].id || messageId;
              }
            } catch {
              /* keep the streamed text */
            }
          }
          if (text) return recoverLateReply(to, seat, runMeta, text, messageId);
          return null;
        })
        .catch(() => undefined);
    }
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
