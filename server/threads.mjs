import { parseMentions } from "./mentions.mjs";
import { resolveMembers, roomLimits } from "./channels.mjs";
import { teamWakeTarget } from "./teams.mjs";

/** Wakes between the same two seats in one thread before CORE stops the ping-pong. */
export const PAIR_LIMIT = 4;

const threads = new Map();

export function resetThreads() {
  threads.clear();
}

function record(threadId) {
  let t = threads.get(threadId);
  if (!t) {
    t = { botWakes: 0, pairs: new Map() };
    threads.set(threadId, t);
  }
  return t;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

/** A human post starts a thread at hop 0. */
export function startThread(rootMessageId, from, channel) {
  const id = rootMessageId || `thr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return { threadId: id, rootMessageId: rootMessageId || null, hop: 0, from: from || null, maxHops: roomLimits(channel).maxHops };
}

export function threadStats(threadId) {
  const t = threads.get(threadId);
  return { botWakes: t?.botWakes || 0 };
}

export function noteBotWake(threadId, from, to) {
  const t = record(threadId);
  t.botWakes += 1;
  const key = pairKey(from, to);
  t.pairs.set(key, (t.pairs.get(key) || 0) + 1);
}

/** False once two seats have woken each other PAIR_LIMIT times in this thread. */
export function cycleSafe(threadId, from, to) {
  if (from === to) return false;
  return (threads.get(threadId)?.pairs.get(pairKey(from, to)) || 0) < PAIR_LIMIT;
}

/**
 * Decide what @mentions in a bot's room reply do. Bots cannot use @channel or
 * @here, never wake themselves, and only wake members of the room. Past the
 * room's hop or thread limits, the seat that would have been woken is notified
 * instead and the room gets one stop line.
 */
export function planBotMentions({ state, channelId, fromSeatId, text, thread }) {
  const room = (state.channels || []).find((c) => c.id === channelId) || { id: channelId, seatIds: [], teamIds: [] };
  const limits = roomLimits(room);
  const members = new Set(resolveMembers(room, state).map((s) => s.id));
  const seats = state.seats || [];
  const out = { wakes: [], notify: [], stops: [], ignored: [] };
  const seen = new Set([fromSeatId]);
  const hop = (thread?.hop || 0) + 1;
  let budget = limits.maxBotWakesPerThread - threadStats(thread?.threadId).botWakes;
  for (const m of parseMentions(text, state)) {
    if (m.kind === "channel") {
      out.ignored.push({ token: m.token, why: "bots cannot use @channel or @here" });
      continue;
    }
    const to = m.kind === "team" ? teamWakeTarget(`team:${m.id}`, state.teams || []) : m.id;
    if (!to || seen.has(to)) continue;
    seen.add(to);
    const seat = seats.find((s) => s.id === to);
    if (!seat) continue;
    if (seat.kind !== "bot" || seat.mcpGuest) {
      out.notify.push(to);
      continue;
    }
    if (!members.has(to)) {
      out.notify.push(to);
      out.stops.push(`${seat.name} is not in this room, so they were notified instead of woken.`);
      continue;
    }
    if (hop > limits.maxHops) {
      out.notify.push(to);
      out.stops.push(`Stopped: thread reached ${plural(limits.maxHops, "hop")}.`);
      continue;
    }
    if (budget <= 0) {
      out.notify.push(to);
      out.stops.push(`Stopped: thread reached ${plural(limits.maxBotWakesPerThread, "bot wake")}.`);
      continue;
    }
    if (!cycleSafe(thread?.threadId, fromSeatId, to)) {
      const from = seats.find((s) => s.id === fromSeatId);
      out.notify.push(to);
      out.stops.push(`Stopped: ${from?.name || fromSeatId} and ${seat.name} keep waking each other in this thread.`);
      continue;
    }
    budget -= 1;
    out.wakes.push({
      to,
      reason: m.kind === "team" ? "mention-team" : "mention-seat",
      meta: {
        thread: {
          threadId: thread?.threadId,
          rootMessageId: thread?.rootMessageId || null,
          hop,
          from: fromSeatId,
          maxHops: limits.maxHops,
        },
      },
    });
  }
  out.stops = [...new Set(out.stops)];
  return out;
}
