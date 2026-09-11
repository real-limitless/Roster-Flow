import { listInbox } from "./inbox.mjs";
import { hasWakeThisMinute } from "./routines.mjs";
import { seatOverBudget } from "./budget.mjs";

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
  return claimedTasksForSeat(state, seat.id).length > 0;
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
  return [
    "Heartbeat check. Read your unread inbox and any claimed tasks.",
    `Unread: ${unread}. Claimed tasks: ${claimed}.`,
    "Do not deploy or merge. Do not run denied tools.",
    "If nothing needs you, reply caught up.",
  ].join(" ");
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
