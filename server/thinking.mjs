/** Seats with a wake in flight per room, shown as "<seat> is thinking…" instead of System lines. */
const STALE_MS = 5 * 60 * 1000;
const rooms = new Map();

export function startThinking(channelId, seatId, { model = null, now = Date.now() } = {}) {
  if (!channelId || !seatId) return;
  const room = rooms.get(channelId) || new Map();
  room.set(seatId, { seatId, model, since: now });
  rooms.set(channelId, room);
}

export function stopThinking(channelId, seatId) {
  const room = rooms.get(channelId);
  if (!room) return;
  room.delete(seatId);
  if (!room.size) rooms.delete(channelId);
}

export function thinkingIn(channelId, now = Date.now()) {
  const room = rooms.get(channelId);
  if (!room) return [];
  for (const [id, row] of room) if (now - row.since > STALE_MS) room.delete(id);
  return [...room.values()].sort((a, b) => a.since - b.since);
}

export function resetThinking() {
  rooms.clear();
}
