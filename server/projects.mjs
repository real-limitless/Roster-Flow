import { slugify } from "./seed.mjs";

export function defaultOrgId(state) {
  return state.organizations?.[0]?.id || "roster-flow";
}

export function attachTeamToProject(state, projectId, teamId) {
  const project = (state.projects || []).find((p) => p.id === projectId);
  if (!project) return null;
  project.teamIds = project.teamIds || [];
  if (!project.teamIds.includes(teamId)) project.teamIds.push(teamId);
  const team = (state.teams || []).find((t) => t.id === teamId);
  if (team) team.projectId = projectId;
  for (const seat of state.seats || []) {
    if (seat.team === teamId && !seat.projectId) seat.projectId = projectId;
  }
  return project;
}

export function createProject(state, body = {}) {
  const id = slugify(body.id || body.name);
  if (!id) {
    const err = new Error("name required");
    err.status = 400;
    throw err;
  }
  if ((state.projects || []).some((p) => p.id === id)) {
    const err = new Error("project exists");
    err.status = 409;
    throw err;
  }
  const project = {
    id,
    orgId: body.orgId || defaultOrgId(state),
    name: String(body.name || id),
    brief: String(body.brief || ""),
    constitution: body.constitution ? String(body.constitution) : undefined,
    pmSeatId: body.pmSeatId || undefined,
    teamIds: Array.isArray(body.teamIds) ? [...body.teamIds] : [],
  };
  state.projects = [...(state.projects || []), project];
  for (const teamId of project.teamIds) attachTeamToProject(state, id, teamId);
  return project;
}

export function patchProject(state, id, body = {}) {
  const project = (state.projects || []).find((p) => p.id === id);
  if (!project) return null;
  if (body.name !== undefined) project.name = String(body.name);
  if (body.brief !== undefined) project.brief = String(body.brief);
  if (body.constitution !== undefined) project.constitution = String(body.constitution) || undefined;
  if (body.pmSeatId !== undefined) project.pmSeatId = body.pmSeatId || undefined;
  if (Array.isArray(body.teamIds)) {
    project.teamIds = [...body.teamIds];
    for (const teamId of project.teamIds) attachTeamToProject(state, id, teamId);
  }
  return project;
}
