import { slugify } from "./seed.mjs";
import { knowledgePointerLines } from "./knowledge.mjs";

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

export function listGoals(state) {
  return state.goals || [];
}

export function createGoal(state, body = {}) {
  const id = slugify(body.id || body.title);
  if (!id) fail(400, "title required");
  if ((state.goals || []).some((g) => g.id === id)) fail(409, "goal exists");
  const goal = {
    id,
    title: String(body.title || id),
    description: body.description ? String(body.description) : "",
    parentId: body.parentId ? String(body.parentId) : undefined,
    status: body.status ? String(body.status) : "active",
  };
  state.goals = [...(state.goals || []), goal];
  return goal;
}

export function goalById(state, id) {
  return (state.goals || []).find((g) => g.id === id) || null;
}

export function walkAncestry(state, goalId) {
  const chain = [];
  const seen = new Set();
  let id = goalId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const goal = goalById(state, id);
    if (!goal) break;
    chain.push(goal);
    id = goal.parentId;
  }
  return chain;
}

export function ancestryForSeat(state, seat) {
  const project = seat?.projectId ? (state.projects || []).find((p) => p.id === seat.projectId) : null;
  const linked = (project?.goalIds || []).map((id) => goalById(state, id)).filter(Boolean);
  const primary = linked[0] || null;
  const ancestors = primary?.parentId ? walkAncestry(state, primary.parentId) : [];
  return { project, goals: linked, primary, ancestors };
}

export function goalPackLines(state, { seat = null, runId = null } = {}) {
  const lines = [];
  const pack = ancestryForSeat(state, seat);
  const primary = pack.primary || (state.goals || []).find((g) => !g.parentId) || (state.goals || [])[0] || null;
  if (primary) {
    lines.push(`Goal: ${primary.title}`);
    if (primary.description) lines.push(primary.description);
    const ancestors = pack.primary ? pack.ancestors : primary.parentId ? walkAncestry(state, primary.parentId) : [];
    if (ancestors.length) {
      const titles = [...ancestors].reverse().map((g) => g.title);
      titles.push(primary.title);
      lines.push(`Ancestry: ${titles.join(" > ")}`);
    }
  }
  const project = pack.project || (state.projects || []).find((p) => p.id === "billing") || (state.projects || [])[0];
  if (project?.brief) lines.push(`Project brief: ${project.brief}`);
  if (project?.constitution) lines.push(`Constitution: ${project.constitution}`);
  for (const line of knowledgePointerLines(state, seat)) lines.push(line);
  if (runId) lines.push(`Run: ${runId}`);
  return lines.filter(Boolean).slice(0, 14);
}
