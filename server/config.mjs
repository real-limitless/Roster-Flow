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

function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

function cleanUrl(value) {
  return stripTrailingSlashes(String(value || "").trim());
}

const REDACTED_URL = "[redacted]";

function indexOfCode(value, code, from = 0) {
  for (let i = from; i < value.length; i++) if (value.charCodeAt(i) === code) return i;
  return -1;
}

function isAllDigits(value) {
  if (!value) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/**
 * Drop query, fragment, and authority userinfo from a string `new URL()` will
 * not treat as http(s). A value with nothing safe to keep becomes a placeholder
 * so the raw input is never written to a log line.
 */
function redactUnparsedUrl(value) {
  let cut = value.length;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 63 || c === 35) {
      cut = i;
      break;
    }
  }
  const head = value.slice(0, cut);
  const scheme = head.indexOf("://");
  const authStart = scheme === -1 ? 0 : scheme + 3;
  const slash = indexOfCode(head, 47, authStart);
  const authEnd = slash === -1 ? head.length : slash;
  let at = -1;
  for (let i = authEnd - 1; i >= authStart; i--) {
    if (head.charCodeAt(i) === 64) {
      at = i;
      break;
    }
  }
  let shown = head;
  if (at !== -1) {
    shown = `${head.slice(0, authStart)}[redacted]@${head.slice(at + 1)}`;
  } else {
    const colon = indexOfCode(head, 58, authStart);
    if (colon !== -1 && colon < authEnd && !isAllDigits(head.slice(colon + 1, authEnd))) {
      shown = `${head.slice(0, authStart)}[redacted]${head.slice(authEnd)}`;
    }
  }
  shown = stripTrailingSlashes(shown);
  if (!shown || shown === value) return REDACTED_URL;
  return shown;
}

/** Drop userinfo and query from a URL before it is written to a log line. */
export function wikiflowDisplayUrl(url) {
  const raw = cleanUrl(url);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      return stripTrailingSlashes(parsed.toString());
    }
  } catch {
    /* fall through and redact without echoing the raw value */
  }
  return redactUnparsedUrl(raw);
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
