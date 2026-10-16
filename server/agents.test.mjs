import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { agentMarkdown, permissionFor, syncSeatAgent, teamAgentSeat } from "./agents.mjs";
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
