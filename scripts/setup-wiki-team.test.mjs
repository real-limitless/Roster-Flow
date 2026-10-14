import assert from "node:assert/strict";
import test from "node:test";
import { setupWikiTeam } from "./setup-wiki-team.mjs";

function fakeCore({ teamExists = false, seats = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    calls.push({ path, method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    let status = 200;
    let data = {};
    if (path === "/api/v1/projects") status = teamExists ? 409 : 201;
    if (path === "/api/v1/teams") status = teamExists ? 409 : 201;
    if (path === "/api/v1/seats" && method === "GET") data = seats;
    if (path === "/api/v1/seats" && method === "POST") status = 201;
    return { ok: status < 300, status, text: async () => JSON.stringify(data) };
  };
  return { calls, fetchImpl };
}

test("setup-wiki-team registers Featherless by env ref, project, and @wiki team", async () => {
  const { calls, fetchImpl } = fakeCore();
  const out = await setupWikiTeam({ env: { FEATHERLESS_API_KEY: "secret", ROSTER_API_TOKEN: "rf_test" }, fetchImpl, log() {} });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["PUT /api/v1/providers", "POST /api/v1/projects", "POST /api/v1/teams"]);
  assert.equal(calls[0].body.apiKeyEnv, "FEATHERLESS_API_KEY");
  assert.ok(!JSON.stringify(calls).includes("secret"), "API key must never be sent or written");
  const ids = calls[2].body.specialists.map((s) => s.id);
  assert.deepEqual(ids, ["wiki-architect", "wiki-scribe", "wiki-diagrammer", "wiki-editor"]);
  assert.ok(calls[2].body.specialists.every((s) => s.model.startsWith("featherless/")));
  assert.equal(out.teamCreated, true);
  assert.ok(calls.every((c) => c.headers.authorization === "Bearer rf_test"));
});

test("setup-wiki-team is idempotent: on 409 it only hires missing specialists", async () => {
  const { calls, fetchImpl } = fakeCore({ teamExists: true, seats: [{ id: "wiki-architect" }, { id: "wiki-scribe" }] });
  const out = await setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_test" }, fetchImpl, log() {} });
  assert.deepEqual(out.hired, ["wiki-diagrammer", "wiki-editor"]);
  const posts = calls.filter((c) => c.method === "POST" && c.path === "/api/v1/seats");
  assert.equal(posts.length, 2);
});

test("setup-wiki-team requires a token and reports a rejected one", async () => {
  await assert.rejects(setupWikiTeam({ env: {}, fetchImpl: async () => ({}), log() {} }), /ROSTER_API_TOKEN is required/);
  const revoked = async () => ({ ok: false, status: 401, text: async () => '{"error":"invalid, expired, or revoked API token"}' });
  await assert.rejects(setupWikiTeam({ env: { ROSTER_API_TOKEN: "rf_x" }, fetchImpl: revoked, log() {} }), /rejected \(401\)/);
});
