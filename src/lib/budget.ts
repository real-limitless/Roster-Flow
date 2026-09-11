import type { Seat } from "../data";

export const BUDGET_WARN_RATIO = 0.8;

export function seatOverBudget(seat?: Seat | null) {
  if (!seat || seat.kind !== "bot" || seat.tokenBudget == null) return false;
  return Number(seat.spent || 0) >= seat.tokenBudget;
}

export function budgetRemaining(seat?: Seat | null) {
  if (!seat || seat.tokenBudget == null) return null;
  return Math.max(0, seat.tokenBudget - Number(seat.spent || 0));
}

export function budgetWarn(seat?: Seat | null) {
  if (!seat || seat.tokenBudget == null || seat.tokenBudget <= 0) return false;
  return Number(seat.spent || 0) / seat.tokenBudget >= BUDGET_WARN_RATIO && !seatOverBudget(seat);
}

export function budgetPaused(seat?: Seat | null) {
  return Boolean(seat && seat.status === "paused" && (seat.pauseReason === "budget" || seatOverBudget(seat)));
}
