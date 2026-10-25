/** Browser origins allowed to read API responses. Unset allowlist means same-origin only. */

function listedOrigins(env) {
  return String(env.ROSTER_CORS_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function allowOrigin(req, env = process.env) {
  const origin = String(req?.headers?.origin || req?.headers?.Origin || "").trim();
  if (!origin || origin.length > 200 || origin === "*") return "";
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  const list = listedOrigins(env);
  if (list.length) return list.includes(origin) ? origin : "";
  const host = String(req?.headers?.host || req?.headers?.Host || "").trim();
  if (host && parsed.host === host) return origin;
  return "";
}

export function corsHeaders(req, extra = {}, env = process.env) {
  const headers = {
    "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
    vary: "Origin",
    ...extra,
  };
  const origin = allowOrigin(req, env);
  if (origin) headers["access-control-allow-origin"] = origin;
  else delete headers["access-control-allow-origin"];
  return headers;
}
