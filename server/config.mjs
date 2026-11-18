export function apiHost() {
  return process.env.ROSTER_API_HOST || "127.0.0.1";
}

export function apiPort() {
  return Number(process.env.ROSTER_API_PORT || 8790);
}

export function webPort() {
  return Number(process.env.ROSTER_WEB_PORT || 5175);
}

export function publicUrl() {
  return process.env.ROSTER_PUBLIC_URL || `http://127.0.0.1:${webPort()}`;
}

export function opencodeHostname() {
  return process.env.OPENCODE_HOSTNAME || "127.0.0.1";
}

export function rosterApiUrl() {
  return process.env.ROSTER_API || `http://127.0.0.1:${apiPort()}`;
}

function cleanUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

/** Drop userinfo and query from a URL before it is written to a log line. */
export function wikiflowDisplayUrl(url) {
  const raw = cleanUrl(url);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return raw;
  }
}

/**
 * Wiki-flow location and bearer token.
 * `WIKIFLOW_URL` is the base URL. Empty means wiki-flow is off (no default host).
 * `WIKIFLOW_API` is the deprecated name for that URL and is still accepted.
 * `WIKIFLOW_TOKEN` is sent as `Authorization: Bearer`. Never log `token`.
 */
export function wikiflowConfig(env = process.env) {
  const primary = cleanUrl(env.WIKIFLOW_URL);
  const legacy = cleanUrl(env.WIKIFLOW_API);
  const url = primary || legacy;
  const token = String(env.WIKIFLOW_TOKEN || "").trim();
  return {
    url,
    token,
    enabled: Boolean(url && token),
    source: primary ? "WIKIFLOW_URL" : legacy ? "WIKIFLOW_API" : "",
    legacyIgnored: Boolean(primary && legacy),
  };
}

/** Replace a whole token. A shorter fragment inside another word is left alone. */
export function redactWikiflowSecret(message, token) {
  const text = String(message || "");
  const secret = String(token || "");
  if (!secret) return text;
  const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, "g"), "[redacted]");
}

/** Headers for a wiki-flow request. Empty when no token is configured. */
export function wikiflowAuthHeaders(env = process.env) {
  const { token } = wikiflowConfig(env);
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Startup notes. A set URL with no token warns and does not throw, so CORE
 * keeps serving instead of restarting.
 * Returned strings never include the token.
 */
export function wikiflowWarnings(env = process.env) {
  const cfg = wikiflowConfig(env);
  const notes = [];
  if (cfg.legacyIgnored) {
    notes.push(
      "WIKIFLOW_API is deprecated and ignored because WIKIFLOW_URL is set. Remove WIKIFLOW_API and keep WIKIFLOW_URL.",
    );
  } else if (cfg.source === "WIKIFLOW_API") {
    notes.push(
      "WIKIFLOW_API is deprecated. Set WIKIFLOW_URL to the wiki-flow base URL. WIKIFLOW_API is still accepted.",
    );
  }
  if (cfg.url && !cfg.token) {
    const where = wikiflowDisplayUrl(cfg.url);
    const label = cfg.source === "WIKIFLOW_API" ? "WIKIFLOW_API" : "WIKIFLOW_URL";
    notes.push(
      `${label} is set (${where}) but WIKIFLOW_TOKEN is missing. Set WIKIFLOW_TOKEN to the wiki-flow API bearer token. Wiki-flow stays disabled and Roster keeps running.`,
    );
  }
  return notes.map((note) => redactWikiflowSecret(note, cfg.token));
}
