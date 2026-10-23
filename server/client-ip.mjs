/** Client address for limits and audit logs. Forwarded headers count only from a trusted proxy. */

function envFlag(name, env) {
  const v = String(env[name] || "").trim();
  return v === "1" || /^true$/i.test(v);
}

export function normalizeIp(value) {
  let v = String(value || "").trim();
  if (v.startsWith("::ffff:")) v = v.slice("::ffff:".length);
  if (!v || v.length > 80 || /[\s,]/.test(v)) return "";
  return v;
}

function header(req, name) {
  const raw = req?.headers?.[name];
  if (Array.isArray(raw)) return String(raw[0] || "");
  return String(raw || "");
}

function trusted(remote, env) {
  if (envFlag("ROSTER_TRUST_PROXY", env)) return true;
  const list = String(env.ROSTER_TRUSTED_PROXIES || "")
    .split(",")
    .map((item) => normalizeIp(item))
    .filter(Boolean);
  return list.includes(remote);
}

function firstForwarded(req) {
  const cf = normalizeIp(header(req, "cf-connecting-ip").split(",")[0]);
  if (cf) return cf;
  return normalizeIp(header(req, "x-forwarded-for").split(",")[0]);
}

/** Real client IP. CF-Connecting-IP and X-Forwarded-For are used only when the peer is trusted. */
export function clientIp(req, env = process.env) {
  const remote = normalizeIp(req?.socket?.remoteAddress || "");
  if (trusted(remote, env)) {
    const forwarded = firstForwarded(req);
    if (forwarded) return forwarded;
  }
  return remote || "unknown";
}
