import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { after } from "node:test";
import {
  deps,
  dispatchEvent,
  ensureEventStream,
  eventSessionId,
  eventsConnected,
  onSessionIdle,
  stopEventStreams,
  waitForSessions,
} from "./events.mjs";
import { subscribeServeEvents } from "./harness.mjs";

after(() => stopEventStreams());

test("eventSessionId reads the session from every event shape", () => {
  assert.equal(eventSessionId({ properties: { sessionID: "a" } }), "a");
  assert.equal(eventSessionId({ properties: { info: { sessionID: "b" } } }), "b");
  assert.equal(eventSessionId({ properties: { part: { sessionID: "c" } } }), "c");
  assert.equal(eventSessionId({ properties: {} }), null);
});

test("waitForSessions ends early on an event for a followed session only", async () => {
  const other = waitForSessions(["s-other"], 30);
  const mine = waitForSessions(["s-mine"], 5000);
  dispatchEvent({ type: "message.part.updated", properties: { part: { sessionID: "s-mine" } } });
  dispatchEvent({ type: "message.updated", properties: { info: { sessionID: "s-mine" } } });
  assert.equal(await mine, "event");
  assert.equal(await other, "timeout");
  assert.equal(await waitForSessions([], 0), "timeout");
});

test("onSessionIdle runs once on the session's next idle", () => {
  let n = 0;
  onSessionIdle("s-idle", () => (n += 1));
  dispatchEvent({ type: "session.status", properties: { sessionID: "s-idle", status: { type: "busy" } } });
  assert.equal(n, 0);
  dispatchEvent({ type: "session.idle", properties: { sessionID: "s-idle" } });
  dispatchEvent({ type: "session.idle", properties: { sessionID: "s-idle" } });
  assert.equal(n, 1);
});

test("ensureEventStream reads GET /event from the serve and dispatches its events", async () => {
  let client = null;
  const server = createServer((req, res) => {
    if (req.url !== "/event") return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
    client = res;
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const prev = { ...deps };
  deps.baseUrl = (kind) => (kind === "company" ? `http://127.0.0.1:${server.address().port}` : null);
  try {
    ensureEventStream("company");
    assert.equal(ensureEventStream("system"), null);
    for (let i = 0; i < 100 && !(eventsConnected("company") && client); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(eventsConnected("company"));
    const waiting = waitForSessions(["ses-sse"], 5000);
    const evt = JSON.stringify({ type: "session.idle", properties: { sessionID: "ses-sse" } });
    client.write(`data: ${evt.slice(0, 20)}`);
    client.write(`${evt.slice(20)}\n\n`);
    assert.equal(await waiting, "event");
  } finally {
    await stopEventStreams();
    Object.assign(deps, prev);
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  assert.equal(eventsConnected("company"), false);
});

test("followers and provider-turn watchers share one GET /event connection per serve, and it reconnects", async () => {
  let connections = 0;
  let client = null;
  const server = createServer((req, res) => {
    if (req.url !== "/event") return res.writeHead(404).end();
    connections += 1;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
    client = res;
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const prev = { ...deps };
  deps.baseUrl = (kind) => (kind === "company" ? base : null);
  deps.retryMs = 10;
  const seen = [];
  try {
    ensureEventStream("company");
    for (let i = 0; i < 100 && !eventsConnected("company"); i++) await new Promise((r) => setTimeout(r, 10));
    const watcher = subscribeServeEvents("company", (ev) => seen.push(ev.type), base);
    assert.equal(await watcher.opened, true);
    const waiting = waitForSessions(["ses-shared"], 5000);
    client.write(`data: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "ses-shared" } })}\n\n`);
    assert.equal(await waiting, "event");
    assert.deepEqual(seen, ["session.idle"]);
    assert.equal(connections, 1);
    watcher.unsubscribe();
    assert.equal(eventsConnected("company"), true);
    client.end();
    for (let i = 0; i < 200 && connections < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(connections, 2);
  } finally {
    await stopEventStreams();
    Object.assign(deps, prev);
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
