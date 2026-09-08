export function apiHost() {
  return process.env.ROSTER_API_HOST || "127.0.0.1";
}

export function apiPort() {
  return Number(process.env.ROSTER_API_PORT || 8787);
}

export function publicUrl() {
  return process.env.ROSTER_PUBLIC_URL || "http://127.0.0.1:5173";
}

export function opencodeHostname() {
  return process.env.OPENCODE_HOSTNAME || "127.0.0.1";
}

export function rosterApiUrl() {
  return process.env.ROSTER_API || `http://127.0.0.1:${apiPort()}`;
}
