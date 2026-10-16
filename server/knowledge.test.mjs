import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "./seed.mjs";
import { goalPackLines } from "./goals.mjs";
import {
  attachConnector,
  deps,
  knowledgePointerLines,
  removeConnector,
  searchKnowledge,
  seatCanSearchProject,
} from "./knowledge.mjs";

test("project connector search is scoped and disconnect drops it from prompts", async () => {
  const state = emptyState();
  state.connectors = [];
  const conn = attachConnector(state, "billing", { kind: "docs", root: "docs" });
  assert.equal(conn.projectId, "billing");
  assert.equal(seatCanSearchProject(state, "build", "billing"), true);
  assert.equal(seatCanSearchProject(state, "scout", "billing"), false);

  const found = await searchKnowledge(state, "billing", "constitution", { seatId: "build" });
  assert.equal(found.source, "core");
  assert.ok(found.hits.some((h) => /constitution/i.test(h.path) || /constitution/i.test(h.snippet)));

  await assert.rejects(() => searchKnowledge(state, "billing", "constitution", { seatId: "scout" }), (err) => err.status === 403);

  const build = state.seats.find((s) => s.id === "build");
  const withConn = knowledgePointerLines(state, build).join("\n");
  assert.match(withConn, /not used for training/i);
  assert.match(withConn, /docs:docs/);
  assert.match(goalPackLines(state, { seat: build }).join("\n"), /Attached sources:/);

  assert.ok(removeConnector(state, "billing", conn.id));
  const after = knowledgePointerLines(state, build).join("\n");
  assert.doesNotMatch(after, /docs:docs/);
  assert.doesNotMatch(goalPackLines(state, { seat: build }).join("\n"), /Attached sources:/);
});

test("mcp-flow hits are preferred when the sibling answers", async () => {
  const state = emptyState();
  state.connectors = [];
  attachConnector(state, "billing", { kind: "git", path: "." });
  const prevPing = deps.ping;
  const prevFetch = deps.fetchFn;
  deps.ping = async () => ({ ok: true, status: 200 });
  deps.fetchFn = async () => ({
    ok: true,
    json: async () => ({ hits: [{ path: "from-mcp.md", snippet: "via mcp-flow" }] }),
  });
  try {
    const out = await searchKnowledge(state, "billing", "anything", { seatId: "product" });
    assert.equal(out.source, "mcp-flow");
    assert.equal(out.hits[0].path, "from-mcp.md");
  } finally {
    deps.ping = prevPing;
    deps.fetchFn = prevFetch;
  }
});

test("path traversal is rejected", () => {
  const state = emptyState();
  state.connectors = [];
  assert.throws(
    () => attachConnector(state, "billing", { kind: "git", path: "../.." }),
    (err) => err.status === 400,
  );
});
