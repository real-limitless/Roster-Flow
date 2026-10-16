import { applyPlan, getPlan } from "./architect.mjs";
import { hireSeat } from "./seats.mjs";

const KINDS = new Set(["hire", "strategy", "budget_override", "deploy"]);

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function nid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function listApprovals(state, { status } = {}) {
  const all = state.approvals || [];
  if (status) return all.filter((a) => a.status === status);
  return all;
}

export function recordApproval(state, body = {}) {
  const rec = {
    id: body.id || nid("appr"),
    kind: KINDS.has(body.kind) ? body.kind : "strategy",
    status: body.status || "pending",
    actor: body.actor || "you",
    planId: body.planId || undefined,
    seatId: body.seatId || undefined,
    payload: body.payload && typeof body.payload === "object" ? { ...body.payload } : {},
    createdAt: body.createdAt || new Date().toISOString(),
    resolvedAt: body.status && body.status !== "pending" ? body.resolvedAt || new Date().toISOString() : undefined,
  };
  state.approvals = [...(state.approvals || []), rec];
  return rec;
}

export function createApproval(state, body = {}, actor = "you") {
  if (!KINDS.has(body.kind)) fail(400, "invalid kind");
  return recordApproval(state, {
    ...body,
    status: "pending",
    actor,
    resolvedAt: undefined,
  });
}

export function applyApproval(state, approval) {
  if (approval.kind === "hire" && approval.payload) {
    const seat = hireSeat(state, approval.payload);
    approval.seatId = seat.id;
    return { seat };
  }
  if (approval.kind === "strategy" && approval.planId) {
    const plan = getPlan(state, approval.planId);
    if (!plan) fail(404, "plan not found");
    return applyPlan(state, plan);
  }
  return {};
}

export function resolveApproval(state, id, { status, actor = "you" } = {}) {
  const rec = (state.approvals || []).find((a) => a.id === id);
  if (!rec) fail(404, "approval not found");
  if (rec.status !== "pending") fail(409, "approval already resolved");
  rec.status = status;
  rec.actor = actor || rec.actor;
  rec.resolvedAt = new Date().toISOString();
  let applied = {};
  if (status === "approved") applied = applyApproval(state, rec);
  return { approval: rec, ...applied };
}
