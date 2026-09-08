/** Parse @mentions from Room text and resolve them to seats, teams, or the Channel conductor. */

export const CONDUCTOR_ID = "channel";

const TOKEN = /@([A-Za-z0-9._-]+)/g;

export function extractMentions(text) {
  const out = [];
  const seen = new Set();
  for (const match of String(text || "").matchAll(TOKEN)) {
    const raw = match[1];
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[\s.]+/g, "");
}

export function resolveMention(token, { seats = [], teams = [] } = {}) {
  const t = String(token || "")
    .toLowerCase()
    .replace(/^@/, "");
  if (t === "channel" || t === "here") {
    return { kind: "channel", id: CONDUCTOR_ID, token: t };
  }
  const team = teams.find((x) => x.id === t || norm(x.name) === norm(t));
  if (team) return { kind: "team", id: team.id, token: t };
  const seat = seats.find(
    (s) =>
      s.id.toLowerCase() === t ||
      norm(s.name) === norm(t) ||
      norm(s.id) === norm(t),
  );
  if (seat) return { kind: "seat", id: seat.id, token: t };
  return { kind: "unknown", id: t, token: t };
}

export function parseMentions(text, roster = {}) {
  return extractMentions(text)
    .map((token) => resolveMention(token, roster))
    .filter((m) => m.kind !== "unknown");
}
