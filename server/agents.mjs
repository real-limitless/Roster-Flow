/** Write Roster-flow bot seats through to OpenCode agent files + opencode.json. */
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeModelId } from "./seed.mjs";
import { readOpenCodeConfig, writeOpenCodeConfig } from "./providers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentsDir = join(root, ".opencode", "agents");

function yamlEscape(value) {
  const s = String(value || "").replace(/\n/g, " ").trim();
  if (!s) return '""';
  if (/[:#{}[\],&*?|<>=!%@`]/.test(s) || s.includes('"')) return JSON.stringify(s);
  return s;
}

function permissionsFor(seat) {
  const deny = new Set(seat.deny || []);
  const rules = [];
  if (deny.has("edit")) rules.push({ action: "edit", resource: "*", effect: "deny" });
  if (deny.has("bash")) rules.push({ action: "shell", resource: "*", effect: "deny" });
  if (deny.has("deploy") || deny.has("skip-confirm")) {
    rules.push({ action: "shell", resource: "deploy *", effect: "deny" });
  }
  if (seat.seatType === "supervisor") {
    rules.push({ action: "edit", resource: "*", effect: "deny" });
    rules.push({ action: "shell", resource: "*", effect: "deny" });
  }
  return rules;
}

function agentBody(seat) {
  const persona = seat.persona || `${seat.name} (${seat.role})`;
  const instructions = seat.instructions || seat.job || "";
  return `Persona: ${persona}\nInstructions: ${instructions}\n`;
}

export function agentMarkdown(seat) {
  const mode = seat.seatType === "supervisor" ? "primary" : "all";
  const model = normalizeModelId(seat.model) || "xai/grok-4";
  const perms = permissionsFor(seat)
    .map((p) => `  - { action: "${p.action}", resource: "${p.resource}", effect: "${p.effect}" }`)
    .join("\n");
  return [
    "---",
    `description: ${yamlEscape(seat.job || seat.name)}`,
    `mode: ${mode}`,
    `model: ${model}`,
    "permissions:",
    perms || '  - { action: "read", resource: "*", effect: "allow" }',
    "---",
    agentBody(seat).trim(),
    "",
  ].join("\n");
}

export function syncSeatAgent(seat) {
  if (!seat || seat.kind !== "bot") return null;
  mkdirSync(agentsDir, { recursive: true });
  const file = join(agentsDir, `${seat.id}.md`);
  writeFileSync(file, agentMarkdown(seat));
  const cfg = readOpenCodeConfig();
  cfg.agents = cfg.agents || {};
  cfg.agents[seat.id] = {
    description: seat.job || seat.name,
    mode: seat.seatType === "supervisor" ? "primary" : "all",
    model: normalizeModelId(seat.model) || "xai/grok-4",
    system: agentBody(seat).trim(),
  };
  writeOpenCodeConfig(cfg);
  return file;
}

export function removeSeatAgent(id) {
  const file = join(agentsDir, `${id}.md`);
  if (existsSync(file)) unlinkSync(file);
  const cfg = readOpenCodeConfig();
  if (cfg.agents) delete cfg.agents[id];
  writeOpenCodeConfig(cfg);
}

export function syncBotAgents(seats = []) {
  const written = [];
  for (const seat of seats) {
    if (seat.kind === "bot") written.push(syncSeatAgent(seat));
  }
  return written;
}
