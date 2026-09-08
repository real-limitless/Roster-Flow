import { genericTemplate, normalizeModelId, normalizeSeat, slugify, supervisorTemplate } from "./seed.mjs";
import { STRATEGIES } from "./models.mjs";
import { attachTeamToProject } from "./projects.mjs";

export function teamBrief(team) {
  return [
    team.role ? `Team role: ${team.role}` : "",
    team.description ? `Description: ${team.description}` : "",
    team.job ? `Job: ${team.job}` : "",
    team.rules ? `Special rules:\n${team.rules}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

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

function applyTeamIdentity(team, body = {}) {
  if (body.role !== undefined) team.role = String(body.role);
  if (body.description !== undefined) team.description = String(body.description);
  if (body.job !== undefined) team.job = String(body.job);
  if (body.rules !== undefined) team.rules = String(body.rules);
  if (body.fallbackModel !== undefined) team.fallbackModel = normalizeModelId(body.fallbackModel) || undefined;
  if (body.modelStrategy && STRATEGIES.includes(body.modelStrategy)) team.modelStrategy = body.modelStrategy;
  if (Array.isArray(body.allowedModels)) {
    team.allowedModels = body.allowedModels.map(normalizeModelId).filter(Boolean);
  }
}

function injectBrief(seat, team) {
  const brief = teamBrief(team);
  if (!brief) return seat;
  const tag = "\n\nTeam charter:\n";
  const base = String(seat.instructions || "").split(tag)[0];
  seat.instructions = `${base}${tag}${brief}`;
  return seat;
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
    role: body.role || "Team",
    description: body.description || "",
    job: body.job || "",
    rules: body.rules || "",
    defaultModel,
    fallbackModel: normalizeModelId(body.fallbackModel) || undefined,
    modelStrategy: STRATEGIES.includes(body.modelStrategy) ? body.modelStrategy : "default",
    allowedModels: Array.isArray(body.allowedModels) ? body.allowedModels.map(normalizeModelId).filter(Boolean) : [defaultModel],
    supervisorSeatId: `${id}-supervisor`,
    genericSeatId: `${id}-generic`,
    projectId: body.projectId || undefined,
    seatIds: [],
  };
  const supervisor = injectBrief(
    supervisorTemplate(team, { reportsTo: body.reportsTo || "you", model: defaultModel, projectId: team.projectId }),
    team,
  );
  const generic = injectBrief(
    genericTemplate(team, { reportsTo: supervisor.id, model: defaultModel, projectId: team.projectId }),
    team,
  );
  if (state.seats.some((s) => s.id === supervisor.id || s.id === generic.id)) {
    const err = new Error("supervisor or generic seat id already exists");
    err.status = 409;
    throw err;
  }
  team.seatIds = [supervisor.id, generic.id];
  const extra = [];
  for (const spec of body.specialists || []) {
    const sid = slugify(spec.id || spec.name);
    if (!sid || state.seats.some((s) => s.id === sid) || extra.some((s) => s.id === sid)) continue;
    const seat = normalizeSeat({
      id: sid,
      name: spec.name || sid,
      role: spec.role || "Specialist",
      kind: "bot",
      seatType: "specialist",
      reportsTo: supervisor.id,
      team: team.id,
      projectId: team.projectId,
      tools: spec.tools || ["read"],
      deny: spec.deny || ["deploy"],
      model: normalizeModelId(spec.model) || defaultModel,
      fallbackModel: normalizeModelId(spec.fallbackModel) || team.fallbackModel,
      persona: spec.persona,
      instructions: spec.instructions,
      job: spec.job || "Specialist on this team.",
      status: "idle",
    });
    extra.push(seat);
    team.seatIds.push(seat.id);
  }
  state.teams = [...(state.teams || []), team];
  state.seats = [...state.seats, supervisor, generic, ...extra];
  if (team.projectId) attachTeamToProject(state, team.projectId, team.id);
  return { team: enrichTeam(team, state.seats), seats: [supervisor, generic, ...extra] };
}

export function patchTeam(state, id, body = {}) {
  const team = (state.teams || []).find((t) => t.id === id);
  if (!team) return null;
  if (body.name) team.name = body.name;
  applyTeamIdentity(team, body);
  if (body.defaultModel) {
    team.defaultModel = normalizeModelId(body.defaultModel);
    for (const seat of state.seats) {
      if (seat.team === id && seat.seatType === "generic" && !body.keepGenericModel) {
        seat.model = team.defaultModel;
      }
    }
  }
  for (const seat of state.seats) {
    if (seat.team === id && (seat.seatType === "supervisor" || seat.seatType === "generic")) {
      injectBrief(seat, team);
    }
  }
  return enrichTeam(team, state.seats);
}
