import { serveBaseUrl } from "./harness.mjs";
import { emit } from "./trace.mjs";

/**
 * One `GET /event` SSE stream per OpenCode serve. Followers wait on it instead
 * of sleeping a fixed tick, and `session.idle` runs hooks such as metering.
 */
export const deps = {
  baseUrl: serveBaseUrl,
  fetch: (...args) => fetch(...args),
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

/** Split SSE text into complete `data:` payloads; returns the parsed events and the unfinished tail. */
export function parseSse(buffer) {
  const events = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      /* not JSON: ignore */
    }
  }
  return { events, rest };
}

async function readStream(kind, st, base) {
  const res = await deps.fetch(`${base}/event`, { headers: { accept: "text/event-stream" }, signal: st.abort.signal });
  if (!res.ok || !res.body) throw new Error(`GET /event ${res.status}`);
  st.connected = true;
  st.retry = deps.retryMs;
  emit({ scope: "harness", step: "events.connected", detail: { kind } });
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    for (const evt of parsed.events) dispatchEvent(evt);
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
