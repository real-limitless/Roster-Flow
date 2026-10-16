export const BUDGET_WARN_RATIO = 0.8;
const USAGE_CAP = 2000;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

export function currentBudgetPeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parseNonNegInt(name, value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) fail(400, `${name} must be a non-negative number`);
  return Math.floor(n);
}

export function budgetFieldsFromBody(body = {}) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(body, "tokenBudget")) {
    out.tokenBudget = parseNonNegInt("tokenBudget", body.tokenBudget);
  }
  if (Object.prototype.hasOwnProperty.call(body, "budgetCents")) {
    out.budgetCents = parseNonNegInt("budgetCents", body.budgetCents);
  }
  if (Object.prototype.hasOwnProperty.call(body, "spent")) {
    out.spent = parseNonNegInt("spent", body.spent) || 0;
  }
  return out;
}

export function rolloverSeatBudget(seat, now = new Date()) {
  if (!seat || seat.kind !== "bot") return seat;
  const period = currentBudgetPeriod(now);
  if (seat.budgetPeriod && seat.budgetPeriod !== period) {
    seat.spent = 0;
    seat.budgetPeriod = period;
    if (seat.pauseReason === "budget" && seat.status === "paused") {
      seat.status = "idle";
      seat.pauseReason = undefined;
    }
  }
  if (!seat.budgetPeriod) seat.budgetPeriod = period;
  if (seat.spent == null) seat.spent = 0;
  return seat;
}

export function seatOverBudget(seat) {
  if (!seat || seat.kind !== "bot") return false;
  const cap = seat.tokenBudget;
  if (cap == null) return false;
  return Number(seat.spent || 0) >= cap;
}

export function budgetRemaining(seat) {
  if (!seat || seat.tokenBudget == null) return null;
  return Math.max(0, seat.tokenBudget - Number(seat.spent || 0));
}

export function budgetWarn(seat) {
  if (!seat || seat.tokenBudget == null || seat.tokenBudget <= 0) return false;
  return Number(seat.spent || 0) / seat.tokenBudget >= BUDGET_WARN_RATIO && !seatOverBudget(seat);
}

export function applyBudgetSideEffects(seat) {
  if (!seat || seat.kind !== "bot") return seat;
  rolloverSeatBudget(seat);
  if (seatOverBudget(seat)) {
    seat.status = "paused";
    seat.pauseReason = "budget";
  } else if (seat.pauseReason === "budget" && seat.status === "paused") {
    seat.status = "idle";
    seat.pauseReason = undefined;
  }
  return seat;
}

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

const USD_PER_M = {
  openai: { in: 5, out: 15 },
  anthropic: { in: 3, out: 15 },
  xai: { in: 3, out: 15 },
  google: { in: 1.25, out: 10 },
  opencode: { in: 0, out: 0 },
};

export function estimateUsd(model, inputTokens, outputTokens) {
  const provider = String(model || "").split("/")[0] || "";
  const rates = USD_PER_M[provider] || { in: 1, out: 3 };
  return Number((((inputTokens || 0) * rates.in + (outputTokens || 0) * rates.out) / 1_000_000).toFixed(6));
}

function usageId() {
  return `use-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function meterWake(state, event = {}) {
  const seat = (state.seats || []).find((s) => s.id === event.seatId);
  if (!seat || seat.kind !== "bot") return null;
  rolloverSeatBudget(seat);
  const inputTokens = Math.max(0, Math.floor(Number(event.inputTokens) || 0));
  const outputTokens = Math.max(0, Math.floor(Number(event.outputTokens) || 0));
  const tokens = inputTokens + outputTokens;
  seat.spent = Number(seat.spent || 0) + tokens;
  if (!Array.isArray(state.usage)) state.usage = [];
  const row = publicUsageRow({
    id: event.id || usageId(),
    seatId: seat.id,
    runId: event.runId || null,
    teamId: seat.team || null,
    projectId: seat.projectId || null,
    model: event.model || seat.model || null,
    inputTokens,
    outputTokens,
    tokens,
    usdEstimate: estimateUsd(event.model || seat.model, inputTokens, outputTokens),
    hours: Number(((Number(event.ms) || 0) / 3_600_000).toFixed(6)),
    ms: Math.max(0, Math.floor(Number(event.ms) || 0)),
    source: event.source || "wake",
    time: event.time || new Date().toISOString(),
  });
  state.usage.push(row);
  if (state.usage.length > USAGE_CAP) state.usage = state.usage.slice(-USAGE_CAP);
  applyBudgetSideEffects(seat);
  return { seat, row, over: seatOverBudget(seat) };
}

export function publicUsageRow(row = {}) {
  const blocked = new Set(["apiKey", "token", "secret", "authorization", "password", "key"]);
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (blocked.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export function listUsage(state, query = {}) {
  const projectId = query.projectId || null;
  const teamId = query.teamId || null;
  const seatId = query.seatId || null;
  return (state.usage || [])
    .map(publicUsageRow)
    .filter((row) => {
      if (projectId && row.projectId !== projectId) return false;
      if (teamId && row.teamId !== teamId) return false;
      if (seatId && row.seatId !== seatId) return false;
      return true;
    });
}

const CSV_COLS = [
  "time",
  "seatId",
  "teamId",
  "projectId",
  "model",
  "inputTokens",
  "outputTokens",
  "tokens",
  "usdEstimate",
  "hours",
  "source",
  "runId",
];

export function usageCsv(rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [CSV_COLS.join(",")];
  for (const row of rows || []) {
    lines.push(CSV_COLS.map((k) => esc(row[k])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function summarizeUsage(rows) {
  const list = rows || [];
  return {
    wakes: list.length,
    tokens: list.reduce((n, r) => n + Number(r.tokens || 0), 0),
    usd: Number(list.reduce((n, r) => n + Number(r.usdEstimate || 0), 0).toFixed(6)),
    hours: Number(list.reduce((n, r) => n + Number(r.hours || 0), 0).toFixed(6)),
  };
}
