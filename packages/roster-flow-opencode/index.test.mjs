import assert from "node:assert/strict";
import test from "node:test";
import { buildTools, rosterAuthHeaders, systemBlock, wikiflowApi, wikiflowConfig } from "./index.js";

function fakeTool(def) {
  return def;
}
fakeTool.schema = {
  string: () => ({
    describe() {
      return this;
    },
    optional() {
      return this;
    },
  }),
};

test("plugin tools POST to CORE bus (Oh My OpenAgent shape)", async () => {
  const calls = [];
  const fetchApi = async (path, init = {}) => {
    calls.push({ path, init });
    if (path === "/api/v1/seats") {
      return [
        { id: "product", name: "Product", kind: "bot", reportsTo: "maya" },
        { id: "build", name: "Eng.Build", kind: "bot", reportsTo: "jules" },
        { id: "maya", name: "Maya", kind: "human" },
      ];
    }
    if (path === "/api/v1/teams") return [{ id: "eng" }];
    if (path === "/api/v1/projects") return [{ id: "billing" }];
    if (path === "/api/v1/architect/chat") return { reply: "plan", plan: { id: "plan-1", summary: "Cut scout", ops: [] } };
    return { id: "bus-1", path };
  };
  const tools = buildTools(fakeTool, fetchApi);
  const listed = await tools.roster_list_seats.execute();
  assert.match(listed.output, /product/);

  const sent = await tools.roster_send_message.execute(
    { to: "build", text: "brief", blocks: JSON.stringify([{ type: "header", text: { type: "plain_text", text: "Hi" } }]) },
    { agent: "product" },
  );
  assert.match(sent.title, /build/);
  const sendCall = calls.find((c) => c.path === "/api/v1/messages");
  const sendBody = JSON.parse(sendCall.init.body);
  assert.equal(sendBody.wake, true);
  assert.equal(sendBody.blocks[0].type, "header");

  await tools.roster_report.execute(
    {
      text: "done",
      prUrl: "https://github.com/acme/app/pull/1",
      branch: "eng/webhook",
      blocks: JSON.stringify([{ type: "section", text: { type: "mrkdwn", text: "ok" } }]),
    },
    { agent: "product" },
  );
  const report = calls.find((c) => c.path === "/api/v1/bus/send" && JSON.parse(c.init.body).kind === "report");
  const reportBody = JSON.parse(report.init.body);
  assert.equal(reportBody.blocks[0].type, "section");
  assert.equal(reportBody.prUrl, "https://github.com/acme/app/pull/1");
  assert.equal(reportBody.branch, "eng/webhook");

  await tools.roster_handoff.execute({ to: "build", text: "your turn" }, { agent: "product" });
  const hand = calls.find((c) => c.path === "/api/v1/bus/send" && JSON.parse(c.init.body).kind === "handoff");
  assert.ok(hand);

  await tools.roster_ask_human.execute({ text: "approve?" }, { agent: "product" });
  const ask = calls.filter((c) => c.path === "/api/v1/bus/send").at(-1);
  assert.equal(JSON.parse(ask.init.body).to, "maya");

  const proposed = await tools.roster_propose_org.execute({ message: "staff mobile" });
  assert.match(proposed.title, /Cut scout|Org plan|plan/i);
  assert.ok(calls.some((c) => c.path === "/api/v1/architect/chat"));

  await tools.roster_inbox.execute({}, { agent: "build" });
  assert.ok(calls.some((c) => c.path === "/api/v1/seats/build/inbox"));

  await tools.roster_knowledge.execute({ q: "webhook" }, { agent: "build" });
  assert.ok(calls.some((c) => String(c.path).includes("/api/v1/projects/billing/knowledge") && String(c.path).includes("q=webhook")));
  await tools.roster_task_claim.execute({ taskId: "task-eng-implement" }, { agent: "build" });
  assert.ok(calls.some((c) => c.path === "/api/v1/tasks/task-eng-implement/claim"));
  await tools.roster_report.execute(
    { text: "PR opened", jobId: "job-1", cost: "0.2", tokens: '{"input":3,"output":1}', prUrl: "https://github.com/o/r/pull/7" },
    { agent: "build" },
  );
  const completed = calls.find((c) => c.path === "/api/v1/jobs/job-1/complete");
  const completedBody = JSON.parse(completed.init.body);
  assert.equal(completedBody.status, "done");
  assert.equal(completedBody.result, "PR opened");
  assert.equal(completedBody.cost, 0.2);
  assert.deepEqual(completedBody.tokens, { input: 3, output: 1 });
  assert.equal(completedBody.from, "build");
  assert.equal(completedBody.prUrl, "https://github.com/o/r/pull/7");

  await tools.roster_ask_human.execute({ text: "approve?", jobId: "job-1" }, { agent: "build" });
  const parked = calls.filter((c) => c.path === "/api/v1/jobs/job-1/complete").at(-1);
  assert.equal(JSON.parse(parked.init.body).status, "needs_human");
  assert.equal(JSON.parse(parked.init.body).announce, false);
  const askJob = calls.filter((c) => c.path === "/api/v1/bus/send").at(-1);
  assert.equal(JSON.parse(askJob.init.body).jobId, "job-1");
  assert.equal(JSON.parse(askJob.init.body).kind, "ask_human");
});

test("plugin sends ROSTER_API_TOKEN when the harness has one", () => {
  assert.deepEqual(rosterAuthHeaders({}), {});
  assert.deepEqual(rosterAuthHeaders({ ROSTER_API_TOKEN: "rf_seat" }), { authorization: "Bearer rf_seat" });
});

