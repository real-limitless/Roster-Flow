import assert from "node:assert/strict";
import test from "node:test";
import { addFirstUser, userFromToken } from "./auth.mjs";
import { pendingState } from "./seed.mjs";
import { publicState } from "./setup.mjs";
import { bootCore } from "./test-helpers.mjs";
import {
  createApiToken,
  hashToken,
  listApiTokens,
  requiredScope,
  resolveApiToken,
  revokeApiToken,
  seedApiTokenFromEnv,
  tokenAllows,
} from "./tokens.mjs";
import { setupWikiTeam } from "../scripts/setup-wiki-team.mjs";

async function withOwner() {
  const state = pendingState();
  await addFirstUser(state, { name: "Ops", email: "ops@example.com", password: "password1" });
  return state;
}

test("tokens are stored hashed, shown once, and resolve to the owner", async () => {
  const state = await withOwner();
  const { token, record } = createApiToken(state, { name: "ci", scopes: ["read", "write"] });
  assert.match(token, /^rf_[0-9a-f]{48}$/);
  assert.equal(record.hash, undefined);
  assert.equal(state.apiTokens[0].hash, hashToken(token));
  assert.ok(!JSON.stringify(state.apiTokens).includes(token));
  assert.ok(!JSON.stringify(listApiTokens(state)).includes(state.apiTokens[0].hash));
  assert.ok(!("apiTokens" in publicState(state)));
  assert.equal(userFromToken(state, token).email, "ops@example.com");
});

test("revoked and expired tokens no longer resolve", async () => {
  const state = await withOwner();
  const a = createApiToken(state, { name: "a", scopes: "read" });
  revokeApiToken(state, a.record.id);
  assert.equal(resolveApiToken(state, a.token), null);
  const now = Date.now();
  const b = createApiToken(state, { name: "b", scopes: "read", expiresInDays: 1 }, now);
  assert.ok(resolveApiToken(state, b.token, now + 1000));
  assert.equal(resolveApiToken(state, b.token, now + 2 * 86400000), null);
  assert.throws(() => revokeApiToken(state, "tok-missing"), (e) => e.status === 404);
});

test("scopes gate methods and admin paths", async () => {
  assert.equal(requiredScope("GET", "/api/v1/seats"), "read");
  assert.equal(requiredScope("POST", "/api/v1/teams"), "write");
  assert.equal(requiredScope("GET", "/api/v1/tokens"), "admin");
  assert.equal(tokenAllows({ scopes: ["read"] }, "GET", "/api/v1/seats"), true);
  assert.equal(tokenAllows({ scopes: ["read"] }, "POST", "/api/v1/teams"), false);
  assert.equal(tokenAllows({ scopes: ["write"] }, "GET", "/api/v1/seats"), true);
  assert.equal(tokenAllows({ scopes: ["write"] }, "POST", "/api/v1/tokens"), false);
  assert.equal(tokenAllows({ scopes: ["admin"] }, "DELETE", "/api/v1/tokens/x"), true);
  const state = await withOwner();
  assert.throws(() => createApiToken(state, { name: "x", scopes: ["root"] }), /unknown scope/);
  assert.throws(() => createApiToken(state, { name: "" }), /name required/);
  assert.throws(() => createApiToken(pendingState(), { name: "x" }), (e) => e.status === 409);
});

test("ROSTER_API_TOKEN seeds once an owner exists, idempotently", async () => {
  const env = { ROSTER_API_TOKEN: "rf_bootstrap_token_value_0123456789" };
  assert.equal(seedApiTokenFromEnv(pendingState(), env).reason, "no owner");
  const state = await withOwner();
  assert.equal(seedApiTokenFromEnv(state, env).seeded, true);
  assert.equal(seedApiTokenFromEnv(state, env).seeded, false);
  assert.deepEqual(state.apiTokens[0].scopes, ["read", "write", "admin"]);
  assert.ok(resolveApiToken(state, env.ROSTER_API_TOKEN));
});

test("headless CORE: setup-wiki-team runs with only a token; revoked token gets 401", async () => {
  const TOKEN = "rf_headless_bootstrap_0123456789abcdef";
  const core = await bootCore({
    ROSTER_OWNER_EMAIL: "ops@example.com",
    ROSTER_OWNER_PASSWORD: "password1",
    ROSTER_API_TOKEN: TOKEN,
  });
  const auth = (t) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
  try {
    const out = await setupWikiTeam({ env: { ROSTER_API: core.base, ROSTER_API_TOKEN: TOKEN }, log() {} });
    assert.equal(out.teamCreated, true);
    const teams = await (await fetch(`${core.base}/api/v1/teams`, { headers: auth(TOKEN) })).json();
    assert.ok(teams.some((t) => t.id === "wiki"));

    const created = await fetch(`${core.base}/api/v1/tokens`, {
      method: "POST",
      headers: auth(TOKEN),
      body: JSON.stringify({ name: "readonly", scopes: ["read"] }),
    });
    assert.equal(created.status, 201);
    const { token: ro, record } = await created.json();
    assert.equal((await fetch(`${core.base}/api/v1/seats`, { headers: auth(ro) })).status, 200);
    assert.equal((await fetch(`${core.base}/api/v1/teams`, { method: "POST", headers: auth(ro), body: "{}" })).status, 403);

    const list = await (await fetch(`${core.base}/api/v1/tokens`, { headers: auth(TOKEN) })).json();
    assert.ok(list.every((t) => !t.hash));
    const del = await fetch(`${core.base}/api/v1/tokens/${record.id}`, { method: "DELETE", headers: auth(TOKEN) });
    assert.equal(del.status, 200);
    assert.equal((await fetch(`${core.base}/api/v1/seats`, { headers: auth(ro) })).status, 401);
  } finally {
    await core.stop();
  }
});
