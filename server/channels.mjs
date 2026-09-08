import { slugify } from "./seed.mjs";
import { CONDUCTOR_ID } from "./mentions.mjs";

export function normalizeChannel(ch = {}) {
  const name = String(ch.name || ch.id || "").trim();
  const id = slugify(ch.id || name);
  return {
    id,
    name: name.startsWith("#") ? name : `#${name.replace(/^#/, "")}`,
    topic: ch.topic ? String(ch.topic) : "",
    teamIds: [...new Set(ch.teamIds || [])],
    seatIds: [...new Set(ch.seatIds || [])],
  };
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
  const ch = (state.channels || []).find((c) => c.id === id);
  if (!ch) return null;
  if (body.name) ch.name = String(body.name).startsWith("#") ? body.name : `#${String(body.name).replace(/^#/, "")}`;
  if (body.topic !== undefined) ch.topic = String(body.topic || "");
  if (Array.isArray(body.teamIds)) ch.teamIds = [...new Set(body.teamIds.map(String))];
  if (Array.isArray(body.seatIds)) ch.seatIds = [...new Set(body.seatIds.map(String))];
  if (body.addTeam && !ch.teamIds.includes(body.addTeam)) ch.teamIds.push(String(body.addTeam));
  if (body.removeTeam) ch.teamIds = ch.teamIds.filter((t) => t !== body.removeTeam);
  if (body.addSeat && !ch.seatIds.includes(body.addSeat)) ch.seatIds.push(String(body.addSeat));
  if (body.removeSeat) ch.seatIds = ch.seatIds.filter((s) => s !== body.removeSeat);
  if (!ch.seatIds.includes(CONDUCTOR_ID)) ch.seatIds.unshift(CONDUCTOR_ID);
  return ch;
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
