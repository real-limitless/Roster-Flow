import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { agentMarkdown, syncSeatAgent, teamAgentSeat } from "./agents.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  assert.match(md, /effect: "deny"/);
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
  assert.match(text, /model: xai\/grok-4/);
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
