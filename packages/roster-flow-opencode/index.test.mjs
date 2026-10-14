import assert from "node:assert/strict";
import test from "node:test";
import { buildTools, wikiflowApi, wikiflowConfig } from "./index.js";

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
    { text: "done", blocks: JSON.stringify([{ type: "section", text: { type: "mrkdwn", text: "ok" } }]) },
    { agent: "product" },
  );
  const report = calls.find((c) => c.path === "/api/v1/bus/send" && JSON.parse(c.init.body).kind === "report");
  assert.equal(JSON.parse(report.init.body).blocks[0].type, "section");

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
    { owner: "o", repo: "r", slug: "arch", runId: "run-1", title: "Arch", markdown: "# A", sources: '["src/a.ts"]' },
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
    sources: ["src/a.ts"],
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