test("wikiflow tools hit the documented wiki-flow paths", async () => {
  const calls = [];
  const wikiApi = async (path, init = {}) => {
    calls.push({ path, init });
    return { ok: true };
  };
  const tools = buildTools(fakeTool, async () => ({}), wikiApi);
  await tools.wikiflow_read_source.execute({ owner: "real-limitless", repo: "Roster-Flow" });
  await tools.wikiflow_read_source.execute({ owner: "o", repo: "r", paths: "src/a.ts, README.md" });
  await tools.wikiflow_search.execute({ owner: "real-limitless", repo: "Roster-Flow", q: "port config" });
  await tools.wikiflow_put_page.execute(
    { owner: "o", repo: "r", slug: "arch", runId: "run-1", title: "Arch", markdown: "# A", sources: '[{"path":"src/a.ts","startLine":3,"endLine":9},{"path":"README.md"}]' },
    { agent: "wiki-scribe" },
  );
  assert.equal(calls[0].path, "/api/v1/repos/real-limitless/Roster-Flow/sources");
  assert.equal(calls[1].path, "/api/v1/repos/o/r/sources?paths=src%2Fa.ts,README.md");
  assert.equal(calls[2].path, "/api/v1/repos/real-limitless/Roster-Flow/sources/search?q=port%20config");
  assert.equal(calls[3].path, "/api/v1/repos/o/r/pages/arch");
  assert.equal(calls[3].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    runId: "run-1",
    title: "Arch",
    markdown: "# A",
    sources: [{ path: "src/a.ts", startLine: 3, endLine: 9 }, { path: "README.md" }],
    agent: "wiki-scribe",
  });
});

test("wikiflow client fails clearly without a token and sends Bearer auth", async () => {
  assert.throws(() => wikiflowConfig({ WIKIFLOW_URL: "http://w" }), /WIKIFLOW_TOKEN is not set/);
  assert.throws(() => wikiflowConfig({ WIKIFLOW_TOKEN: "t" }), /WIKIFLOW_URL is not set/);
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, text: async () => "[]" };
  };
  const out = await wikiflowApi("/api/v1/repos/o/r/sources", {}, { WIKIFLOW_URL: "http://w/", WIKIFLOW_TOKEN: "tok" }, fetchImpl);
  assert.deepEqual(out, []);
  assert.equal(seen.url, "http://w/api/v1/repos/o/r/sources");
  assert.equal(seen.init.headers.authorization, "Bearer tok");
  const failing = async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => '{"error":"bad token"}' });
  await assert.rejects(
    wikiflowApi("/x", {}, { WIKIFLOW_URL: "http://w", WIKIFLOW_TOKEN: "tok" }, failing),
    /wiki-flow 401: bad token/,
  );
});

test("wikiflow_put_page validates sources entries as {path, startLine?, endLine?}", async () => {
  const tools = buildTools(fakeTool, async () => ({}), async () => ({}));
  const base = { owner: "o", repo: "r", slug: "s", runId: "run", title: "T", markdown: "m" };
  const bad = [
    ['["src/a.ts"]', /sources\[0\] must be/],
    ['[{"startLine":1}]', /sources\[0\]\.path is required/],
    ['[{"path":"a","line":1}]', /unknown keys: line/],
    ['[{"path":"a","startLine":0}]', /startLine must be a positive integer/],
    ['[{"path":"a","startLine":5,"endLine":2}]', /endLine must be >= startLine/],
    ['{"path":"a"}', /must be a JSON array/],
  ];
  for (const [sources, re] of bad) {
    await assert.rejects(tools.wikiflow_put_page.execute({ ...base, sources }, {}), re);
  }
});

test("systemBlock scopes a room session to the room's members and the caller's team", () => {
  const seats = [
    { id: "channel", name: "Channel", kind: "bot", job: "Conduct", instructions: "LONG CONDUCTOR TEXT" },
    { id: "build", name: "Eng.Build", kind: "bot", team: "eng", job: "Ship the PR", instructions: "LONG BUILD TEXT" },
    { id: "review", name: "Eng.Review", kind: "bot", team: "eng", job: "Review" },
    { id: "scout", name: "Scout", kind: "bot", team: "services", job: "Search" },
    { id: "maya", name: "Maya", kind: "human", job: "Design" },
  ];
  const teams = [
    { id: "eng", name: "@eng", seatIds: ["build", "review"] },
    { id: "services", name: "@services", seatIds: ["scout"] },
  ];
  const channels = [
    { id: "general", name: "#general", teamIds: [], seatIds: ["channel", "maya"] },
    { id: "incidents", name: "#incidents", teamIds: ["services"], seatIds: ["channel"] },
  ];
  const room = systemBlock({ seats, teams, channels, bound: { kind: "room", seatId: "build", channelId: "general" } }).join("\n");
  assert.match(room, /Current room: #general/);
  assert.match(room, /maya: Maya \(human\) — Design/);
  assert.match(room, /review: Eng\.Review · team=eng — Review/);
  assert.doesNotMatch(room, /scout/);
  assert.doesNotMatch(room, /#incidents/);
  assert.doesNotMatch(room, /LONG/);
  const dm = systemBlock({ seats, teams, channels, bound: { kind: "dm", seatId: "build", channelId: "dm-build" } }).join("\n");
  assert.match(dm, /#incidents/);
  assert.match(dm, /scout: Scout/);
  assert.match(dm, /LONG BUILD TEXT/);
  assert.ok(room.length < dm.length);
});
