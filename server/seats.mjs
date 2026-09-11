import { applyBudgetSideEffects, budgetFieldsFromBody, rolloverSeatBudget, seatOverBudget } from "./budget.mjs";
import { normalizeModelId, normalizeSeat, slugify } from "./seed.mjs";
import { attachSeatToTeam } from "./teams.mjs";
import { removeSeatAgent } from "./agents.mjs";

const PROTECTED = new Set(["you"]);

export function hireSeat(state, body = {}) {
  const id = slugify(body.id || body.name);
  if (!id) {
    const err = new Error("name required");
    err.status = 400;
    throw err;
  }
  if ((state.seats || []).some((s) => s.id === id)) {
    const err = new Error("seat exists");
    err.status = 409;
    throw err;
  }
  const kind = body.kind === "human" ? "human" : "bot";
  const teamId = body.team || undefined;
  const team = teamId ? (state.teams || []).find((t) => t.id === teamId) : null;
  const projectId = body.projectId || team?.projectId || undefined;
  const seatType = body.seatType || (kind === "human" ? "human" : "specialist");
  const reportsTo =
    body.reportsTo || (team && kind === "bot" ? team.supervisorSeatId : undefined) || undefined;
  const seat = normalizeSeat({
    id,
    name: body.name || id,
    role:
      body.role ||
      (kind === "human"
        ? "Teammate"
        : seatType === "supervisor"
          ? "Supervisor"
          : seatType === "generic"
            ? "Generic"
            : "Specialist"),
    kind,
    seatType,
    reportsTo,
    team: teamId,
    projectId,
    tools: body.tools || (kind === "human" ? ["approve"] : ["read"]),
    deny: body.deny || (kind === "bot" ? ["deploy"] : []),
    model: kind === "human" ? undefined : normalizeModelId(body.model) || team?.defaultModel || "xai/grok-4",
    fallbackModel: kind === "human" ? undefined : normalizeModelId(body.fallbackModel) || team?.fallbackModel,
    persona: body.persona,
    instructions: body.instructions,
    knowledge: body.knowledge,
    skills: body.skills,
    job: body.job || "New seat.",
    status: "idle",
    ...budgetFieldsFromBody(body),
  });
  if (seat.kind === "bot") {
    seat.spent = seat.spent || 0;
    applyBudgetSideEffects(seat);
  }
  state.seats = [...(state.seats || []), seat];
  if (teamId) attachSeatToTeam(state, teamId, seat.id);
  if (projectId && body.asPm) {
    const project = (state.projects || []).find((p) => p.id === projectId);
    if (project) project.pmSeatId = seat.id;
  }
  return seat;
}

export function fireSeat(state, id) {
  const seat = (state.seats || []).find((s) => s.id === id);
  if (!seat) {
    const err = new Error("seat not found");
    err.status = 404;
    throw err;
  }
  if (PROTECTED.has(id) || seat.system) {
    const err = new Error("cannot fire this seat");
    err.status = 403;
    throw err;
  }
  const fallback = seat.reportsTo && seat.reportsTo !== id ? seat.reportsTo : "you";
  for (const child of state.seats) {
    if (child.reportsTo === id) child.reportsTo = fallback;
  }
  for (const team of state.teams || []) {
    team.seatIds = (team.seatIds || []).filter((sid) => sid !== id);
    if (team.supervisorSeatId === id) team.supervisorSeatId = undefined;
    if (team.genericSeatId === id) team.genericSeatId = undefined;
  }
  for (const project of state.projects || []) {
    if (project.pmSeatId === id) project.pmSeatId = undefined;
  }
  state.seats = state.seats.filter((s) => s.id !== id);
  try {
    removeSeatAgent(id);
  } catch {
    /* agent file is best-effort */
  }
  return { id, reparentedTo: fallback };
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

export function pauseSeat(state, id, reason = "owner") {
  const seat = (state.seats || []).find((s) => s.id === id);
  if (!seat) fail(404, "seat not found");
  if (seat.id === "you" || seat.kind === "human") fail(400, "cannot pause this seat");
  seat.status = "paused";
  if (reason === "budget" || seat.pauseReason !== "budget") seat.pauseReason = reason;
  return seat;
}

export function resumeSeat(state, id) {
  const seat = (state.seats || []).find((s) => s.id === id);
  if (!seat) fail(404, "seat not found");
  if (seat.id === "you" || seat.kind === "human") fail(400, "cannot resume this seat");
  rolloverSeatBudget(seat);
  if (seatOverBudget(seat)) fail(400, "raise tokenBudget first");
  if (seat.status === "paused") {
    seat.status = "idle";
    seat.pauseReason = undefined;
  }
  return seat;
}

export function patchSeat(state, id, body = {}) {
  const seat = (state.seats || []).find((s) => s.id === id);
  if (!seat) return null;
  const budget = budgetFieldsFromBody(body);
  const next = { ...seat, ...body, id, ...budget };
  if (body.model) next.model = normalizeModelId(body.model);
  if (body.fallbackModel !== undefined) next.fallbackModel = normalizeModelId(body.fallbackModel) || undefined;
  const updated = normalizeSeat(next);
  if (updated.kind === "bot") applyBudgetSideEffects(updated);
  state.seats = (state.seats || []).map((s) => (s.id === id ? updated : s));
  if (updated.team) attachSeatToTeam(state, updated.team, updated.id);
  return updated;
}

export function pauseTeam(state, id) {
  const team = (state.teams || []).find((t) => t.id === id);
  if (!team) fail(404, "team not found");
  const seats = [];
  for (const sid of team.seatIds || []) {
    const seat = (state.seats || []).find((s) => s.id === sid);
    if (seat?.kind === "bot") {
      seat.status = "paused";
      if (seat.pauseReason !== "budget") seat.pauseReason = "owner";
      seats.push(seat);
    }
  }
  return { team, seats };
}

export function killRun(state, runId) {
  const id = String(runId || "").trim();
  if (!id) fail(400, "runId required");
  state.pausedRunIds = [...new Set([...(state.pausedRunIds || []), id])];
  return { runId: id, paused: true };
}

export function wakeBlocked(state, seat, meta = {}) {
  if (!seat) return { paused: true, reason: "seat" };
  rolloverSeatBudget(seat);
  if (seatOverBudget(seat)) {
    seat.status = "paused";
    seat.pauseReason = "budget";
    return { paused: true, reason: "budget" };
  }
  if (seat.status === "paused") return { paused: true, reason: seat.pauseReason === "budget" ? "budget" : "seat" };
  const runId = meta.runId;
  if (runId && (state.pausedRunIds || []).includes(runId)) return { paused: true, reason: "run" };
  return null;
}
