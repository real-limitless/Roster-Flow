/** In-memory debug ring for Room / Architect / harness steps. */

const MAX = 200;
const events = [];
let seq = 0;

export function emit(partial = {}) {
  const event = {
    id: `tr-${++seq}`,
    ts: new Date().toISOString(),
    level: partial.level || "info",
    scope: partial.scope || "chat",
    step: String(partial.step || "event"),
    channel: partial.channel || null,
    seat: partial.seat || null,
    detail: partial.detail && typeof partial.detail === "object" ? partial.detail : partial.detail ? { message: String(partial.detail) } : {},
  };
  events.push(event);
  if (events.length > MAX) events.splice(0, events.length - MAX);
  return event;
}

export function listTrace({ since, channel, scope, limit = 80 } = {}) {
  let out = events;
  if (since) {
    const t = Date.parse(since);
    if (!Number.isNaN(t)) out = out.filter((e) => Date.parse(e.ts) > t);
  }
  if (channel) out = out.filter((e) => !e.channel || e.channel === channel);
  if (scope) out = out.filter((e) => e.scope === scope);
  return out.slice(-Math.max(1, Number(limit) || 80));
}

export function resetTrace() {
  events.length = 0;
  seq = 0;
}
