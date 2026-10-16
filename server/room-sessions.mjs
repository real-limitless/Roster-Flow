import { getState, mutate } from "./store.mjs";
import { deleteSession, harnessKindForSeat, sessionKeyForKind } from "./harness.mjs";
import { emit } from "./trace.mjs";

export const ROOM_SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
export const CONTEXT_MAX_MESSAGES = 20;
/** About 2k tokens at four characters a token. */
export const CONTEXT_MAX_CHARS = 8000;
const LINE_MAX_CHARS = 400;

export const deps = { deleteSession };

export function roomSessionTitle(seatId, channelId) {
  return `roster:${seatId}:${channelId}`;
}

export function roomSessionEntry(state, seatId, channelId) {
  return state.roomSessions?.[seatId]?.[channelId] || null;
}

export function setRoomSession(seatId, channelId, patch) {
  let entry = null;
  mutate((s) => {
    const all = s.roomSessions && typeof s.roomSessions === "object" ? s.roomSessions : {};
    const rooms = { ...(all[seatId] || {}) };
    entry = { ...(rooms[channelId] || {}), ...patch };
    rooms[channelId] = entry;
    s.roomSessions = { ...all, [seatId]: rooms };
  });
  return entry;
}

export function dropRoomSession(seatId, channelId) {
  mutate((s) => {
    const rooms = s.roomSessions?.[seatId];
    if (!rooms?.[channelId]) return;
    const next = { ...rooms };
    delete next[channelId];
    s.roomSessions = { ...s.roomSessions, [seatId]: next };
    if (!Object.keys(next).length) delete s.roomSessions[seatId];
  });
}

/** Room sessions belong to a seat's current serve; a seat that moved serves gets a new one. */
export function liveRoomSession(state, seat, channelId) {
  const entry = roomSessionEntry(state, seat.id, channelId);
  if (!entry?.sessionId) return null;
  if (entry.harness && entry.harness !== harnessKindForSeat(seat)) return null;
  return entry;
}

/** Which seat and room an OpenCode session belongs to, or null. */
export function sessionRoom(state, sessionId) {
  if (!sessionId) return null;
  for (const [seatId, rooms] of Object.entries(state.roomSessions || {})) {
    for (const [channelId, entry] of Object.entries(rooms || {})) {
      if (entry?.sessionId === sessionId) {
        return { sessionId, seatId, channelId, kind: "room", harness: entry.harness || null };
      }
    }
  }
  for (const harness of ["company", "system"]) {
    const map = state[sessionKeyForKind(harness)] || {};
    for (const [seatId, sid] of Object.entries(map)) {
      if (sid === sessionId) {
        return { sessionId, seatId, channelId: state.sessionRooms?.[seatId] || `dm-${seatId}`, kind: "dm", harness };
      }
    }
  }
  return null;
}

function oneLine(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > LINE_MAX_CHARS ? `${flat.slice(0, LINE_MAX_CHARS - 1)}…` : flat;
}

/**
 * Room messages the seat has not seen: everything after its cursor, minus
 * System lines, its own posts, and the message that triggered this wake.
 * Newest messages win when the caps cut the list; lines come back oldest first.
 */
export function roomContext(state, seatId, channelId, { exclude = "", cursor } = {}) {
  const all = (state.messages || []).filter((m) => m.channel === channelId);
  const at = cursor === undefined ? roomSessionEntry(state, seatId, channelId)?.cursor : cursor;
  const start = at ? all.findIndex((m) => m.id === at) + 1 : 0;
  let pool = all.slice(Math.max(0, start));
  const last = pool[pool.length - 1];
  if (exclude && last && last.text === exclude && last.seatId !== seatId) pool = pool.slice(0, -1);
  const picked = [];
  let chars = 0;
  for (let i = pool.length - 1; i >= 0 && picked.length < CONTEXT_MAX_MESSAGES; i--) {
    const m = pool[i];
    if (m.system || m.seatId === seatId || !m.text) continue;
    const line = `[${m.time || "--:--"}] ${m.who || m.seatId || "someone"}: ${oneLine(m.text)}`;
    if (chars + line.length > CONTEXT_MAX_CHARS) break;
    chars += line.length;
    picked.push(line);
  }
  return { lines: picked.reverse(), cursor: all[all.length - 1]?.id || at || null };
}

/** Delete room sessions idle for `idleMs`; the next wake in that room opens a new one. */
export async function cleanupRoomSessions({ now = Date.now(), idleMs = ROOM_SESSION_IDLE_MS } = {}) {
  const stale = [];
  for (const [seatId, rooms] of Object.entries(getState().roomSessions || {})) {
    for (const [channelId, entry] of Object.entries(rooms || {})) {
      const last = Date.parse(entry?.lastWakeAt || "") || 0;
      if (now - last >= idleMs) stale.push({ seatId, channelId, entry });
    }
  }
  for (const { seatId, channelId, entry } of stale) {
    try {
      if (entry?.sessionId) await deps.deleteSession(entry.sessionId, entry.harness || "company");
    } catch {
      /* the serve may already have dropped it */
    }
    dropRoomSession(seatId, channelId);
    emit({ scope: "harness", step: "session.cleanup", seat: seatId, channel: channelId, detail: { sessionId: entry?.sessionId || null } });
  }
  return stale.map(({ seatId, channelId }) => ({ seatId, channelId }));
}
