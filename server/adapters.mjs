import { createHmac, timingSafeEqual } from "node:crypto";
import { getState, mutate } from "./store.mjs";
import { rosterApiUrl } from "./config.mjs";

export const ADAPTERS = ["opencode", "webhook", "claude-code", "codex"];

export const deps = {
  fetchFn: globalThis.fetch.bind(globalThis),
};

export function normalizeAdapter(seat) {
  const raw = String(seat?.adapter || "opencode").toLowerCase().trim();
  if (ADAPTERS.includes(raw)) return raw;
  return "opencode";
}

export function isOpenCodeAdapter(seat) {
  return normalizeAdapter(seat) === "opencode";
}

export function publicSeat(seat) {
  if (!seat) return seat;
  const { adapterSecret, ...rest } = seat;
  return {
    ...rest,
    adapter: normalizeAdapter(seat),
    hasAdapterSecret: Boolean(adapterSecret),
  };
}

export function publicSeats(seats = []) {
  return seats.map(publicSeat);
}

function sameSecret(a, b) {
  const ha = createHmac("sha256", "roster-adapter").update(String(a || "")).digest();
  const hb = createHmac("sha256", "roster-adapter").update(String(b || "")).digest();
  return timingSafeEqual(ha, hb);
}

export function adapterSecretOk(seat, req) {
  const expected = String(seat?.adapterSecret || "").trim();
  if (!expected) return true;
  const presented = String(req?.headers?.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim() || String(req?.headers?.["x-roster-adapter-secret"] || "").trim();
  return sameSecret(expected, presented);
}

export function adapterWakePayload(seat, text, meta = {}) {
  const id = seat.id;
  const base = rosterApiUrl();
  return {
    seatId: id,
    name: seat.name,
    adapter: normalizeAdapter(seat),
    kind: meta.kind || "send_message",
    from: meta.from || "bus",
    text: String(text || ""),
    runId: meta.runId || null,
    channel: meta.channel || null,
    via: meta.via || null,
    callbacks: {
      report: `${base}/api/v1/seats/${id}/adapter/report`,
      handoff: `${base}/api/v1/seats/${id}/adapter/handoff`,
    },
  };
}

function recordWake(seatId, row) {
  mutate((s) => {
    const seat = (s.seats || []).find((x) => x.id === seatId);
    if (seat) seat.lastAdapterWake = row;
  });
}

export async function wakeAdapter(seat, text, meta = {}) {
  const adapter = normalizeAdapter(seat);
  const payload = adapterWakePayload(seat, text, meta);
  const url = String(seat.adapterUrl || "").trim();
  const headers = { "content-type": "application/json" };
  if (seat.adapterSecret) headers.authorization = `Bearer ${seat.adapterSecret}`;

  if (adapter === "webhook" && !url) {
    const row = { at: new Date().toISOString(), adapter, ok: false, error: "adapterUrl required" };
    recordWake(seat.id, row);
    return { adapter, error: "adapterUrl required", seat: seat.id };
  }

  if (url) {
    try {
      const res = await deps.fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const row = {
        at: new Date().toISOString(),
        adapter,
        ok: res.ok,
        status: res.status,
        url,
      };
      recordWake(seat.id, row);
      return { adapter, notified: true, status: res.status, seat: seat.id, payload };
    } catch (err) {
      const row = { at: new Date().toISOString(), adapter, ok: false, error: err.message || "fetch failed" };
      recordWake(seat.id, row);
      return { adapter, error: err.message || "fetch failed", seat: seat.id, payload };
    }
  }

  const hint =
    adapter === "claude-code"
      ? "Notify the existing Claude Code session; do not paste keys into OpenCode."
      : adapter === "codex"
        ? "Notify the existing Codex session; CORE is not a second runtime."
        : "Set adapterUrl to receive wakes.";
  const row = { at: new Date().toISOString(), adapter, ok: true, notified: true };
  recordWake(seat.id, row);
  return { adapter, notified: true, seat: seat.id, hint, payload };
}

export function parseAdapterCallback(body = {}) {
  const text = String(body.text || body.report || "").trim();
  const to = body.to || (body.kind === "handoff" ? body.target : "channel:ship");
  const channel = body.channel || "ship";
  return { text, to, channel };
}
