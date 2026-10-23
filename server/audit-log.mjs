import { randomBytes } from "node:crypto";
import { clientIp } from "./client-ip.mjs";

const EVENTS = new Set([
  "auth_success",
  "auth_failure",
  "denial",
  "key_change",
  "config_change",
  "admin_action",
  "rate_limit",
  "error",
]);

const OUTCOMES = new Set(["success", "failure", "denied"]);

function clip(value, max) {
  return String(value || "").replace(/[\r\n]/g, " ").slice(0, max);
}

/** Drop secrets, bearer material, and full email addresses before a line is written. */
export function redactAuditText(value) {
  return clip(value, 400)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\brf_[A-Za-z0-9_-]{8,}\b/g, "rf_[redacted]")
    .replace(/\brfcb_[A-Za-z0-9_-]{8,}\b/g, "rfcb_[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]");
}

export function keyPrefix(token) {
  const value = String(token || "");
  if (!value) return "";
  if (value.startsWith("rf_")) return `rf_${value.slice(3, 7)}`;
  return value.slice(0, 4);
}

export function actorLabel({ user, tokenId, presented } = {}) {
  if (user?.id) return String(user.id);
  if (tokenId) return String(tokenId);
  return keyPrefix(presented);
}

function bearer(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  const match = /^Bearer\s+(\S+)/i.exec(String(header));
  return match ? match[1] : "";
}

export function requestIdFrom(req) {
  const incoming = String(req?.headers?.["x-request-id"] || "").trim();
  if (/^[A-Za-z0-9._:-]{8,80}$/.test(incoming)) return incoming;
  return randomBytes(8).toString("hex");
}

export function auditRuntimeEnv(env = process.env) {
  const names = [env.NODE_ENV, env.ENVIRONMENT].map((value) => String(value || "").trim().toLowerCase());
  if (names.some((value) => value === "production" || value === "prod")) return "production";
  return "development";
}

function levelFor(event) {
  if (event === "error") return "error";
  if (event === "auth_failure" || event === "denial" || event === "rate_limit") return "warn";
  return "info";
}

export function auditLog(input = {}, deps = {}) {
  const write = deps.write || ((line) => process.stdout.write(`${line}\n`));
  const env = deps.env || process.env;
  const event = EVENTS.has(input.event) ? input.event : "error";
  const outcome = OUTCOMES.has(input.outcome) ? input.outcome : "failure";
  const status = Number(input.status);
  const line = {
    ts: new Date().toISOString(),
    level: levelFor(event),
    service: redactAuditText(env.ROSTER_LOG_SERVICE || "roster-flow").slice(0, 64) || "roster-flow",
    env: auditRuntimeEnv(env),
    project: "real-limitless",
    event,
    request_id: clip(input.request_id, 80),
    actor: redactAuditText(input.actor).slice(0, 80),
    client_ip: clip(input.client_ip, 80),
    user_agent: redactAuditText(input.user_agent).slice(0, 200),
    host: redactAuditText(input.host).slice(0, 200),
    path: clip(input.path, 200),
    method: clip(input.method, 16),
    status: Number.isFinite(status) ? status : 0,
    action: redactAuditText(input.action).slice(0, 80),
    outcome,
  };
  write(JSON.stringify(line));
  return line;
}

export function beginRequestAudit(req, res, { path, method } = {}) {
  const request_id = requestIdFrom(req);
  const audit = {
    request_id,
    client_ip: clientIp(req),
    user_agent: clip(req?.headers?.["user-agent"], 200),
    host: clip(req?.headers?.host, 200),
    path: clip(path, 200),
    method: clip(method, 16),
    actor: keyPrefix(bearer(req)),
  };
  if (req) req.audit = audit;
  if (res) {
    res.rosterReq = req;
    try {
      res.setHeader("x-request-id", request_id);
    } catch {
      /* headers already sent */
    }
  }
  return audit;
}

export function classifyAudit(code, body) {
  if (code === 429) return { event: "rate_limit", action: "rate_limit", outcome: "denied" };
  if (code === 403) return { event: "denial", action: "permission", outcome: "denied" };
  if (code >= 500) return { event: "error", action: "request", outcome: "failure" };
  if (code === 401) {
    const error = String(body?.error || "");
    if (
      /invalid email or password|invalid slack signature|current password is wrong|owner authentication required|sign in with the owner password|invalid, expired, or revoked API token/i.test(
        error,
      )
    ) {
      return { event: "auth_failure", action: "authenticate", outcome: "failure" };
    }
    return { event: "denial", action: "authenticate", outcome: "denied" };
  }
  return null;
}

/** Write at most one audit line for this response. Explicit marks win over status classification. */
export function emitResponseAudit(res, code, body) {
  if (!res || res.auditSent) return null;
  const fields = res.auditExplicit || classifyAudit(code, body);
  if (!fields) return null;
  res.auditSent = true;
  const ctx = res.rosterReq?.audit || {};
  return auditLog({
    ...ctx,
    ...fields,
    status: code,
    actor: fields.actor || ctx.actor || "",
  });
}
