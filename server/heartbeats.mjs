import { listInbox } from "./inbox.mjs";
import { hasWakeThisMinute } from "./routines.mjs";
import { seatOverBudget } from "./budget.mjs";
import { channelsForSeat } from "./channels.mjs";
import { parseMentions } from "./mentions.mjs";

/**
 * Room messages that @mention the seat and came after its last post and last
 * wake in that room. Mentions that woke the seat move its room cursor, so only
 * ones that never reached it (rate limit, pause, thread limits) count.
 */
export function unansweredMentions(state, seatId) {
  const out = [];
  const messages = state.messages || [];
  for (const room of channelsForSeat(state, seatId)) {
    const inRoom = messages.filter((m) => m.channel === room.id);
    const cursor = state.roomSessions?.[seatId]?.[room.id]?.cursor || null;
    let from = 0;
    inRoom.forEach((m, i) => {
      if ((m.seatId === seatId && !m.system) || (cursor && m.id === cursor)) from = i + 1;
    });
    for (const m of inRoom.slice(from)) {
      if (m.system || m.seatId === seatId) continue;
      if (parseMentions(m.text, state).some((x) => x.kind === "seat" && x.id === seatId)) out.push({ channelId: room.id, messageId: m.id });
    }
  }
  return out;
}

export function heartbeatMinutes(seat) {
  const n = Number(seat?.heartbeatMinutes);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.floor(n));
}

export function claimedTasksForSeat(state, seatId) {
  return (state.tasks || []).filter((t) => {
    if (t.status !== "claimed") return false;
    return t.claimedBy === seatId || t.ownerSeatId === seatId;
  });
}

export function heartbeatHasWork(state, seat) {
  const box = listInbox(state, seat.id);
  if ((box?.unread || 0) > 0) return true;
  if (claimedTasksForSeat(state, seat.id).length > 0) return true;
  return unansweredMentions(state, seat.id).length > 0;
}

export function heartbeatSkipReason(state, seat) {
  if (!seat || seat.kind !== "bot") return "not a bot";
  if (!heartbeatMinutes(seat)) return "off";
  if (seat.status === "paused" || seatOverBudget(seat)) return "paused";
  if ((seat.tools || []).includes("deploy")) return "deploy seat";
  return null;
}

function intervalElapsed(seat, now) {
  const mins = heartbeatMinutes(seat);
  if (!mins) return false;
  if (!seat.heartbeatLastAt) return true;
  const last = Date.parse(seat.heartbeatLastAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= mins * 60 * 1000;
}

export function heartbeatPrompt(seat, state) {
  const unread = listInbox(state, seat.id)?.unread || 0;
  const claimed = claimedTasksForSeat(state, seat.id).length;
  const mentions = unansweredMentions(state, seat.id);
  const rooms = [...new Set(mentions.map((m) => `#${m.channelId}`))];
  return [
    "Heartbeat check. Read your unread inbox and any claimed tasks.",
    `Unread: ${unread}. Claimed tasks: ${claimed}.`,
    mentions.length ? `Unanswered mentions: ${mentions.length} (in ${rooms.join(", ")}). Read those rooms and answer with roster_report channel=<room>.` : "",
    "Do not deploy or merge. Do not run denied tools.",
    "If nothing needs you, reply caught up.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function tickHeartbeats(state, now = Date.now()) {
  const due = [];
  for (const seat of state.seats || []) {
    const skip = heartbeatSkipReason(state, seat);
    if (skip) continue;
    if (!intervalElapsed(seat, now)) continue;
    if (!heartbeatHasWork(state, seat)) continue;
    const coalesced = hasWakeThisMinute(state, seat.id, now);
    seat.heartbeatLastAt = new Date(now).toISOString();
    due.push({
      seatId: seat.id,
      coalesced,
      prompt: heartbeatPrompt(seat, state),
    });
  }
  return due;
}
