import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "./seed.mjs";
import { applyPlan, chatArchitect, planFromTemplates, replaceOrg } from "./architect.mjs";
import { harnessKindForSeat, sessionKeyForKind } from "./harness.mjs";

test("harness kinds split system seats from company bots", () => {
  assert.equal(harnessKindForSeat({ system: true }), "system");
  assert.equal(harnessKindForSeat({ id: "build" }), "company");
  assert.equal(sessionKeyForKind("system"), "systemSessions");
  assert.equal(sessionKeyForKind("company"), "sessions");
});

test("replace_org keeps You, Channel, Architect, and the MCP guest", () => {
  const state = emptyState();
  const { fired } = replaceOrg(state);
  assert.ok(fired.length > 0);
  const ids = state.seats.map((s) => s.id).sort();
  assert.deepEqual(ids, ["architect", "channel", "mcp-guest", "you"]);
  assert.equal(state.projects.length, 0);
  assert.equal(state.teams.length, 0);
  for (const ch of state.channels) {
    assert.ok(ch.seatIds.includes("you"));
    assert.ok(ch.seatIds.includes("channel"));
    assert.ok(ch.seatIds.includes("architect"));
    assert.ok(ch.seatIds.includes("mcp-guest"));
    assert.equal(ch.teamIds.length, 0);
  }
});

test("org chip text drafts a replace_org template", () => {
  const plan = planFromTemplates("Create a full startup org for a billing SaaS.", emptyState());
  assert.equal(plan.ops[0].op, "replace_org");
});

test("full-org template starts with replace_org and staffs billing", () => {
  const state = emptyState();
  const plan = planFromTemplates("Create a full startup org for a billing SaaS.", state);
  assert.equal(plan.ops[0].op, "replace_org");
  assert.ok(plan.ops.some((o) => o.op === "create_project" && (o.name === "billing" || o.id === "billing")));
  assert.ok(plan.ops.some((o) => o.op === "create_team"));
  assert.ok(plan.ops.some((o) => o.op === "hire" && o.asPm));
  applyPlan(state, plan);
  assert.ok(state.seats.some((s) => s.id === "you"));
  assert.ok(state.seats.some((s) => s.id === "architect" && s.system));
  assert.ok(state.seats.some((s) => s.id === "channel" && s.system));
  assert.ok(state.projects.some((p) => p.id === "billing"));
  assert.ok(state.teams.some((t) => t.id === "eng"));
  assert.ok(state.teams.some((t) => t.id === "services"));
});

test("chatArchitect template mode skips live wake", async () => {
  const prev = process.env.ROSTER_ARCHITECT_MODE;
  process.env.ROSTER_ARCHITECT_MODE = "template";
  try {
    const state = emptyState();
    let called = false;
    const out = await chatArchitect(state, { message: "We’re starting a mobile app. Create a project and staff a team around it." }, {
      ensureSystem: async () => {
        called = true;
      },
      wakeSeat: async () => {
        called = true;
        return { sessionId: "x" };
      },
      pullAssistant: async () => [{ text: "not json" }],
    });
    assert.equal(called, false);
    assert.equal(out.source, "template");
    assert.ok(out.plan.ops.some((o) => o.op === "create_project"));
  } finally {
    if (prev === undefined) delete process.env.ROSTER_ARCHITECT_MODE;
    else process.env.ROSTER_ARCHITECT_MODE = prev;
  }
});

