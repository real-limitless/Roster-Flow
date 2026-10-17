import { serveBaseUrl, subscribeServeEvents } from "./harness.mjs";
import { emit } from "./trace.mjs";

/**
 * Followers wait on the serve's shared `GET /event` subscription instead of
 * sleeping a fixed tick, and `session.idle` runs hooks such as metering.
 */
export const deps = {
  baseUrl: serveBaseUrl,
  subscribe: subscribeServeEvents,
  retryMs: 1000,
  maxRetryMs: 15_000,
};

/** Events that can mean a followed session has something new to read. */
const WAKE_TYPES = new Set(["message.updated", "session.idle", "session.error"]);
const IDLE_HOOK_TTL_MS = 10 * 60 * 1000;

const streams = new Map();
const waiters = new Set();
const idleHooks = new Map();

export function eventSessionId(evt) {
  const p = evt?.properties || {};
  return p.sessionID || p.info?.sessionID || p.part?.sessionID || null;
}

export function dispatchEvent(evt) {
  const sid = eventSessionId(evt);
  if (!sid) return;
  if (evt.type === "session.idle") {
    const hooks = idleHooks.get(sid);
    idleHooks.delete(sid);
    for (const h of hooks || []) {
      clearTimeout(h.timer);
      try {
        h.fn();
      } catch {
        /* a hook failing must not stop the stream */
      }
    }
  }
  if (!WAKE_TYPES.has(evt.type)) return;
  for (const w of [...waiters]) if (w.sessions.has(sid)) w.done("event");
}

/** Resolves "event" when one of the sessions has activity, else "timeout" after `ms`. */
export function waitForSessions(sessionIds, ms) {
  const sessions = new Set((sessionIds || []).filter(Boolean));
  if (!sessions.size || ms <= 0) return new Promise((r) => setTimeout(() => r("timeout"), Math.max(0, ms)));
  return new Promise((resolve) => {
    const w = {
      sessions,
      done(why) {
        clearTimeout(w.timer);
        waiters.delete(w);
        resolve(why);
      },
    };
    w.timer = setTimeout(() => w.done("timeout"), ms);
    waiters.add(w);
  });
}

/** Run `fn` once on the session's next `session.idle`; dropped after `ttlMs`. */
export function onSessionIdle(sessionId, fn, ttlMs = IDLE_HOOK_TTL_MS) {
  if (!sessionId) return;
  const hooks = idleHooks.get(sessionId) || new Set();
  const h = { fn };
  h.timer = setTimeout(() => {
    hooks.delete(h);
    if (!hooks.size) idleHooks.delete(sessionId);
  }, ttlMs);
  if (typeof h.timer.unref === "function") h.timer.unref();
  hooks.add(h);
  idleHooks.set(sessionId, hooks);
}

export function eventsConnected(kind) {
  return Boolean(streams.get(kind)?.connected);
}

async function readStream(kind, st, base) {
  const sub = deps.subscribe(kind, dispatchEvent, base);
  if (!sub) throw new Error("no serve");
  st.sub = sub;
  try {
    if (!(await sub.opened)) throw new Error("GET /event failed");
    st.connected = true;
    st.retry = deps.retryMs;
    emit({ scope: "harness", step: "events.connected", detail: { kind } });
    await Promise.race([sub.closed, new Promise((r) => st.abort.signal.addEventListener("abort", r, { once: true }))]);
  } finally {
    sub.unsubscribe();
    st.sub = null;
  }
}

async function run(kind, st) {
  while (!st.stopped) {
    const base = deps.baseUrl(kind);
    if (!base) break;
    try {
      await readStream(kind, st, base);
    } catch {
      /* reconnect below */
    }
    st.connected = false;
    if (st.stopped) break;
    await new Promise((r) => setTimeout(r, st.retry));
    st.retry = Math.min(st.retry * 2, deps.maxRetryMs);
  }
  st.connected = false;
  if (streams.get(kind) === st) streams.delete(kind);
}

/** Start the serve's event stream unless it is running. It stops when the serve goes offline. */
export function ensureEventStream(kind) {
  if (streams.has(kind) || !deps.baseUrl(kind)) return streams.get(kind) || null;
  const st = { connected: false, stopped: false, retry: deps.retryMs, abort: new AbortController() };
  streams.set(kind, st);
  st.done = run(kind, st);
  return st;
}

export async function stopEventStreams() {
  const all = [...streams.values()];
  for (const st of all) {
    st.stopped = true;
    st.abort.abort();
  }
  await Promise.all(all.map((st) => st.done?.catch(() => undefined)));
  streams.clear();
  for (const w of [...waiters]) w.done("timeout");
  for (const hooks of idleHooks.values()) for (const h of hooks) clearTimeout(h.timer);
  idleHooks.clear();
}
