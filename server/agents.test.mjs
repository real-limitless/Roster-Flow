import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { agentMarkdown, modelForDisk, permissionFor, syncSeatAgent, teamAgentSeat } from "./agents.mjs";
import { firstLoadedModel, hireSeat } from "./seats.mjs";
import { emptyState } from "./seed.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("hiring with model '' does not store the built-in opencode provider", () => {
  const builtin = [{ providerID: "opencode", modelID: "longcat-2.5-preview-free", connected: true }];
  assert.equal(firstLoadedModel(builtin, builtin), undefined);
  const seat = hireSeat(emptyState(), { name: "Blank Model", model: "", job: "Unset." });
  assert.notEqual(seat.model, "opencode/longcat-2.5-preview-free");
  assert.notEqual(seat.model, "xai/grok-4");
  assert.notEqual(seat.model, "featherless/deepseek-ai/DeepSeek-V4.1-Flash");
  const connected = [
    { providerID: "opencode", modelID: "longcat-2.5-preview-free", connected: true },
    { providerID: "featherless", modelID: "stub-model", connected: true },
  ];
  assert.equal(
    firstLoadedModel(
      [
        { providerID: "opencode", modelID: "longcat-2.5-preview-free" },
        { providerID: "featherless", modelID: "stub-model" },
      ],
      connected,
    ),
    "featherless/stub-model",
  );
});

test("agentMarkdown does not invent xai/grok-4 when the seat has no model", () => {
  const md = agentMarkdown({
    id: "open",
    name: "Open",
    role: "Specialist",
    kind: "bot",
    seatType: "specialist",
    model: "",
    job: "Unset model.",
    tools: ["read"],
    deny: [],
  });
  assert.doesNotMatch(md, /grok-4/);
  assert.doesNotMatch(md, /^model:/m);
});

test("agentMarkdown uses provider/model and persona", () => {
  const md = agentMarkdown({
    id: "build",
    name: "Eng.Build",
    role: "Implement",
    kind: "bot",
    seatType: "specialist",
    model: "anthropic/claude-sonnet",
    persona: "Terse implementer.",
    instructions: "Implement only what Product accepted.",
    job: "Own a worktree.",
    tools: ["read", "edit"],
    deny: ["deploy"],
  });
  assert.match(md, /model: anthropic\/claude-sonnet/);
  assert.match(md, /mode: all/);
  assert.match(md, /Persona: Terse implementer/);
  assert.match(md, /Instructions: Implement only what Product accepted/);
  assert.match(md, /permission:\n  bash:\n    "\*": allow\n    "deploy \*": deny/);
});

test("deploy deny is the last bash rule so OpenCode does not allow deploy", () => {
  const bash = permissionFor({ seatType: "specialist", deny: ["deploy"] }).bash;
  assert.deepEqual(Object.entries(bash), [
    ["*", "allow"],
    ["deploy *", "deny"],
  ]);
  const wiki = permissionFor({ id: "wiki-scribe", seatType: "specialist", deny: ["deploy"] }).bash;
  assert.deepEqual(Object.keys(wiki), ["*", "deploy *"]);
  assert.equal(wiki["deploy *"], "deny");
});

test("supervisor markdown is primary and denies writes", () => {
  const md = agentMarkdown({
    id: "eng-supervisor",
    name: "Eng Supervisor",
    role: "Supervisor",
    kind: "bot",
    seatType: "supervisor",
    model: "xai/grok-4",
    persona: "Dispatcher.",
    instructions: "Route work.",
    job: "Route @eng.",
    tools: ["bus", "read"],
    deny: ["edit", "deploy", "bash"],
  });
  assert.match(md, /mode: primary/);
  assert.match(md, /^permission:\n  edit: deny\n  bash: deny$/m);
  assert.doesNotMatch(md, /permissions:/);
});

test("syncSeatAgent does not rewrite an explicit model when the catalog drops it", async () => {
  const { readFileSync, writeFileSync, unlinkSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { opencodeDir } = await import("./paths.mjs");
  const { writeOpenCodeConfig } = await import("./providers.mjs");
  const path = join(opencodeDir, "opencode.json");
  const raw = readFileSync(path, "utf8");
  const prev = process.env.FEATHERLESS_API_KEY;
  process.env.FEATHERLESS_API_KEY = "test-key";
  let file;
  const llama = "featherless/meta-llama/Llama-3.3-70B-Instruct";
  const seat = {
    id: "llama-hold",
    name: "Llama Hold",
    role: "Chat",
    kind: "bot",
    seatType: "specialist",
    model: llama,
    job: "Stay on Llama.",
    tools: ["read"],
    deny: [],
  };
  try {
    const before = JSON.parse(raw);
    writeOpenCodeConfig({
      ...before,
      provider: {
        ...(before.provider || {}),
        featherless: {
          npm: "@ai-sdk/openai-compatible",
          name: "Featherless",
          options: { apiKey: "{env:FEATHERLESS_API_KEY}" },
          models: { "Qwen/Qwen2.5-Coder-32B-Instruct": { name: "Qwen" } },
        },
      },
    });
    assert.equal(modelForDisk(seat), "");
    assert.equal(seat.model, llama);
    file = syncSeatAgent(seat);
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /Qwen/);
    assert.doesNotMatch(text, /^model:/m);
    assert.equal(seat.model, llama);
    const { readOpenCodeConfig } = await import("./providers.mjs");
    assert.equal(readOpenCodeConfig().agent["llama-hold"].model, undefined);
  } finally {
    writeFileSync(path, raw);
    if (prev === undefined) delete process.env.FEATHERLESS_API_KEY;
    else process.env.FEATHERLESS_API_KEY = prev;
    if (file && existsSync(file)) unlinkSync(file);
  }
});

