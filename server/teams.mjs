import { genericTemplate, normalizeModelId, slugify, supervisorTemplate } from "./seed.mjs";

export function enrichTeam(team, seats = []) {
  const members = (team.seatIds || []).map((id) => seats.find((s) => s.id === id)).filter(Boolean);
  const models = [...new Set(members.map((s) => s.model).filter(Boolean))];
  return {
    ...team,
    seatCount: members.length || (team.seatIds || []).length,
    models,
  };
}

export function enrichTeams(teams = [], seats = []) {
  return teams.map((t) => enrichTeam(t, seats));
}

export function teamWakeTarget(to, teams = []) {
  const raw = String(to || "");
  if (!raw.startsWith("team:")) return null;
  const id = raw.slice("team:".length);
  const team = teams.find((t) => t.id === id);
  if (!team) return null;
  return team.supervisorSeatId || team.genericSeatId || (team.seatIds || []).find(Boolean) || null;
}

export function attachSeatToTeam(state, teamId, seatId) {
  const team = (state.teams || []).find((t) => t.id === teamId);
  if (!team) return null;
  team.seatIds = team.seatIds || [];
  if (!team.seatIds.includes(seatId)) team.seatIds.push(seatId);
  return team;
}

export function createStaffedTeam(state, body = {}) {
  const id = slugify(body.id || body.name);
  if (!id) {
    const err = new Error("name required");
    err.status = 400;
    throw err;
  }
  if ((state.teams || []).some((t) => t.id === id)) {
    const err = new Error("team exists");
    err.status = 409;
    throw err;
  }
  const name = body.name?.startsWith("@") ? body.name : `@${String(body.name || id).replace(/^@/, "")}`;
  const defaultModel = normalizeModelId(body.defaultModel) || "xai/grok-4";
  const team = {
    id,
    name,
    staffed: true,
    defaultModel,
    supervisorSeatId: `${id}-supervisor`,
    genericSeatId: `${id}-generic`,
    seatIds: [],
  };
  const supervisor = supervisorTemplate(team, { reportsTo: body.reportsTo || "you", model: defaultModel });
  const generic = genericTemplate(team, { reportsTo: supervisor.id, model: defaultModel });
  if (state.seats.some((s) => s.id === supervisor.id || s.id === generic.id)) {
    const err = new Error("supervisor or generic seat id already exists");
    err.status = 409;
    throw err;
  }
  team.seatIds = [supervisor.id, generic.id];
  state.teams = [...(state.teams || []), team];
  state.seats = [...state.seats, supervisor, generic];
  return { team: enrichTeam(team, state.seats), seats: [supervisor, generic] };
}

export function patchTeam(state, id, body = {}) {
  const team = (state.teams || []).find((t) => t.id === id);
  if (!team) return null;
  if (body.name) team.name = body.name;
  if (body.defaultModel) {
    team.defaultModel = normalizeModelId(body.defaultModel);
    for (const seat of state.seats) {
      if (seat.team === id && seat.seatType === "generic" && !body.keepGenericModel) {
        seat.model = team.defaultModel;
      }
    }
  }
  return enrichTeam(team, state.seats);
}
