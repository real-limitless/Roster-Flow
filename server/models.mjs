/** Team/seat model strategy: default, random, round-robin, fuse. */

export const STRATEGIES = ["default", "random", "round_robin", "fuse"];

export function uniqueModels(list = []) {
  return [...new Set(list.map((m) => String(m || "").trim()).filter(Boolean))];
}

export function teamModelPool(team = {}, seat = {}) {
  const pool = uniqueModels([
    ...(team.allowedModels || []),
    team.defaultModel,
    team.fallbackModel,
    seat.model,
    seat.fallbackModel,
  ]);
  return pool;
}

export function pickTeamModel(team, seat = {}) {
  const pool = teamModelPool(team, seat);
  const strategy = STRATEGIES.includes(team?.modelStrategy) ? team.modelStrategy : "default";
  if (!pool.length) return seat.model || team?.defaultModel || "";
  if (strategy === "random") {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (strategy === "round_robin") {
    const i = Number(team.rrIndex) || 0;
    team.rrIndex = (i + 1) % pool.length;
    return pool[i % pool.length];
  }
  return pool[0];
}

export function modelChainForSeat(seat, team) {
  if (team && (seat?.seatType === "generic" || seat?.seatType === "supervisor")) {
    const primary = pickTeamModel(team, seat);
    const rest = uniqueModels([
      seat?.fallbackModel,
      team.fallbackModel,
      ...(team.modelStrategy === "fuse" ? team.allowedModels || [] : []),
    ]).filter((m) => m !== primary);
    return uniqueModels([primary, ...rest]);
  }
  return uniqueModels([seat?.model, seat?.fallbackModel, team?.fallbackModel]);
}
