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
  seatModelGap,
  describeOpenCodeError,
  lastAssistantFailure,
  turnUsage,
  sessionChildren,
  sessionAgent,
  watchProviderTurn,
  ensure,
} from "./harness.mjs";
import { isBuiltinProvider, isLoadedModel, loadedProviderIds, parseModelRef, resolveUsableModel } from "./providers.mjs";
import { teamWakeTarget } from "./teams.mjs";
import { modelChainForSeat } from "./models.mjs";
import { CONDUCTOR_ID } from "./mentions.mjs";
import { channelResponseModel, resolveMembers } from "./channels.mjs";
import { emit } from "./trace.mjs";
import { goalPackLines } from "./goals.mjs";
import { wakeBlocked } from "./seats.mjs";
import { isOpenCodeAdapter, wakeAdapter } from "./adapters.mjs";
import { applyTurnUsage, estimateTokens, meterChildSession, meterWake, seatOverBudget } from "./budget.mjs";
import { delegateReports } from "./agents.mjs";
import { dropRoomSession, liveRoomSession, roomContext, roomSessionTitle, setRoomSession } from "./room-sessions.mjs";
import { stopThinking } from "./thinking.mjs";
import { agentNeedsServeRestart, syncSeatAgent } from "./agents.mjs";

export const deps = {
  createSession,
  promptSession,
  sessionMessages,
  sessionChildren,
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
const wakeOutcomes = new Map();

function wakeSlot(runId) {
  const key = String(runId || "");
  let slot = wakeOutcomes.get(key);
  if (!slot) {
    slot = { failurePosted: false, replyPosted: false };
    if (key) {
      wakeOutcomes.set(key, slot);
      if (wakeOutcomes.size > 500) wakeOutcomes.delete(wakeOutcomes.keys().next().value);
    }
  }
  return slot;
}

/** Hard stop for a turn that is still open after the provider-start window. Under the 5 minute thinking stale drop. */
export function wakeDeadlineMs() {
  const n = Number(process.env.ROSTER_WAKE_DEADLINE_MS);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

function terminalTurnError(message, code) {
  const err = new Error(message);
  err.code = code;
  err.terminal = true;
  err.status = 502;
  return err;
}

function isEmptyTurn(verdict) {
  return Boolean(verdict?.done) && verdict.empty === true && !verdict.error && !String(verdict.text || "").trim();
}

function wakeFailureLine(seat, runMeta, err) {
  if (err?.code === "NO_REPLY") return `${seat.name} finished without a reply`;
  if (err?.code === "PROVIDER_DEADLINE") return `${seat.name} did not reply: the provider timed out`;
  return `${seat.name} did not start run ${runMeta.runId}: ${err?.message || err}`;
}

async function freshAssistantText(sid, kind, askedAt, { implicit = false } = {}) {
  if (!sid) return { text: "", messageId: null, dropped: [], reasoningOnly: false };
  try {
    const raw = await deps.sessionMessages(sid, kind);
    const reasoningOnly = droppedReasoningReason(raw, askedAt) === DROPPED_REASONING;
    const replies = assistantText(raw).filter((m) => m.text);
    const dated = replies.some((m) => m.created);
    const fresh = dated ? replies.filter((m) => m.created && m.created >= askedAt) : replies.slice(-1);
    if (implicit) {
      const picked = selectImplicitReply(fresh);
      return {
        text: picked.post?.text || "",
        messageId: picked.post?.id || null,
        dropped: picked.dropped,
        reasoningOnly: reasoningOnly || (!picked.post && picked.dropped.some((item) => item.reason === "reasoning")),
      };
    }
    return {
      text: fresh.map((m) => m.text).join("\n"),
      messageId: fresh.length ? fresh[fresh.length - 1].id || null : null,
      dropped: [],
      reasoningOnly,
    };
  } catch {
    return { text: "", messageId: null, dropped: [], reasoningOnly: false };
  }
}

/** The reached-but-not-done path. A hung provider must not leave `await watch.rest` pending forever. */
async function awaitTurnRest(watch) {
  const ms = wakeDeadlineMs();
  let timer;
  let timedOut = false;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve({ deadline: true, timedOut: true, done: true, reached: false, text: "" });
    }, ms);
    timer.unref?.();
  });
  try {
    const final = await Promise.race([Promise.resolve(watch.rest), deadline]);
    if (!timedOut) return final;
    try {
      watch.cancel?.();
    } catch {
      /* the listener is already gone */
    }
    const snapped = await Promise.race([
      Promise.resolve(watch.rest).catch(() => null),
      new Promise((resolve) => setTimeout(resolve, 0)),
    ]);
    const text = String(snapped?.text || "").trim();
    if (text) return { ...snapped, text, timedOut: false, deadline: false };
    return { deadline: true, timedOut: true, done: true, reached: false, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

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

/** Shown in #ship and on the API response when a call had no room and no session room. */
export const SHIP_FALLBACK_NOTE = "No room was given, so this was posted to #ship.";

/**
 * Room for POST /messages and /bus/send: explicit channel, then the session's room,
 * then #ship. The #ship step is the documented last resort, and it is not silent.
 */
export function roomForApiCall({ channel, sessionRoom } = {}) {
  const explicit = String(channel || "").trim();
  if (explicit) return { channel: explicit, note: null };
  const known = String(sessionRoom || "").trim();
  if (known) return { channel: known, note: null };
  return { channel: "ship", note: SHIP_FALLBACK_NOTE };
}

export function postBus({ from, to, kind = "send_message", text, runId, wake = false, channel, jobId }) {
  const waking = Boolean(wake) && !String(to || "").startsWith("channel:");
  const resolvedRunId = runId || (waking ? uid("run") : null);
  // Heartbeats and routines have no room, so a wake with none still uses #ship.
  // API calls resolve the room first and pass it, with SHIP_FALLBACK_NOTE when they fall back.
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
function sessionCreateBody(seat, title, modelRefOverride = null) {
  const parsed = parseModelRef(modelRefOverride || seat?.model);
  return {
    title,
    agent: seat.id,
    ...(parsed ? { model: { providerID: parsed.providerID, id: parsed.modelID } } : {}),
  };
}

/** Channel override for a new room session, or null to keep the seat model. */
async function roomSessionModel(seat, channel, kind) {
  if (!channel) return null;
  const ch = (getState().channels || []).find((c) => c.id === channel);
  if (!ch) return null;
  const loaded = await deps.loadedModels(kind).catch(() => null);
  return channelResponseModel(ch, getState(), Array.isArray(loaded) ? loaded : null);
}

export async function ensureSeatSession(to, { channel = null } = {}) {
  const seat = seatById(to);
  if (!seat || seat.kind !== "bot") return null;
  const kind = harnessKindForSeat(seat);
  const h = deps.harnessStatus(kind);
  if (h.harness !== "up") return null;
  if (channel) {
    const entry = liveRoomSession(getState(), seat, channel);
    if (entry) return entry.sessionId;
    const model = await roomSessionModel(seat, channel, kind);
    const ses = await deps.createSession(sessionCreateBody(seat, roomSessionTitle(to, channel), model), kind);
    const id = ses?.id || ses?.sessionID;
    if (!id) return null;
    setRoomSession(to, channel, { sessionId: id, harness: kind, cursor: null, lastWakeAt: new Date().toISOString() });
    emit({ scope: "harness", step: "session.room", seat: to, channel, detail: { sessionId: id, harness: kind } });
    return id;
  }
  const { key, sessions } = sessionMap(getState(), seat);
  let sessionId = sessions[to];
  if (sessionId) return sessionId;
  const ses = await deps.createSession(sessionCreateBody(seat, `roster:${to}`), kind);
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

/** Tools an implicit room reply must not call. OpenCode disables each named tool for that prompt. */
export const IMPLICIT_ROOM_TOOLS_OFF = Object.fromEntries(
  [
    "bash",
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "list",
    "webfetch",
    "websearch",
    "task",
    "todowrite",
    "todoread",
    "skill",
    "question",
    "batch",
    "codesearch",
    "lsp",
    "apply_patch",
    "multiedit",
    "roster_list_seats",
    "roster_send_message",
    "roster_handoff",
    "roster_report",
    "roster_ask_human",
    "roster_knowledge",
    "roster_inbox",
    "roster_task_create",
    "roster_task_claim",
    "roster_task_complete",
    "roster_propose_org",
  ].map((name) => [name, false]),
);

export function implicitRoomReply(meta = {}) {
  return meta.kind === IMPLICIT && !meta.teamMode;
}

/** Lead and members already in the room, so the reply does not look them up. */
export function roomRosterLine(channelId, state = getState()) {
  const channel = (state?.channels || []).find((c) => c.id === channelId);
  const members = channel ? resolveMembers(channel, state) : [];
  const lead = members.find((s) => s.id === channel?.leadSeatId) || null;
  const fmt = (s) => `@${s.id} (${s.name || s.id}${s.role ? `, ${s.role}` : ""})`;
  const names = members.map(fmt);
  return `Lead: ${lead ? fmt(lead) : "none"}. Members: ${names.length ? names.join(", ") : "none"}.`;
}

/** A reasoning-only turn is finished, with nothing posted to the room. */
export const DROPPED_REASONING = "dropped_reasoning_only";

function partBody(part) {
  if (!part) return "";
  if (typeof part === "string") return part;
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  return "";
}

function messagePartList(msg) {
  const raw = msg?.parts || msg?.info?.parts || msg?.content || [];
  return Array.isArray(raw) ? raw : [raw];
}

/** `dropped_reasoning_only` when fresh assistant parts are reasoning or think-blocks and nothing else. */
export function droppedReasoningReason(messages, askedAt = 0) {
  let saw = false;
  for (const msg of messages || []) {
    const role = msg.role || msg.info?.role;
    if (role && role !== "assistant") continue;
    const created = Number(msg.info?.time?.created || msg.time?.created || 0);
    if (askedAt && created && created < askedAt) continue;
    for (const part of messagePartList(msg)) {
      const type = String(part?.type || "");
      const body = partBody(part);
      const visible = !type || type === "text" || type === "output_text" ? visibleRoomText(body) : "";
      if (visible) return "";
      if (/reason|think|thought/i.test(type) || (/<think/i.test(body) && !visibleRoomText(body))) saw = true;
    }
  }
  return saw ? DROPPED_REASONING : "";
}

const decidedDropIds = new Set();

/** Test isolation. A message id is decided once for the life of the process. */
export function resetDroppedReasoning() {
  decidedDropIds.clear();
}

function runStartMs(run) {
  const start = Date.parse(run?.at || "");
  return Number.isFinite(start) ? start : 0;
}

/** The run that was open for this seat when the message was created, else the latest open run. */
function runThatProduced(seatId, created) {
  const runs = (getState().runs || []).filter((item) => item?.seatId === seatId);
  const stamp = Number(created || 0);
  if (stamp) {
    const eligible = runs.filter((item) => runStartMs(item) && runStartMs(item) <= stamp);
    eligible.sort((a, b) => runStartMs(a) - runStartMs(b));
    return eligible.at(-1) || null;
  }
  const open = runs.filter((item) => item.status === "running" || item.status === "starting");
  return open.at(-1) || null;
}

/**
 * Stamp the run that produced a reasoning-only message.
 * Each message id is decided once: a later sync does not re-stamp or log again,
 * and a newer open run is left alone.
 */
export function recordDroppedReasoning(seatId, channelId = null, messages = []) {
  const fresh = [];
  for (const msg of messages || []) {
    const id = String(msg?.id || "");
    if (!id || decidedDropIds.has(id)) continue;
    decidedDropIds.add(id);
    fresh.push({ id, created: Number(msg.created || 0) });
  }
  if (!fresh.length) return;
  for (const msg of fresh) {
    const run = runThatProduced(seatId, msg.created);
    const open = run && (run.status === "running" || run.status === "starting");
    emit({
      level: "warn",
      scope: "chat",
      step: "seat.unposted",
      seat: seatId,
      channel: channelId,
      detail: { reason: DROPPED_REASONING, runId: run?.id || null, messageId: msg.id },
    });
    if (open) noteRun(run.id, seatId, "done", DROPPED_REASONING);
  }
}

/** Drop reasoning markup and max-steps reports. Empty means there is nothing to post. */
export function visibleRoomText(text) {
  const raw = String(text || "").replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  return raw
    .split("\n")
    .filter((line) => !/max(?:imum)?\s+steps/i.test(line))
    .join("\n")
    .trim();
}

/** Why a chunk must not be posted, or "" when it still has a reply. */
export function suppressedRoomReason(text) {
  const raw = String(text || "").trim();
  if (!raw) return "empty";
  if (/max(?:imum)?\s+steps/i.test(raw) && !visibleRoomText(raw)) return "max-steps";
  if (!visibleRoomText(raw)) return "reasoning";
  return "";
}

/** The one implicit reply to post, plus every other chunk and why it was dropped. */
export function selectImplicitReply(parts) {
  const dropped = [];
  let post = null;
  for (const part of parts || []) {
    const text = visibleRoomText(part?.text);
    if (!text || post) {
      dropped.push({ id: part?.id || null, reason: !text ? suppressedRoomReason(part?.text) || "empty" : "extra" });
      continue;
    }
    post = { ...part, text };
  }
  return { post, dropped };
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
      roomRosterLine(meta.channel, meta.state),
      `Reply in plain text, briefly, as yourself. One or two sentences only. Do not use tools. Roster-flow posts your text to ${room}. Do not use roster_report for this reply.`,
      mention,
    ];
  }
  return [...hop, `Reply in plain text. Roster-flow posts your text to ${room}.`, mention];
}

/** Supervisors are told which direct reports they can run through the `task` tool right now. */
export function delegationLines(seat, state = getState()) {
  const reports = delegateReports(seat, state);
  if (!reports.length) return [];
  const seats = state.seats || [];
  const awake = [];
  const away = [];
  for (const id of reports) {
    const s = seats.find((x) => x.id === id);
    if (s.status === "paused" || seatOverBudget(s)) away.push(`${id} (${s.pauseReason === "budget" || seatOverBudget(s) ? "over budget" : "paused"})`);
    else awake.push(id);
  }
  return [
    awake.length
      ? `You can delegate inside this turn with the task tool. Set subagent_type to the seat id of a direct report: ${awake.join(", ")}. Their work is metered against their own budgets.`
      : "None of your direct reports can take a task right now.",
    away.length ? `Do not delegate to: ${away.join(", ")}.` : "",
  ];
}

export function promptBody(seat, to, text, meta, model) {
  const pack = goalPackLines(getState(), { seat, runId: meta.runId });
  const implicit = implicitRoomReply(meta);
  return {
    agent: to,
    model,
    ...(implicit ? { tools: IMPLICIT_ROOM_TOOLS_OFF } : {}),
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
          ...delegationLines(seat),
          meta.jobId
            ? `Job ${meta.jobId}. Finish with roster_report jobId=${meta.jobId}. Park with roster_ask_human jobId=${meta.jobId}.`
            : "",
          ...roomReplyLines(meta),
          ...(meta.context?.length
            ? [`Messages in #${meta.channel} since your last turn there (oldest first):`, ...meta.context]
            : []),
          `Message from ${meta.from || "bus"} (${meta.kind || "send_message"}):`,
          text,
          implicit
            ? "Answer in one or two sentences of plain text. Do not call tools."
            : meta.kind === IMPLICIT
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
  let refs = resolved.filter((m) => {
    if (!m?.providerID || !m?.modelID) return false;
    if (isBuiltinProvider(m.providerID)) return false;
    return isLoadedModel(loaded, m.providerID, m.modelID) !== false;
  });
  if (room) {
    const channel = (state.channels || []).find((c) => c.id === room);
    const pick = channel ? channelResponseModel(channel, state, Array.isArray(loaded) ? loaded : null) : null;
    if (pick) {
      const parsed = resolveUsableModel(seat, pick, loaded);
      const usable =
        parsed?.providerID &&
        parsed?.modelID &&
        !isBuiltinProvider(parsed.providerID) &&
        isLoadedModel(loaded, parsed.providerID, parsed.modelID) !== false;
      if (usable) refs = [parsed];
    }
  }
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
  const implicit = implicitRoomReply(meta);
  const unpostedReasoning = (sid, model, messageId = null) => ({
    sessionId: sid,
    seat: to,
    model,
    harness: kind,
    providerText: "",
    messageId,
    unposted: true,
    dropReason: DROPPED_REASONING,
  });
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
      if (isEmptyTurn(outcome)) {
        const polled = await freshAssistantText(sid, kind, askedAt, { implicit });
        if (polled.text) outcome = { ...outcome, reached: true, text: polled.text, messageId: polled.messageId || outcome.messageId, empty: false };
        else if (implicit && polled.reasoningOnly) return unpostedReasoning(sid, model);
        else throw terminalTurnError("finished without a reply", "NO_REPLY");
      }
      if (!outcome?.reached || outcome.error) {
        const err = new Error(outcome?.error || "the provider did not respond in time");
        err.code = outcome?.error ? outcome.code || "PROVIDER_ERROR" : "PROVIDER_TIMEOUT";
        err.status = 502;
        if (!outcome?.done && !outcome?.cancelled) {
          err.lateReply = watch.rest;
          err.cancelWatch = () => watch.cancel?.();
          err.askedAt = askedAt;
          err.sid = sid;
          err.kind = kind;
        }
        throw err;
      }
      noteRun(meta.runId, to, "running", null);
      let final = outcome;
      if (!outcome.done && watch.rest) final = await awaitTurnRest(watch);
      if (final?.timedOut && !String(final.text || outcome.text || "").trim()) {
        const polled = await freshAssistantText(sid, kind, askedAt, { implicit });
        if (polled.text) final = { ...final, text: polled.text, messageId: polled.messageId, timedOut: false };
        else if (implicit && polled.reasoningOnly) return unpostedReasoning(sid, model);
        else throw terminalTurnError("the provider timed out", "PROVIDER_DEADLINE");
      }
      if (final?.error && !final?.text && !outcome.text) {
        const err = new Error(final.error);
        err.code = final.code || "PROVIDER_ERROR";
        err.status = 502;
        throw err;
      }
      if (isEmptyTurn(final)) {
        const polled = await freshAssistantText(sid, kind, askedAt, { implicit });
        if (polled.text) final = { ...final, text: polled.text, messageId: polled.messageId || final.messageId, empty: false };
        else if (implicit && polled.reasoningOnly) return unpostedReasoning(sid, model);
        else throw terminalTurnError("finished without a reply", "NO_REPLY");
      }
      let providerText = final?.text || outcome.text || "";
      let messageId = final?.messageId || outcome.messageId || null;
      const polled = await freshAssistantText(sid, kind, askedAt, { implicit });
      if (polled.text) {
        providerText = polled.text;
        messageId = polled.messageId || messageId;
      }
      if (implicit) {
        const rawReply = String(providerText || "");
        providerText = visibleRoomText(providerText);
        for (const drop of polled.dropped || []) {
          emit({ level: "warn", scope: "chat", step: "seat.unposted", seat: to, channel: meta.channel || null, detail: drop });
        }
        if (!String(providerText || "").trim()) {
          const why = polled.reasoningOnly ? DROPPED_REASONING : suppressedRoomReason(rawReply);
          if (why === DROPPED_REASONING || why === "reasoning" || why === "max-steps") {
            const dropReason = why === "max-steps" ? "max-steps" : DROPPED_REASONING;
            emit({
              level: "warn",
              scope: "chat",
              step: "seat.unposted",
              seat: to,
              channel: meta.channel || null,
              detail: { reason: dropReason, runId: meta.runId || null },
            });
            return { ...unpostedReasoning(sid, model, messageId), dropReason };
          }
          throw terminalTurnError("finished without a reply", "NO_REPLY");
        }
      }
      if (!String(providerText || "").trim() && !outcome.unwatched) {
        throw terminalTurnError("finished without a reply", "NO_REPLY");
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
      if (err.terminal || err.status === 404) throw err;
      const described = describeOpenCodeError(err, { model: modelRef(model), kind });
      lastErr = Object.assign(new Error(described.message), {
        status: described.status,
        code: described.code || err.code,
        cause: err,
        lateReply: err.lateReply,
        cancelWatch: err.cancelWatch,
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
      channelId: meta.channel || null,
      threadId: meta.thread?.threadId || null,
    });
  });
  const live = (getState().seats || []).find((s) => s.id === to);
  if (live?.pauseReason === "budget") return { ...result, paused: true, reason: "budget" };
  return result;
}

async function postSeatReply(to, seat, runMeta, reply, messageId) {
  const clean = implicitRoomReply(runMeta) ? visibleRoomText(reply) : String(reply || "").trim();
  if (!clean || !runMeta?.channel || !runMeta.runId) {
    if (implicitRoomReply(runMeta) && String(reply || "").trim() && !clean) {
      emit({
        level: "warn",
        scope: "chat",
        step: "seat.unposted",
        seat: to,
        channel: runMeta?.channel || null,
        detail: { reason: suppressedRoomReason(reply) || "empty", runId: runMeta?.runId || null },
      });
    }
    return;
  }
  reply = clean;
  if (isPass(reply)) return;
  if (implicitRoomReply(runMeta)) {
    const prior = (getState().messages || []).find(
      (m) => m.channel === runMeta.channel && m.seatId === to && !m.system && m.runId === runMeta.runId,
    );
    if (prior) {
      emit({
        level: "warn",
        scope: "chat",
        step: "seat.unposted",
        seat: to,
        channel: runMeta.channel,
        detail: { reason: "extra", runId: runMeta.runId },
      });
      return;
    }
  }
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
    stopThinking(runMeta.channel, to);
    return;
  }
  postMessage(runMeta.channel, seat.name, "bot", reply, {
    seatId: to,
    mirrored: true,
    runId: runMeta.runId,
    ...(messageId ? { sessionId: messageId } : {}),
    ...threadCaption(to, runMeta.channel),
  });
  stopThinking(runMeta.channel, to);
}

/**
 * One cleanup for every way a turn ends: reply, provider error, empty completion,
 * the wake deadline, or a turn that never finishes. A failure is posted once.
 * A reply that shows up after that failure is posted once and does not add a second failure line.
 */
async function settleWake(to, seat, runMeta, { reply = "", messageId = null, failure = "", reason = null } = {}) {
  const slot = wakeSlot(runMeta?.runId);
  const text = implicitRoomReply(runMeta) ? visibleRoomText(reply) : String(reply || "").trim();
  if (String(reply || "").trim() && !text && implicitRoomReply(runMeta)) {
    if (!slot.replyPosted) {
      slot.replyPosted = true;
      noteRun(runMeta?.runId, to, "done", suppressedRoomReason(reply) || "unposted");
      emit({
        level: "warn",
        scope: "chat",
        step: "seat.unposted",
        seat: to,
        channel: runMeta?.channel || null,
        detail: { reason: suppressedRoomReason(reply) || "empty", runId: runMeta?.runId || null },
      });
    }
    stopThinking(runMeta?.channel, to);
    return { reported: true, replied: false, unposted: true };
  }
  if (text && !isPass(text)) {
    if (slot.replyPosted) {
      stopThinking(runMeta?.channel, to);
      return { reported: true, replied: true };
    }
    slot.replyPosted = true;
    noteRun(runMeta?.runId, to, "done", null);
    await postSeatReply(to, seat, runMeta, text, messageId);
    stopThinking(runMeta?.channel, to);
    return { reported: true, replied: true };
  }
  if (text && isPass(text)) {
    slot.replyPosted = true;
    noteRun(runMeta?.runId, to, "done", null);
    stopThinking(runMeta?.channel, to);
    return { reported: true, replied: true };
  }
  if (slot.failurePosted || slot.replyPosted) {
    stopThinking(runMeta?.channel, to);
    return { reported: true };
  }
  if (implicitRoomReply(runMeta) && failure && suppressedRoomReason(failure)) {
    slot.failurePosted = true;
    noteRun(runMeta?.runId, to, "done", suppressedRoomReason(failure));
    emit({
      level: "warn",
      scope: "chat",
      step: "seat.unposted",
      seat: to,
      channel: runMeta?.channel || null,
      detail: { reason: suppressedRoomReason(failure), runId: runMeta?.runId || null },
    });
    stopThinking(runMeta?.channel, to);
    return { reported: true, unposted: true };
  }
  slot.failurePosted = true;
  noteRun(runMeta?.runId, to, "blocked", reason || failure || "failed");
  stopThinking(runMeta?.channel, to);
  if (failure && runMeta?.channel) {
    if (runMeta.announce === false) {
      const { statusMessage } = await import("./chat.mjs");
      statusMessage(runMeta.channel, failure);
    } else await announceWake(runMeta, failure);
  }
  return { reported: true };
}

/** The start window elapsed and the stream is still open. Settle it once, on the stream's end or on the deadline. */
function armPendingSettle(to, seat, runMeta, err) {
  let failureClaimed = false;
  const timer = setTimeout(() => {
    void (async () => {
      const polled = err.sid
        ? await freshAssistantText(err.sid, err.kind, err.askedAt, { implicit: implicitRoomReply(runMeta) })
        : { text: "", messageId: null };
      if (String(polled.text || "").trim()) {
        try {
          err.cancelWatch?.();
        } catch {
          /* already stopped */
        }
        await settleWake(to, seat, runMeta, { reply: polled.text, messageId: polled.messageId });
        return;
      }
      if (failureClaimed) return;
      failureClaimed = true;
      try {
        err.cancelWatch?.();
      } catch {
        /* already stopped */
      }
      await settleWake(to, seat, runMeta, {
        failure: `${seat.name} did not reply: the provider timed out`,
        reason: "provider timeout",
      });
    })();
  }, wakeDeadlineMs());
  timer.unref?.();
  Promise.resolve(err.lateReply)
    .then(async (final) => {
      clearTimeout(timer);
      let text = String(final?.text || "").trim();
      let messageId = final?.messageId || null;
      if (!text && err.sid) {
        const polled = await freshAssistantText(err.sid, err.kind, err.askedAt, { implicit: implicitRoomReply(runMeta) });
        text = String(polled.text || "").trim();
        messageId = polled.messageId || messageId;
      }
      if (text) return settleWake(to, seat, runMeta, { reply: text, messageId });
      if (failureClaimed) return;
      failureClaimed = true;
      const failure = final?.error
        ? `${seat.name} did not start run ${runMeta.runId}: ${final.error}`
        : `${seat.name} finished without a reply`;
      return settleWake(to, seat, runMeta, {
        failure,
        reason: final?.error ? final.code || "PROVIDER_ERROR" : "NO_REPLY",
      });
    })
    .catch(() => {
      clearTimeout(timer);
      if (failureClaimed) return;
      failureClaimed = true;
      return settleWake(to, seat, runMeta, {
        failure: `${seat.name} did not start run ${runMeta.runId}: ${err.message || "the provider did not respond in time"}`,
        reason: err.code || "PROVIDER_ERROR",
      });
    });
}

async function finishPrompted(to, seat, text, runMeta, result, started) {
  const metered = meterPromptedWake(to, text, runMeta, result, started);
  if (result?.unposted) {
    noteRun(runMeta.runId, to, "done", result.dropReason || DROPPED_REASONING);
    wakeSlot(runMeta.runId).replyPosted = true;
    stopThinking(runMeta.channel, to);
    return { ...metered, runId: runMeta.runId, started: true, unposted: true };
  }
  if (metered.paused) {
    noteRun(runMeta.runId, to, "blocked", "budget");
    await announceWake(runMeta, `${seat.name} did not keep run ${runMeta.runId}: the seat is paused (budget).`);
    return { ...metered, runId: runMeta.runId, started: false };
  }
  const reply = String(result?.providerText || "");
  if (reply && !isPass(reply)) {
    noteRun(runMeta.runId, to, "running", null);
    await settleWake(to, seat, runMeta, { reply, messageId: result?.messageId || null });
    return { ...metered, runId: runMeta.runId, started: true };
  }
  noteRun(runMeta.runId, to, "running", null);
  await postSeatReply(to, seat, runMeta, reply, result?.messageId);
  noteRun(runMeta.runId, to, "done", null);
  wakeSlot(runMeta.runId).replyPosted = true;
  stopThinking(runMeta.channel, to);
  return { ...metered, runId: runMeta.runId, started: true };
}

function bindRun(meta, seatId) {
  const runId = meta.runId || uid("run");
  noteRun(runId, seatId, "starting", null);
  if (meta.kind || meta.teamMode) {
    mutate((s) => {
      const run = (s.runs || []).find((r) => r.id === runId);
      if (!run) return;
      if (meta.kind) run.kind = meta.kind;
      if (meta.teamMode) run.teamMode = true;
    });
  }
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
  const loadedList = await deps.loadedModels(kind).catch(() => null);
  const loadedArr = Array.isArray(loadedList) ? loadedList : null;
  const roomForModel = roomSessionChannel(runMeta, to);
  const channelForModel = roomForModel ? (getState().channels || []).find((c) => c.id === roomForModel) : null;
  const responseModel = channelForModel ? channelResponseModel(channelForModel, getState(), loadedArr) : null;
  const gap = seatModelGap(responseModel ? { ...seat, model: responseModel } : seat, loadedArr);
  if (gap) {
    noteRun(runMeta.runId, to, "blocked", gap);
    await announceWake(runMeta, `${seat.name} did not start run ${runMeta.runId}: ${gap}`);
    return { error: gap, code: "PROVIDER_NOT_LOADED", seat: to, harness: kind, runId: runMeta.runId, started: false };
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
    if (err.lateReply && !err.terminal) {
      noteRun(runMeta.runId, to, "blocked", error);
      armPendingSettle(to, seat, runMeta, err);
      return { error, code: err.code || null, seat: to, harness: kind, runId: runMeta.runId, started: false, pending: true };
    }
    await settleWake(to, seat, runMeta, { failure: wakeFailureLine(seat, runMeta, err), reason: err.code || error });
    return { error, code: err.code || null, seat: to, harness: kind, runId: runMeta.runId, started: false, pending: false, reported: true };
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

/** Strip OpenCode's " (@agent subagent)" suffix from a task session title. */
export function taskTitle(title) {
  return String(title || "").replace(/\s*\(@[^)]*subagent\)\s*$/, "").trim();
}

/**
 * Meter the subagent sessions a seat's turn started (`GET /session/:id/children`)
 * against the seats they ran as. Returns one entry per child session.
 */
export async function meterChildren(to, { sessionId = null, since = 0, runId = null, channelId = null, threadId = null } = {}) {
  const parent = seatById(to);
  if (!parent || !runId) return [];
  const id = sessionFor(parent, sessionId);
  if (!id) return [];
  const kind = harnessKindForSeat(parent);
  const children = await deps.sessionChildren(id, kind);
  const out = [];
  for (const child of children || []) {
    const created = Number(child?.time?.created || 0);
    if (!child?.id || (since && created && created < since)) continue;
    const msgs = await deps.sessionMessages(child.id, kind);
    const agent = sessionAgent(msgs);
    const seat = agent ? seatById(agent) : null;
    const asSeat = seat?.kind === "bot";
    // Built-in subagents (explore, general) are not seats; their tokens are the parent's.
    const billed = asSeat ? seat.id : to;
    const usage = turnUsage(msgs, 0);
    let res = null;
    mutate((s) => {
      res = meterChildSession(s, { seatId: billed, runId: `${runId}:${child.id}`, usage, channelId, threadId, parentSeatId: to });
    });
    out.push({
      childSessionId: child.id,
      agent,
      seatId: asSeat ? seat.id : null,
      title: taskTitle(child.title),
      tokens: res?.row?.tokens || 0,
      paused: Boolean(res?.seat && (res.seat.pauseReason === "budget" || res.over)),
    });
  }
  if (out.length) emit({ scope: "chat", step: "seat.delegated", seat: to, channel: channelId, detail: { runId, children: out } });
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
