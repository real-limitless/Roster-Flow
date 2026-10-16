function nid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

const STATUSES = new Set(["pending", "claimed", "done"]);

export function listTasks(state, query = {}) {
  let rows = [...(state.tasks || [])];
  if (query.projectId) rows = rows.filter((t) => t.projectId === query.projectId);
  if (query.runId) rows = rows.filter((t) => t.runId === query.runId);
  return rows;
}

export function taskById(state, id) {
  return (state.tasks || []).find((t) => t.id === id) || null;
}

function openBlockers(state, task) {
  return (task.dependOn || []).filter((did) => {
    const dep = taskById(state, did);
    return !dep || dep.status !== "done";
  });
}

export function createTask(state, body = {}) {
  const title = String(body.title || "").trim();
  if (!title) fail(400, "title required");
  const id = String(body.id || nid("task")).replace(/[^a-zA-Z0-9_-]/g, "-");
  if ((state.tasks || []).some((t) => t.id === id)) fail(409, "task exists");
  const dependOn = Array.isArray(body.dependOn)
    ? body.dependOn.map(String)
    : body.depend_on
      ? [].concat(body.depend_on).map(String)
      : [];
  const task = {
    id,
    title,
    projectId: body.projectId ? String(body.projectId) : undefined,
    runId: body.runId ? String(body.runId) : undefined,
    ownerSeatId: body.ownerSeatId ? String(body.ownerSeatId) : undefined,
    claimedBy: undefined,
    status: "pending",
    dependOn,
    path: body.path ? String(body.path) : "",
    createdAt: new Date().toISOString(),
  };
  state.tasks = [...(state.tasks || []), task];
  return task;
}

export function claimTask(state, id, seatId) {
  const task = taskById(state, id);
  if (!task) fail(404, "task not found");
  const who = String(seatId || "").trim();
  if (!who) fail(400, "seatId required");
  if (task.status === "done") fail(409, "already claimed");
  if (task.status === "claimed") fail(409, "already claimed");
  const blockers = openBlockers(state, task);
  if (blockers.length) fail(409, "blocked");
  task.status = "claimed";
  task.claimedBy = who;
  task.claimedAt = new Date().toISOString();
  return task;
}

export function completeTask(state, id, seatId) {
  const task = taskById(state, id);
  if (!task) fail(404, "task not found");
  if (task.status !== "claimed" && task.status !== "pending") fail(409, "cannot complete");
  if (seatId && task.claimedBy && task.claimedBy !== seatId) fail(409, "not the claimant");
  if (task.status === "pending") {
    task.claimedBy = String(seatId || task.ownerSeatId || "you");
  }
  task.status = "done";
  task.completedAt = new Date().toISOString();
  return task;
}

export function claimedSeatIds(state) {
  return [...new Set((state.tasks || []).filter((t) => t.status === "claimed" && t.claimedBy).map((t) => t.claimedBy))];
}

export function publicTask(task) {
  return { ...task };
}

export { STATUSES };
