/**
 * Who a caller may task and which jobs they may see (issue #69).
 *
 * The owner seat `you` (and any token with no seat binding) may task anyone.
 * Any other seat may task the descendants of its manager: not the manager,
 * and not other reporting lines.
 */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function isOwnerCaller(caller = {}) {
  return !caller.seatId || caller.seatId === "you";
}

function childrenByManager(state) {
  const map = new Map();
  for (const seat of state.seats || []) {
    if (!seat.reportsTo) continue;
    const list = map.get(seat.reportsTo) || [];
    list.push(seat.id);
    map.set(seat.reportsTo, list);
  }
  return map;
}

/** Seat ids under `managerId`, not including the manager. */
export function descendantSeatIds(state, managerId) {
  if (!managerId) return [];
  const children = childrenByManager(state);
  const out = [];
  const stack = [...(children.get(managerId) || [])];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const child of children.get(id) || []) stack.push(child);
  }
  return out;
}

export function taskableSeatIds(state, caller = {}) {
  if (isOwnerCaller(caller)) return (state.seats || []).map((s) => s.id);
  const self = (state.seats || []).find((s) => s.id === caller.seatId);
  if (!self?.reportsTo) return [];
  return descendantSeatIds(state, self.reportsTo).filter((id) => id !== caller.seatId);
}

function routingMode(raw) {
  return String(raw || "supervisor").trim().replace("-", "_") || "supervisor";
}

function workerIds(state, team) {
  const skip = new Set([team.supervisorSeatId].filter(Boolean));
  const ids = [];
  for (const id of team.seatIds || []) {
    if (skip.has(id)) continue;
    const seat = (state.seats || []).find((s) => s.id === id);
    if (!seat || seat.kind !== "bot" || seat.seatType === "supervisor") continue;
    ids.push(id);
  }
  return ids;
}

/** Throws 403 when this caller cannot hand `body.target` to the resolved seat. */
export function assertCallerCanTask(state, caller, body = {}) {
  if (isOwnerCaller(caller)) return;
  const allowed = new Set(taskableSeatIds(state, caller));
  const raw = String(body.target || "").trim();
  if (!raw || raw.startsWith("channel:") || raw.startsWith("#")) return;
  if (!raw.startsWith("team:")) {
    if (!allowed.has(raw)) throw fail(403, "this caller cannot task that seat");
    return;
  }
  const team = (state.teams || []).find((t) => t.id === raw.slice("team:".length));
  if (!team) return;
  const mode = routingMode(body.routing);
  if (mode === "specialist") {
    const id = String(body.specialist || "").trim();
    if (id && !allowed.has(id)) throw fail(403, "this caller cannot task that specialist");
    return;
  }
  if (mode === "round_robin") {
    const pool = workerIds(state, team);
    if (pool.some((id) => !allowed.has(id))) throw fail(403, "this caller cannot task every seat in that round-robin pool");
    return;
  }
  if (team.supervisorSeatId && !allowed.has(team.supervisorSeatId)) {
    throw fail(403, "this caller cannot task that team's supervisor");
  }
}

export function canReadJob(job, caller = {}) {
  if (!job) return false;
  if (isOwnerCaller(caller)) return true;
  if (job.assignee && job.assignee === caller.seatId) return true;
  if (job.caller?.seatId && job.caller.seatId === caller.seatId) return true;
  if (caller.tokenId && job.caller?.tokenId === caller.tokenId) return true;
  return false;
}

export function canCancelJob(job, caller = {}) {
  if (!job) return false;
  if (isOwnerCaller(caller)) return true;
  if (job.assignee && job.assignee === caller.seatId) return true;
  if (job.caller?.seatId && job.caller.seatId === caller.seatId) return true;
  if (caller.tokenId && job.caller?.tokenId === caller.tokenId) return true;
  return false;
}

export function canCompleteJob(job, caller = {}) {
  if (!job) return false;
  if (isOwnerCaller(caller)) return true;
  return Boolean(job.assignee && job.assignee === caller.seatId);
}

const OPEN = new Set(["queued", "running", "needs_human"]);

export function publicTaskSeat(state, seat) {
  const load = (state.jobs || []).filter((j) => j.assignee === seat.id && OPEN.has(j.status)).length;
  return {
    id: seat.id,
    name: seat.name,
    role: seat.role,
    kind: seat.kind,
    seatType: seat.seatType || null,
    reportsTo: seat.reportsTo || null,
    team: seat.team || null,
    model: seat.model || null,
    tools: seat.tools || [],
    deny: seat.deny || [],
    status: seat.status || null,
    job: seat.job || null,
    load,
  };
}

export function listTaskableSeats(state, caller) {
  const allowed = new Set(taskableSeatIds(state, caller));
  return (state.seats || []).filter((s) => allowed.has(s.id)).map((s) => publicTaskSeat(state, s));
}

export function listTaskableTeams(state, caller) {
  const allowed = new Set(taskableSeatIds(state, caller));
  const teams = [];
  for (const team of state.teams || []) {
    const seatIds = (team.seatIds || []).filter((id) => allowed.has(id));
    const supervisorOk = team.supervisorSeatId && allowed.has(team.supervisorSeatId);
    if (!seatIds.length && !supervisorOk) continue;
    teams.push({
      id: team.id,
      name: team.name,
      supervisorSeatId: supervisorOk ? team.supervisorSeatId : null,
      seatIds,
    });
  }
  return teams;
}
