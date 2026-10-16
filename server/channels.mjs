import { slugify } from "./seed.mjs";
import { CONDUCTOR_ID } from "./mentions.mjs";
import { normalizeLimits, normalizeRespond, roomLimits, teamHomeRoom, teamRoomId } from "./room-config.mjs";

export { RESPOND_MODES, ROOM_LIMIT_DEFAULTS, roomLimits, teamRoomId } from "./room-config.mjs";

export function normalizeChannel(ch = {}) {
  const name = String(ch.name || ch.id || "").trim();
  const id = slugify(ch.id || name);
  return {
    id,
    name: name.startsWith("#") ? name : `#${name.replace(/^#/, "")}`,
    topic: ch.topic ? String(ch.topic) : "",
    teamIds: [...new Set(ch.teamIds || [])],
    seatIds: [...new Set(ch.seatIds || [])],
    leadSeatId: ch.leadSeatId ? String(ch.leadSeatId) : null,
    respond: normalizeRespond(ch.respond),
    limits: normalizeLimits(ch.limits),
  };
}

function isBot(seat) {
  return seat?.kind === "bot" && !seat.mcpGuest;
}

/**
 * Ordered bot seats that may answer an un-mentioned message: the lead, the
 * supervisors of member teams, bots reporting to a human member, other member
 * bots, then the conductor. System seats other than the conductor never answer.
 */
export function responderCandidates(channel, state = {}) {
  const seats = state.seats || [];
  const byId = (id) => seats.find((s) => s.id === id);
  const members = resolveMembers(channel || { seatIds: [], teamIds: [] }, state);
  const memberIds = new Set(members.map((s) => s.id));
  const humans = new Set(members.filter((s) => s.kind === "human").map((s) => s.id));
  const out = [];
  const add = (seat) => {
    if (!isBot(seat) || out.includes(seat.id)) return;
    if (seat.system && seat.id !== CONDUCTOR_ID) return;
    if (seat.id === CONDUCTOR_ID) return;
    out.push(seat.id);
  };
  const lead = byId(channel?.leadSeatId);
  if (lead && memberIds.has(lead.id)) {
    if (lead.id === CONDUCTOR_ID) out.push(CONDUCTOR_ID);
    else add(lead);
  }
  for (const tid of channel?.teamIds || []) {
    const team = (state.teams || []).find((t) => t.id === tid);
    add(byId(team?.supervisorSeatId));
  }
  for (const seat of members) if (humans.has(seat.reportsTo)) add(seat);
  for (const seat of members) add(seat);
  if (!out.includes(CONDUCTOR_ID)) out.push(CONDUCTOR_ID);
  return out;
}

function validateLead(state, ch, leadSeatId) {
  if (leadSeatId === null || leadSeatId === "") return null;
  const id = String(leadSeatId);
  const seat = (state.seats || []).find((s) => s.id === id);
  const members = new Set(resolveMembers(ch, state).map((s) => s.id));
  if (!isBot(seat) || !members.has(id)) {
    const err = new Error("leadSeatId must be a bot member of the channel");
    err.status = 400;
    throw err;
  }
  return id;
}

/** Clear a lead that left the room or no longer exists. */
export function dropStaleLead(ch, state) {
  if (!ch?.leadSeatId) return ch;
  const members = new Set(resolveMembers(ch, state).map((s) => s.id));
  const seat = (state.seats || []).find((s) => s.id === ch.leadSeatId);
  if (!isBot(seat) || !members.has(ch.leadSeatId)) ch.leadSeatId = null;
  return ch;
}

export function resolveMembers(channel, state = {}) {
  const seatIds = new Set(channel?.seatIds || []);
  seatIds.add(CONDUCTOR_ID);
  for (const tid of channel?.teamIds || []) {
    const team = (state.teams || []).find((t) => t.id === tid);
    for (const id of team?.seatIds || []) seatIds.add(id);
  }
  return [...seatIds].map((id) => (state.seats || []).find((s) => s.id === id)).filter(Boolean);
}

export function createChannel(state, body = {}) {
  const draft = normalizeChannel(body);
  if (!draft.id) {
    const err = new Error("name required");
    err.status = 400;
    throw err;
  }
  if ((state.channels || []).some((c) => c.id === draft.id)) {
    const err = new Error("channel exists");
    err.status = 409;
    throw err;
  }
  if (!draft.seatIds.includes(CONDUCTOR_ID)) draft.seatIds.unshift(CONDUCTOR_ID);
  state.channels = [...(state.channels || []), draft];
  return draft;
}

export function patchChannel(state, id, body = {}) {
  const live = (state.channels || []).find((c) => c.id === id);
  if (!live) return null;
  const ch = { ...live, teamIds: [...(live.teamIds || [])], seatIds: [...(live.seatIds || [])] };
  applyChannelPatch(state, ch, body);
  return Object.assign(live, ch);
}

