import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_TIMEOUT_MS,
  CATALOG_TTL_MS,
  featherlessOfferedModelIds,
  inUseModelAllowed,
  resetFeatherlessCatalogCache,
  ROSTER_USER_AGENT,
} from "./featherless-catalog.mjs";

test("inUseModelAllowed filters only featherless ids against a live catalog", () => {
  const offered = new Set(["deepseek-ai/DeepSeek-V4.1-Flash"]);
  assert.equal(inUseModelAllowed("featherless", "deepseek-ai/DeepSeek-V4.1-Flash", offered), true);
  assert.equal(inUseModelAllowed("featherless", "missing", offered), false);
  assert.equal(inUseModelAllowed("featherless", "missing", null), true);
  assert.equal(inUseModelAllowed("openai", "gpt-5", offered), true);
});

test("featherlessOfferedModelIds caches a successful catalog and warns when it cannot be read", async () => {
  const cache = {};
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "deepseek-ai/DeepSeek-V4.1-Flash" }, { id: "" }] }) };
  };
  const first = await featherlessOfferedModelIds({ fetchImpl, cacheStore: cache, now: 1_000 });
  const second = await featherlessOfferedModelIds({ fetchImpl, cacheStore: cache, now: 1_000 + 10_000 });
  assert.equal(calls, 1);
  assert.equal(first.has("deepseek-ai/DeepSeek-V4.1-Flash"), true);
  assert.equal(second, first);
  await featherlessOfferedModelIds({ fetchImpl, cacheStore: cache, now: 1_000 + 70_000 });
  assert.equal(calls, 1);
  await featherlessOfferedModelIds({ fetchImpl, cacheStore: cache, now: 1_000 + CATALOG_TTL_MS });
  assert.equal(calls, 2);

  const warnings = [];
  const down = await featherlessOfferedModelIds({
    fetchImpl: async () => {
      throw new Error("down");
    },
    cacheStore: {},
    log: (msg) => warnings.push(msg),
  });
  assert.equal(down, null);
  assert.match(warnings[0], /catalog unreachable/);

  const malformed = await featherlessOfferedModelIds({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    cacheStore: {},
    log: (msg) => warnings.push(msg),
  });
  assert.equal(malformed, null);
  assert.match(warnings.at(-1), /missing data/);
});

test("featherless catalog requests send roster-flow User-Agent and share a cache for at least an hour", async () => {
  assert.match(ROSTER_USER_AGENT, /^roster-flow\/\d+\.\d+\.\d+$/);
  assert.ok(CATALOG_TIMEOUT_MS >= 10_000);
  assert.ok(CATALOG_TTL_MS >= 60 * 60 * 1000);
  let headers;
  const fetchImpl = async (_url, init) => {
    headers = init.headers;
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "deepseek-ai/DeepSeek-V4.1-Flash" }] }) };
  };
  await featherlessOfferedModelIds({ fetchImpl, cacheStore: {}, now: 5_000 });
  assert.equal(headers["user-agent"], ROSTER_USER_AGENT);
  assert.equal(headers.accept, "application/json");

  resetFeatherlessCatalogCache();
  let calls = 0;
  const shared = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "shared" }] }) };
  };
  const first = await featherlessOfferedModelIds({ fetchImpl: shared, now: 0 });
  const second = await featherlessOfferedModelIds({ fetchImpl: shared, now: 30 * 60 * 1000 });
  assert.equal(calls, 1);
  assert.equal(second, first);
  await featherlessOfferedModelIds({ fetchImpl: shared, now: CATALOG_TTL_MS + 1 });
  assert.equal(calls, 2);
  resetFeatherlessCatalogCache();
});