test("syncSeatAgent writes .opencode/agents/<id>.md", () => {
  const file = syncSeatAgent({
    id: "agent-sync-test",
    name: "Sync Test",
    role: "Test",
    kind: "bot",
    seatType: "specialist",
    model: "xai/grok-4",
    persona: "A test seat.",
    instructions: "Do nothing harmful.",
    job: "Fixture.",
    tools: ["read"],
    deny: ["deploy"],
  });
  assert.ok(file && existsSync(file));
  const text = readFileSync(file, "utf8");
  assert.doesNotMatch(text, /grok-4/);
  assert.doesNotMatch(text, /^model:/m);
});

test("system seats write into the System workspace pack", () => {
  const file = syncSeatAgent({
    id: "architect",
    name: "Architect",
    role: "Org design",
    kind: "bot",
    seatType: "specialist",
    system: true,
    model: "xai/grok-4",
    persona: "Org architect.",
    instructions: "Propose an OrgPlan.",
    job: "Staff projects.",
    tools: ["bus", "read"],
    deny: ["edit", "deploy"],
  });
  assert.ok(file && existsSync(file));
  assert.ok(file.startsWith(join(root, ".roster-flow", "system")));
  const text = readFileSync(file, "utf8");
  assert.match(text, /Propose an OrgPlan/);
});

test("teamAgentSeat is a primary OpenCode alias", () => {
  const seat = teamAgentSeat({
    id: "eng",
    name: "@eng",
    role: "Engineering",
    job: "Ship PRs",
    rules: "Supervisor routes",
    staffed: true,
    supervisorSeatId: "eng-supervisor",
    defaultModel: "xai/grok-4",
  });
  assert.equal(seat.id, "eng");
  assert.equal(seat.seatType, "supervisor");
  assert.match(seat.instructions, /Supervisor/);
});

test("agent files cap tool steps: 4 for the conductor and supervisors, 8 for specialists", async () => {
  const { agentSteps } = await import("./agents.mjs");
  const base = { kind: "bot", role: "r", job: "j", tools: [], deny: [] };
  assert.match(agentMarkdown({ ...base, id: "build", name: "B", seatType: "specialist" }), /\nsteps: 8\n/);
  assert.match(agentMarkdown({ ...base, id: "eng-supervisor", name: "S", seatType: "supervisor" }), /\nsteps: 4\n/);
  assert.equal(agentSteps({ id: "channel" }), 4);
  assert.equal(agentSteps({ id: "x", steps: 12 }), 12);
  assert.equal(agentSteps({ id: "x", steps: 0 }), 8);
});

test("supervisors may task only their direct bot reports; specialists get no task rule", async () => {
  const { delegateReports } = await import("./agents.mjs");
  const state = {
    seats: [
      { id: "sup", kind: "bot", seatType: "supervisor" },
      { id: "a", kind: "bot", seatType: "specialist", reportsTo: "sup" },
      { id: "g", kind: "bot", seatType: "generic", reportsTo: "sup" },
      { id: "h", kind: "human", seatType: "human", reportsTo: "sup" },
      { id: "guest", kind: "bot", seatType: "harness", reportsTo: "sup", mcpGuest: true },
      { id: "sys", kind: "bot", seatType: "specialist", reportsTo: "sup", system: true },
      { id: "ext", kind: "bot", seatType: "specialist", reportsTo: "sup", adapter: "claude-code" },
      { id: "sub", kind: "bot", seatType: "supervisor", reportsTo: "sup" },
      { id: "other", kind: "bot", seatType: "specialist", reportsTo: "elsewhere" },
    ],
  };
  assert.deepEqual(delegateReports(state.seats[0], state), ["a", "g"]);
  assert.deepEqual(delegateReports(state.seats[1], state), []);

  const base = { kind: "bot", role: "r", job: "j", tools: [], deny: [] };
  const sup = { ...base, id: "sup", name: "Sup", seatType: "supervisor" };
  assert.deepEqual(permissionFor(sup, { reports: ["a", "g"] }).task, { "*": "deny", a: "allow", g: "allow" });
  const md = agentMarkdown(sup, { reports: ["a", "g"] });
  assert.match(md, /\n  task:\n    "\*": deny\n    "a": allow\n    "g": allow\n/);

  assert.deepEqual(permissionFor({ ...base, id: "nobody-reports-here", name: "@x", seatType: "supervisor" }).task, { "*": "deny" });
  assert.equal(permissionFor({ ...base, id: "build", name: "B", seatType: "specialist" }).task, undefined);
});

test("the seeded eng supervisor's agent config allows tasks to eng reports and the team alias denies all", async () => {
  const { delegateReports } = await import("./agents.mjs");
  const state = emptyState();
  const sup = state.seats.find((s) => s.id === "eng-supervisor");
  const perm = permissionFor(sup, { reports: delegateReports(sup, state) });
  assert.equal(perm.task["*"], "deny");
  for (const id of ["build", "review", "eng-generic"]) assert.equal(perm.task[id], "allow");
  assert.equal(perm.task.qa, undefined);
  const alias = teamAgentSeat(state.teams.find((t) => t.id === "eng"));
  assert.deepEqual(permissionFor(alias, { reports: delegateReports(alias, state) }).task, { "*": "deny" });
});
