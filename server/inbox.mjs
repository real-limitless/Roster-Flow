export function channelIdFromAddress(to) {
  const value = String(to || "");
  if (value.startsWith("channel:")) return value.slice("channel:".length);
  if (value.startsWith("#")) return value.slice(1);
  return null;
}

export function seatInChannel(state, seat, channelId) {
  if (!seat || !channelId) return false;
  const ch = (state.channels || []).find(
    (c) => c.id === channelId || c.name === `#${channelId}` || c.name === channelId,
  );
  if (!ch) return false;
  if ((ch.seatIds || []).includes(seat.id)) return true;
  for (const teamId of ch.teamIds || []) {
    const team = (state.teams || []).find((t) => t.id === teamId);
    if ((team?.seatIds || []).includes(seat.id)) return true;
  }
  return false;
}

export function addressMatchesSeat(state, entry, seat) {
  if (!entry || !seat) return false;
  const to = String(entry.to || "");
  if (to === seat.id) return true;
  if (to.startsWith("team:")) {
    const teamId = to.slice("team:".length);
    const team = (state.teams || []).find((t) => t.id === teamId);
    return Boolean(team && team.supervisorSeatId === seat.id);
  }
  const channelId = channelIdFromAddress(to);
  if (channelId && seatInChannel(state, seat, channelId)) return true;
  if (entry.kind === "ask_human") {
    if (to === seat.id) return true;
    const from = (state.seats || []).find((s) => s.id === entry.from);
    if (from?.reportsTo === seat.id) return true;
  }
  return false;
}

function busIndex(bus, id) {
  return (bus || []).findIndex((e) => e.id === id);
}

export function isUnread(state, entry, seatId) {
  const cursor = (state.inboxCursors || {})[seatId];
  if (!cursor) return true;
  const bus = state.bus || [];
  const cursorIdx = busIndex(bus, cursor);
  const entryIdx = busIndex(bus, entry.id);
  if (entryIdx < 0) return false;
  if (cursorIdx < 0) return true;
  return entryIdx > cursorIdx;
}

export function listInbox(state, seatId) {
  const seat = (state.seats || []).find((s) => s.id === seatId);
  if (!seat) return null;
  const items = (state.bus || [])
    .filter((e) => addressMatchesSeat(state, e, seat))
    .map((e) => ({ ...e, unread: isUnread(state, e, seatId) }));
  return {
    seatId,
    cursor: (state.inboxCursors || {})[seatId] || null,
    items,
    unread: items.filter((i) => i.unread).length,
  };
}

export function markInboxRead(state, seatId, beforeId) {
  const box = listInbox(state, seatId);
  if (!box) return null;
  const cursor = beforeId || (box.items.length ? box.items[box.items.length - 1].id : "");
  state.inboxCursors = { ...(state.inboxCursors || {}), [seatId]: cursor };
  return listInbox(state, seatId);
}

export function unreadBySeat(state) {
  const out = {};
  for (const seat of state.seats || []) {
    const box = listInbox(state, seat.id);
    if (box?.unread) out[seat.id] = box.unread;
  }
  return out;
}