function applyChannelPatch(state, ch, body) {
  if (body.name) ch.name = String(body.name).startsWith("#") ? body.name : `#${String(body.name).replace(/^#/, "")}`;
  if (body.topic !== undefined) ch.topic = String(body.topic || "");
  if (Array.isArray(body.teamIds)) ch.teamIds = [...new Set(body.teamIds.map(String))];
  if (Array.isArray(body.seatIds)) ch.seatIds = [...new Set(body.seatIds.map(String))];
  if (body.addTeam && !ch.teamIds.includes(body.addTeam)) ch.teamIds.push(String(body.addTeam));
  if (body.removeTeam) ch.teamIds = ch.teamIds.filter((t) => t !== body.removeTeam);
  if (body.addSeat && !ch.seatIds.includes(body.addSeat)) ch.seatIds.push(String(body.addSeat));
  if (body.removeSeat) ch.seatIds = ch.seatIds.filter((s) => s !== body.removeSeat);
  if (!ch.seatIds.includes(CONDUCTOR_ID)) ch.seatIds.unshift(CONDUCTOR_ID);
  if (body.leadSeatId !== undefined) ch.leadSeatId = validateLead(state, ch, body.leadSeatId);
  if (body.respond !== undefined) ch.respond = normalizeRespond(body.respond, { strict: true });
  if (body.limits !== undefined) ch.limits = { ...normalizeLimits(ch.limits), ...normalizeLimits(body.limits, { strict: true }) };
  for (const [key, value] of Object.entries(body.limits || {})) {
    if (value === null || value === "") delete ch.limits[key];
  }
  dropStaleLead(ch, state);
}

/**
 * The seat that answers un-mentioned messages under the room's mode, before
 * pause / model checks. Null for quiet rooms.
 */
export function roomResponder(channel, state = {}) {
  const mode = normalizeRespond(channel?.respond);
  if (mode === "quiet") return null;
  if (mode === "conductor") return CONDUCTOR_ID;
  return responderCandidates(channel, state)[0] || null;
}

/** Rooms the seat belongs to, directly or through a team. */
export function channelsForSeat(state = {}, seatId) {
  const out = [];
  for (const ch of state.channels || []) {
    const direct = (ch.seatIds || []).includes(seatId);
    const viaTeams = (ch.teamIds || []).filter((tid) =>
      ((state.teams || []).find((t) => t.id === tid)?.seatIds || []).includes(seatId),
    );
    if (!direct && !viaTeams.length && seatId !== CONDUCTOR_ID) continue;
    out.push({
      id: ch.id,
      name: ch.name,
      direct: direct || seatId === CONDUCTOR_ID,
      viaTeams,
      lead: ch.leadSeatId === seatId,
      responder: roomResponder(ch, state) === seatId,
      respond: normalizeRespond(ch.respond),
    });
  }
  return out;
}

/** Channel as sent to clients: the stored record plus the current responder. */
export function publicChannel(channel, state = {}) {
  return {
    ...channel,
    respond: normalizeRespond(channel.respond),
    limits: normalizeLimits(channel.limits),
    responderSeatId: roomResponder(channel, state),
  };
}

/**
 * Give every staffed team a `team-<id>` room led by its supervisor. Records the
 * client drafted before rooms had modes get the supervisor as lead once.
 */
export function ensureTeamRooms(state) {
  state.channels = state.channels || [];
  for (const team of state.teams || []) {
    if (team.staffed === false || !(team.seatIds || []).length) continue;
    const id = teamRoomId(team.id);
    const existing = state.channels.find((c) => c.id === id);
    if (!existing) {
      state.channels.push(teamHomeRoom(team));
      continue;
    }
    if (!(existing.teamIds || []).includes(team.id)) existing.teamIds = [...(existing.teamIds || []), team.id];
    if (existing.respond === undefined) {
      existing.respond = "lead";
      if (!existing.leadSeatId && team.supervisorSeatId) existing.leadSeatId = team.supervisorSeatId;
    }
    dropStaleLead(existing, state);
  }
  return state;
}

export function defaultMembership(id) {
  if (id === "ship") {
    return { teamIds: [], seatIds: [CONDUCTOR_ID, "product", "build", "review", "devops", "qa", "you", "maya"] };
  }
  if (id === "eng-agents") {
    return { teamIds: ["eng"], seatIds: [CONDUCTOR_ID] };
  }
  if (id === "incidents") {
    return { teamIds: ["eng", "services"], seatIds: [CONDUCTOR_ID, "you", "jules", "scout"] };
  }
  if (id === "general") {
    return { teamIds: [], seatIds: [CONDUCTOR_ID, "you", "maya", "jules", "priya"] };
  }
  return { teamIds: [], seatIds: [CONDUCTOR_ID] };
}

export function ensureChannelShape(channel) {
  const base = normalizeChannel(channel);
  if (!base.teamIds.length && !base.seatIds.length) {
    const seeded = defaultMembership(base.id);
    base.teamIds = seeded.teamIds;
    base.seatIds = seeded.seatIds;
  }
  if (!base.seatIds.includes(CONDUCTOR_ID)) base.seatIds.unshift(CONDUCTOR_ID);
  return base;
}