test("chatArchitect live path polls System harness JSON", async () => {
  const prev = process.env.ROSTER_ARCHITECT_MODE;
  const prevTimeout = process.env.ROSTER_ARCHITECT_TIMEOUT_MS;
  const prevPoll = process.env.ROSTER_ARCHITECT_POLL_MS;
  delete process.env.ROSTER_ARCHITECT_MODE;
  process.env.ROSTER_ARCHITECT_TIMEOUT_MS = "2000";
  process.env.ROSTER_ARCHITECT_POLL_MS = "10";
  try {
    const state = emptyState();
    let ensured = false;
    const out = await chatArchitect(state, { message: "Build a full org" }, {
      ensureSystem: async () => {
        ensured = true;
        return { harness: "up" };
      },
      wakeSeat: async () => ({ sessionId: "sys_arch" }),
      pullAssistant: async () => [
        {
          text: JSON.stringify({
            summary: "Replace with a lean org",
            rationale: ["Fresh chart"],
            reply: "Ready to apply.",
            ops: [{ op: "replace_org" }, { op: "create_project", name: "atlas", brief: "New product" }],
          }),
        },
      ],
    });
    assert.equal(ensured, true);
    assert.equal(out.source, "live");
    assert.equal(out.plan.ops[0].op, "replace_org");
    assert.equal(out.plan.source, "live");
  } finally {
    if (prev === undefined) delete process.env.ROSTER_ARCHITECT_MODE;
    else process.env.ROSTER_ARCHITECT_MODE = prev;
    if (prevTimeout === undefined) delete process.env.ROSTER_ARCHITECT_TIMEOUT_MS;
    else process.env.ROSTER_ARCHITECT_TIMEOUT_MS = prevTimeout;
    if (prevPoll === undefined) delete process.env.ROSTER_ARCHITECT_POLL_MS;
    else process.env.ROSTER_ARCHITECT_POLL_MS = prevPoll;
  }
});

test("chatArchitect live path returns model prose when JSON is missing", async () => {
  const prev = process.env.ROSTER_ARCHITECT_MODE;
  const prevTimeout = process.env.ROSTER_ARCHITECT_TIMEOUT_MS;
  const prevPoll = process.env.ROSTER_ARCHITECT_POLL_MS;
  delete process.env.ROSTER_ARCHITECT_MODE;
  process.env.ROSTER_ARCHITECT_TIMEOUT_MS = "200";
  process.env.ROSTER_ARCHITECT_POLL_MS = "10";
  try {
    const out = await chatArchitect(emptyState(), { message: "hi" }, {
      ensureSystem: async () => ({ harness: "up" }),
      wakeSeat: async () => ({ sessionId: "sys_arch" }),
      pullAssistant: async () => [{ text: "I would staff a smaller team first." }],
    });
    assert.equal(out.source, "live");
    assert.equal(out.plan, null);
    assert.match(out.reply, /smaller team/);
  } finally {
    if (prev === undefined) delete process.env.ROSTER_ARCHITECT_MODE;
    else process.env.ROSTER_ARCHITECT_MODE = prev;
    if (prevTimeout === undefined) delete process.env.ROSTER_ARCHITECT_TIMEOUT_MS;
    else process.env.ROSTER_ARCHITECT_TIMEOUT_MS = prevTimeout;
    if (prevPoll === undefined) delete process.env.ROSTER_ARCHITECT_POLL_MS;
    else process.env.ROSTER_ARCHITECT_POLL_MS = prevPoll;
  }
});

test("chatArchitect fails clearly when System harness cannot start", async () => {
  const prev = process.env.ROSTER_ARCHITECT_MODE;
  delete process.env.ROSTER_ARCHITECT_MODE;
  try {
    const state = emptyState();
    await assert.rejects(
      () =>
        chatArchitect(state, { message: "Build a full org" }, {
          ensureSystem: async () => {
            const err = new Error("OpenCode CLI is not installed. Architect needs the System harness.");
            err.status = 409;
            err.code = "OPENCODE_MISSING";
            throw err;
          },
          wakeSeat: async () => ({ sessionId: "x" }),
          pullAssistant: async () => [],
        }),
      (err) => err.status === 409 && /System harness|OpenCode CLI/.test(err.message),
    );
  } finally {
    if (prev === undefined) delete process.env.ROSTER_ARCHITECT_MODE;
    else process.env.ROSTER_ARCHITECT_MODE = prev;
  }
});
