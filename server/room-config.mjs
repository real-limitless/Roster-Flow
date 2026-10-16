export const RESPOND_MODES = ["lead", "team", "conductor", "quiet"];

export const ROOM_LIMIT_DEFAULTS = Object.freeze({
  implicitPerMinute: 4,
  fanout: 3,
  maxHops: 4,
  maxBotWakesPerThread: 8,
  /** Null: no daily room budget. */
  tokensPerDay: null,
});

const LIMIT_MAX = { fanout: 10, tokensPerDay: 1_000_000_000 };

export function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Unknown or missing modes fall back to "lead"; `strict` throws instead (PATCH input). */
export function normalizeRespond(value, { strict = false } = {}) {
  if (value === undefined || value === null || value === "") return "lead";
  const mode = String(value);
  if (RESPOND_MODES.includes(mode)) return mode;
  if (strict) throw badRequest(`respond must be one of ${RESPOND_MODES.join(", ")}`);
  return "lead";
}

/** Keeps only known limits with positive integer values. `strict` rejects bad input. */
export function normalizeLimits(value, { strict = false } = {}) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    if (strict) throw badRequest("limits must be an object");
    return {};
  }
  const out = {};
  for (const key of Object.keys(ROOM_LIMIT_DEFAULTS)) {
    if (!(key in value)) continue;
    const raw = value[key];
    if (raw === null || raw === "") continue;
    const n = Number(raw);
    const max = LIMIT_MAX[key] || 1000;
    if (Number.isInteger(n) && n > 0 && n <= max) out[key] = n;
    else if (strict) throw badRequest(`limits.${key} must be a whole number from 1 to ${max}`);
  }
  return out;
}

export function roomLimits(channel) {
  return { ...ROOM_LIMIT_DEFAULTS, ...normalizeLimits(channel?.limits) };
}

export function teamRoomId(teamId) {
  return `team-${teamId}`;
}

/** The home room record for a staffed team: the team's seats plus the owner, led by the supervisor. */
export function teamHomeRoom(team, ownerId = "you") {
  const label = String(team.name || team.id).replace(/^@/, "");
  return {
    id: teamRoomId(team.id),
    name: `#${label}`,
    topic: team.job || team.role || "",
    teamIds: [team.id],
    seatIds: ["channel", ownerId],
    leadSeatId: team.supervisorSeatId || null,
    respond: "lead",
    limits: {},
  };
}
