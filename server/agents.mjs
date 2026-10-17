/** Write Roster-flow bot seats through to OpenCode agent files + opencode.json. */
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeModelId } from "./seed.mjs";
import { opencodeDir, systemWorkspace } from "./paths.mjs";
import { serveStartedAt } from "./harness.mjs";
import { firstConnectedModel, modelAllowedInConfig, normalizeOpenCodeConfig, readOpenCodeConfig, writeOpenCodeConfig } from "./providers.mjs";
import { getState } from "./store.mjs";

const agentsDir = join(opencodeDir, "agents");
const systemRoot = systemWorkspace;
const systemAgentsDir = join(systemRoot, ".opencode", "agents");
const systemOcPath = join(systemRoot, ".opencode", "opencode.json");

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function yamlEscape(value) {
  const s = String(value || "").replace(/\n/g, " ").trim();
  if (!s) return '""';
  if (/\s/.test(s) || /[:#{}[\],&*?|<>=!%@`]/.test(s) || s.includes('"')) return JSON.stringify(s);
  return s;
}

function opencodeSeat(seat) {
  const adapter = String(seat?.adapter || "opencode").toLowerCase();
  return seat?.kind === "bot" && !seat.mcpGuest && (!adapter || adapter === "opencode");
}

/**
 * Seats a supervisor may call through OpenCode's `task` tool: its direct bot
 * reports on the company serve. Supervisors are `mode: primary`, so they cannot
 * be subagents, and System seats live on the other serve.
 */
export function delegateReports(seat, state = getState()) {
  if (!seat || seat.seatType !== "supervisor" || seat.system || !opencodeSeat(seat)) return [];
  return (state?.seats || [])
    .filter((s) => s.reportsTo === seat.id && opencodeSeat(s) && !s.system && s.seatType !== "supervisor")
    .map((s) => s.id);
}

/** OpenCode `permission` object (https://opencode.ai/docs/permissions). */
export function permissionFor(seat, { reports = null } = {}) {
  const deny = new Set(seat.deny || []);
  const permission = {};
  if (deny.has("edit") || seat.seatType === "supervisor") permission.edit = "deny";
  if (deny.has("bash") || seat.seatType === "supervisor") permission.bash = "deny";
  else if (deny.has("deploy") || deny.has("skip-confirm")) {
    // OpenCode uses the last matching bash rule. The catch-all allow must come
    // before the deploy deny, or `deploy *` is allowed.
    permission.bash = { "*": "allow", "deploy *": "deny" };
  }
  if (seat.seatType === "supervisor") {
    const allowed = reports ?? delegateReports(seat);
    permission.task = { "*": "deny", ...Object.fromEntries(allowed.map((id) => [id, "allow"])) };
  }
  return permission;
}

function permissionYaml(permission) {
  const lines = [];
  for (const [k, v] of Object.entries(permission)) {
    if (typeof v === "string") lines.push(`  ${k}: ${v}`);
    else {
      lines.push(`  ${k}:`);
      for (const [pat, act] of Object.entries(v)) lines.push(`    ${JSON.stringify(pat)}: ${act}`);
    }
  }
  return lines;
}

function agentBody(seat) {
  const persona = seat.persona || `${seat.name} (${seat.role})`;
  const instructions = seat.instructions || seat.job || "";
  const knowledge = seat.knowledge ? `\nKnowledge:\n${seat.knowledge}` : "";
  const skills = seat.skills?.length ? `\nSkills: ${seat.skills.join(", ")}` : "";
  const project = seat.projectId ? `\nProject: ${seat.projectId}` : "";
  return `Persona: ${persona}\nInstructions: ${instructions}${project}${knowledge}${skills}\n`;
}

/** Tool steps one wake may take: 4 for the conductor and supervisors, 8 for specialists, or the seat's own `steps`. */
export function agentSteps(seat = {}) {
  const own = Number(seat.steps);
  if (Number.isInteger(own) && own > 0) return own;
  return seat.id === "channel" || seat.seatType === "supervisor" ? 4 : 8;
}

function agentModel(seat) {
  return normalizeModelId(seat?.model) || "";
}

/**
 * Model string safe to persist. An explicit seat model is kept or dropped.
 * It is never replaced with another model because the catalog changed.
 * A seat with no model may still use the first connected model. Never the
 * built-in `opencode` provider.
 */
export function modelForDisk(seat) {
  const requested = agentModel(seat);
  if (requested) return modelAllowedInConfig(requested) ? requested : "";
  const fallback = firstConnectedModel();
  const ref = fallback?.providerID && fallback?.modelID ? `${fallback.providerID}/${fallback.modelID}` : "";
  if (ref && modelAllowedInConfig(ref)) return ref;
  return "";
}

function seatForDisk(seat) {
  return { ...seat, model: modelForDisk(seat) };
}

export function agentMarkdown(seat, ctx = {}) {
  const mode = seat.seatType === "supervisor" ? "primary" : "all";
  const model = agentModel(seat);
  const perm = permissionFor(seat, ctx);
  return [
    "---",
    `description: ${yamlEscape(seat.job || seat.name)}`,
    `mode: ${mode}`,
    ...(model ? [`model: ${yamlEscape(model)}`] : []),
    `steps: ${agentSteps(seat)}`,
    ...(Object.keys(perm).length ? ["permission:", ...permissionYaml(perm)] : []),
    "---",
    agentBody(seat).trim(),
    "",
  ].join("\n");
}

function agentConfigEntry(seat, ctx = {}) {
  const model = agentModel(seat);
  const permission = permissionFor(seat, ctx);
  return {
    description: seat.job || seat.name,
    mode: seat.seatType === "supervisor" ? "primary" : "all",
    ...(model ? { model } : {}),
    steps: agentSteps(seat),
    prompt: agentBody(seat).trim(),
    ...(Object.keys(permission).length ? { permission } : {}),
  };
}

function writeSystemOpenCodeConfig(seat) {
  mkdirSync(dirname(systemOcPath), { recursive: true });
  const company = readOpenCodeConfig();
  const cfg = readJson(systemOcPath, {
    $schema: "https://opencode.ai/config.json",
    plugin: ["roster-flow-opencode"],
    provider: {},
    agent: {},
  });
  cfg.plugin = ["roster-flow-opencode"];
  cfg.provider = company.provider || cfg.provider || {};
  const clean = normalizeOpenCodeConfig(cfg);
  clean.agent = clean.agent || {};
  if (seat) clean.agent[seat.id] = agentConfigEntry(seat);
  writeFileSync(systemOcPath, JSON.stringify(clean, null, 2));
  return clean;
}

function agentFile(seat) {
  return seat?.system ? join(systemAgentsDir, `${seat.id}.md`) : join(agentsDir, `${seat.id}.md`);
}

/** True when the running serve started before this seat's agent file, so it has not loaded it. */
export function agentNeedsServeRestart(seat, kind = "company") {
  const started = serveStartedAt(kind);
  if (!started) return false;
  const file = agentFile(seat);
  if (!existsSync(file)) return true;
  const disk = seatForDisk(seat);
  if (readFileSync(file, "utf8") !== agentMarkdown(disk)) return true;
  return statSync(file).mtimeMs > started;
}

export function syncSeatAgent(seat) {
  if (!seat || seat.kind !== "bot" || seat.mcpGuest) return null;
  const adapter = String(seat.adapter || "opencode").toLowerCase();
  if (adapter && adapter !== "opencode") return null;
  const disk = seatForDisk(seat);
  if (seat.system) {
    mkdirSync(systemAgentsDir, { recursive: true });
    const file = join(systemAgentsDir, `${seat.id}.md`);
    writeFileSync(file, agentMarkdown(disk));
    writeSystemOpenCodeConfig(disk);
    return file;
  }
  mkdirSync(agentsDir, { recursive: true });
  const file = join(agentsDir, `${seat.id}.md`);
  writeFileSync(file, agentMarkdown(disk));
  const cfg = readOpenCodeConfig();
  cfg.agent = { ...(cfg.agents || {}), ...(cfg.agent || {}) };
  delete cfg.agents;
  cfg.agent[seat.id] = agentConfigEntry(disk);
  // A hire, fire, or reportsTo change alters some supervisor's task allowlist, so rewrite every supervisor.
  for (const sup of (getState()?.seats || []).filter((s) => s.seatType === "supervisor" && s.id !== seat.id && opencodeSeat(s) && !s.system)) {
    const supDisk = seatForDisk(sup);
    writeFileSync(join(agentsDir, `${sup.id}.md`), agentMarkdown(supDisk));
    cfg.agent[sup.id] = agentConfigEntry(supDisk);
  }
  writeOpenCodeConfig(cfg);
  return file;
}

export function removeSeatAgent(id) {
  for (const file of [join(agentsDir, `${id}.md`), join(systemAgentsDir, `${id}.md`)]) {
    if (existsSync(file)) unlinkSync(file);
  }
  const cfg = readOpenCodeConfig();
  if (cfg.agents) delete cfg.agents[id];
  if (cfg.agent) delete cfg.agent[id];
  const state = getState();
  for (const sup of (state?.seats || []).filter((s) => s.seatType === "supervisor" && s.id !== id && opencodeSeat(s) && !s.system)) {
    const reports = delegateReports(sup, state).filter((r) => r !== id);
    if (!existsSync(join(agentsDir, `${sup.id}.md`))) continue;
    const supDisk = seatForDisk(sup);
    writeFileSync(join(agentsDir, `${sup.id}.md`), agentMarkdown(supDisk, { reports }));
    if (cfg.agent) cfg.agent[sup.id] = agentConfigEntry(supDisk, { reports });
  }
  writeOpenCodeConfig(cfg);
  if (existsSync(systemOcPath)) {
    const sys = normalizeOpenCodeConfig(readJson(systemOcPath, { agent: {} }));
    if (sys.agent) delete sys.agent[id];
    writeFileSync(systemOcPath, JSON.stringify(sys, null, 2));
  }
}

export function teamAgentSeat(team) {
  if (!team || team.staffed === false) return null;
  const brief = [
    team.role ? `Team role: ${team.role}` : "",
    team.description ? `Description: ${team.description}` : "",
    team.job ? `Job: ${team.job}` : "",
    team.rules ? `Special rules:\n${team.rules}` : "",
    `You are ${team.name}. Mail to you reaches the Supervisor (${team.supervisorSeatId}).`,
    "Route via roster_handoff. Do not impersonate members.",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    id: team.id,
    name: team.name,
    role: team.role || "Team",
    kind: "bot",
    seatType: "supervisor",
    model: team.defaultModel,
    fallbackModel: team.fallbackModel,
    job: team.job || `You are ${team.name}. Route via Supervisor.`,
    persona: `You are the ${team.name} team alias in OpenCode.`,
    instructions: brief,
    tools: ["bus", "read"],
    deny: ["edit", "deploy", "bash"],
  };
}

export function syncTeamAgent(team) {
  const seat = teamAgentSeat(team);
  if (!seat) return null;
  return syncSeatAgent(seat);
}

export function syncBotAgents(seats = [], teams = []) {
  const written = [];
  for (const seat of seats) {
    if (seat.kind !== "bot") continue;
    written.push(syncSeatAgent(seat));
    if (seat.system) {
      const leftover = join(agentsDir, `${seat.id}.md`);
      if (existsSync(leftover)) unlinkSync(leftover);
      const cfg = readOpenCodeConfig();
      if (cfg.agents?.[seat.id] || cfg.agent?.[seat.id]) {
        if (cfg.agents) delete cfg.agents[seat.id];
        if (cfg.agent) delete cfg.agent[seat.id];
        writeOpenCodeConfig(cfg);
      }
    }
  }
  for (const team of teams) {
    const file = syncTeamAgent(team);
    if (file) written.push(file);
  }
  try {
    removeSeatAgent("floor");
  } catch {
    /* leftover Floor agent */
  }
  return written;
}
