import { slugify } from "./seed.mjs";
import { createProject, patchProject } from "./projects.mjs";
import { fireSeat, hireSeat } from "./seats.mjs";
import { createStaffedTeam } from "./teams.mjs";
import { wakeSeat, pullAssistant } from "./bus.mjs";
import { ensure } from "./harness.mjs";
import { emit } from "./trace.mjs";

export const MAX_OPS = 48;
const OPS = new Set(["replace_org", "create_project", "create_team", "hire", "reparent", "fire", "patch_project"]);

function liveTimeoutMs() {
  return Number(process.env.ROSTER_ARCHITECT_TIMEOUT_MS) || 60_000;
}

function pollMs() {
  return Number(process.env.ROSTER_ARCHITECT_POLL_MS) || 800;
}

export function planId() {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function parsePlanJson(text) {
  if (!text) return null;
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : String(text);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function normalizePlan(raw, extras = {}) {
  if (!raw || typeof raw !== "object") return null;
  const ops = (Array.isArray(raw.ops) ? raw.ops : [])
    .filter((op) => op && OPS.has(op.op))
    .slice(0, MAX_OPS)
    .map((op) => ({ ...op }));
  if (!ops.length) return null;
  return {
    id: raw.id || extras.id || planId(),
    summary: String(raw.summary || extras.summary || "Org plan"),
    rationale: Array.isArray(raw.rationale) ? raw.rationale.map(String) : extras.rationale || [],
    reply: String(raw.reply || extras.reply || raw.summary || "Here is a plan. Apply when you are ready."),
    status: extras.status || "proposed",
    ops,
  };
}

function storePlan(state, plan) {
  state.architectPlans = [plan, ...(state.architectPlans || []).filter((p) => p.id !== plan.id)].slice(0, 20);
  return plan;
}

function keepSeat(seat) {
  return seat.id === "you" || Boolean(seat.system);
}

export function replaceOrg(state) {
  const fired = [];
  for (const seat of [...(state.seats || [])]) {
    if (keepSeat(seat)) continue;
    try {
      fired.push(fireSeat(state, seat.id));
    } catch {
      /* skip protected leftovers */
    }
  }
  state.teams = [];
  state.projects = [];
  const keepIds = new Set((state.seats || []).filter(keepSeat).map((s) => s.id));
  for (const ch of state.channels || []) {
    ch.teamIds = [];
    ch.seatIds = [...keepIds];
  }
  if (state.sessions) {
    for (const id of Object.keys(state.sessions)) {
      if (!keepIds.has(id)) delete state.sessions[id];
    }
  }
  return { fired };
}

export function applyPlan(state, plan) {
  if (!plan?.ops?.length) {
    const err = new Error("plan has no ops");
    err.status = 400;
    throw err;
  }
  const created = { projects: [], teams: [], seats: [], fired: [], replaced: false };
  for (const op of plan.ops.slice(0, MAX_OPS)) {
    if (op.op === "replace_org") {
      const cleared = replaceOrg(state);
      created.fired.push(...cleared.fired);
      created.replaced = true;
    } else if (op.op === "create_project") {
      const project = createProject(state, op);
      created.projects.push(project);
    } else if (op.op === "patch_project") {
      patchProject(state, op.id || op.projectId, op);
    } else if (op.op === "create_team") {
      const { team, seats } = createStaffedTeam(state, op);
      created.teams.push(team);
      created.seats.push(...seats);
    } else if (op.op === "hire") {
      const seat = hireSeat(state, op);
      created.seats.push(seat);
    } else if (op.op === "reparent") {
      const seat = (state.seats || []).find((s) => s.id === op.seatId);
      if (seat) seat.reportsTo = op.reportsTo || undefined;
    } else if (op.op === "fire") {
      created.fired.push(fireSeat(state, op.seatId));
    }
  }
  plan.status = "applied";
  storePlan(state, plan);
  return { plan, created };
}

function projectSlugFromMessage(text) {
  const named = text.match(/project\s+(?:called|named)\s+["']?([a-z0-9][\w-]{1,24})/i);
  if (named) return slugify(named[1]);
  if (/\bmobile\b|ios|android/i.test(text)) return "mobile";
  if (/\bplatform\b/i.test(text)) return "platform";
  if (/\bdocs\b/i.test(text)) return "docs";
  if (/\bbilling\b/i.test(text)) return "billing";
  return "venture";
}

export function planFromTemplates(message, state) {
  const text = String(message || "");
  const layoff = /\blayoff|lay off|fire|pause|cut\b/i.test(text);
  const staffProject = /\bproject\b|\bmobile\b|\bplatform\b|\bstaff\b|\bteam around\b/i.test(text);
  const fullOrg = /\bfull org\b|\bstartup\b|\bcompany\b|\bwhole org\b/i.test(text);

  if (layoff && !fullOrg) return layoffPlan(text, state);
  if (fullOrg) return fullOrgPlan(text, state);
  if (staffProject) return newProjectPlan(text, state);
  return newProjectPlan(text, state);
}

function layoffPlan(text, state) {
  const seats = state.seats || [];
  const named = [];
  for (const seat of seats) {
    if (seat.system || seat.id === "you") continue;
    const hit = text.toLowerCase().includes(seat.name.toLowerCase()) || text.toLowerCase().includes(seat.id);
    if (hit) named.push(seat);
  }
  const services = seats.filter((s) => s.team === "services" && s.seatType === "specialist" && !s.system);
  const paused = [];
  const pauseMatch = text.match(/pause(?:\s+the)?\s+([a-z0-9-]+)/i);
  if (pauseMatch) {
    const pid = slugify(pauseMatch[1]);
    const project = (state.projects || []).find((p) => p.id === pid || slugify(p.name) === pid);
    if (project) {
      paused.push(
        ...seats.filter((s) => s.projectId === project.id && s.kind === "bot" && !s.system && s.seatType !== "supervisor"),
      );
    }
  }
  const targets = [...new Map([...named, ...paused, ...(named.length || paused.length ? [] : services.slice(0, 2))].map((s) => [s.id, s])).values()];
  const ops = targets.slice(0, MAX_OPS).map((s) => ({
    op: "fire",
    seatId: s.id,
    reason: s.team === "services" ? "Shared-services overlap; Generic can cover" : `Pause ${s.projectId || "scope"}`,
  }));
  if (!ops.length) {
    const scout = seats.find((s) => s.id === "scout");
    if (scout) ops.push({ op: "fire", seatId: "scout", reason: "Explore overlap with Eng.Generic" });
  }
  return normalizePlan({
    summary: ops.length ? `Suggest firing ${ops.map((o) => o.seatId).join(", ")}.` : "No obvious layoffs.",
    rationale: ops.map((o) => o.reason || o.seatId),
    reply: ops.length
      ? `I would cut ${ops.map((o) => o.seatId).join(", ")}. Review the plan, then Apply.`
      : "Nothing obvious to cut without thinning the ship train.",
    ops,
  });
}

function newProjectPlan(text, state) {
  const id = projectSlugFromMessage(text);
  const existing = (state.projects || []).find((p) => p.id === id);
  if (existing) {
    const teamId = `${id}-core`;
    if ((state.teams || []).some((t) => t.id === teamId || t.id === id)) {
      return normalizePlan({
        summary: `Project ${existing.name} already exists. Hire a specialist under it.`,
        rationale: ["Do not duplicate the project", "Add one implementer"],
        reply: `${existing.name} is already on the chart. I would add one specialist.`,
        ops: [
          {
            op: "hire",
            name: `${existing.name} Build`,
            kind: "bot",
            projectId: existing.id,
            team: existing.teamIds.find((tid) => (state.teams || []).some((t) => t.id === tid && t.staffed !== false)),
            role: "Implement",
            job: `Own the ${existing.name} worktree.`,
            persona: "Terse implementer.",
            instructions: `Implement only what the ${existing.name} PM accepted. Do not deploy.`,
            asPm: false,
          },
        ],
      });
    }
  }
  const teamName = id === "mobile" ? "mobile" : id;
  const pmName = id === "mobile" ? "Mobile PM" : `${id} PM`;
  return normalizePlan({
    summary: `Create project ${id} with a tailored PM and @${teamName}.`,
    rationale: ["Project is a workstream under the org", "PM gets its own brief and skills", "Supervisor + Generic on the team"],
    reply: `I would add project ${id}, hire ${pmName}, and staff @${teamName}. Apply when that matches what you want.`,
    ops: [
      {
        op: "create_project",
        name: id,
        brief: text.slice(0, 240) || `New ${id} project.`,
        constitution: `Stay on ${id}. Do not leak memory from other projects.`,
      },
      {
        op: "hire",
        name: pmName,
        kind: "bot",
        role: "Brief",
        projectId: id,
        reportsTo: "you",
        asPm: true,
        persona: `${id} product manager. Acceptance over opinions.`,
        instructions: `Own the ${id} brief. No edits, no bash write.`,
        knowledge: `Project ${id}. ${text.slice(0, 180)}`,
        skills: ["brief"],
        job: `Write acceptance for ${id}.`,
        tools: ["read", "grep", "webfetch"],
        deny: ["edit", "bash"],
      },
      {
        op: "create_team",
        name: teamName,
        projectId: id,
        reportsTo: "you",
        role: `${id} engineering`,
        job: `Ship ${id} work as a PR.`,
        specialists: [
          {
            name: `${id === "mobile" ? "Eng.Mobile" : `${id} Build`}`,
            role: "Implement",
            job: `Own the ${id} worktree.`,
            persona: "Terse implementer.",
            instructions: `Implement only what the ${id} PM accepted. Do not deploy.`,
          },
        ],
      },
    ],
  });
}

function fullOrgPlan(text) {
  const brief = text.slice(0, 240) || "Billing SaaS ship train.";
  return normalizePlan({
    summary: "Replace the company with a full billing SaaS org.",
    rationale: [
      "Keep You, Channel, and Architect",
      "Billing is the first project with its own PM",
      "Staffed @eng and shared @services",
    ],
    reply: "I would clear the current company and staff a billing SaaS: PM, @eng, DevOps, QA, and @services. Apply when that matches.",
    ops: [
      { op: "replace_org" },
      {
        op: "create_project",
        name: "billing",
        brief,
        constitution: "Acceptance over opinions. Confirm on deploy. Do not skip the QA gate.",
      },
      {
        op: "hire",
        name: "Maya",
        kind: "human",
        role: "VP Eng",
        reportsTo: "you",
        job: "Owns product and engineering seats.",
      },
      {
        op: "hire",
        name: "Jules",
        kind: "human",
        role: "Eng lead",
        reportsTo: "maya",
        projectId: "billing",
        job: "Runs @eng. Attaches harness when a bot stalls.",
      },
      {
        op: "hire",
        name: "Priya",
        kind: "human",
        role: "QA lead",
        reportsTo: "you",
        job: "Owns the QA gate. Signs staging.",
      },
      {
        op: "hire",
        name: "Product",
        kind: "bot",
        role: "Brief",
        projectId: "billing",
        reportsTo: "maya",
        asPm: true,
        persona: "Product brief writer. Acceptance over opinions.",
        instructions: "Turn channel talk into a brief and acceptance list. No edits, no bash write.",
        knowledge: `Project billing. ${brief}`,
        skills: ["brief"],
        job: "Write acceptance. No edits.",
        tools: ["read", "grep", "webfetch"],
        deny: ["edit", "bash"],
      },
      {
        op: "create_team",
        name: "eng",
        projectId: "billing",
        reportsTo: "jules",
        role: "Engineering",
        job: "Ship accepted work as a PR.",
        specialists: [
          {
            name: "Eng.Build",
            role: "Implement",
            job: "Own a worktree. Ship the PR.",
            persona: "Terse implementer. Own the worktree.",
            instructions: "Implement only what Product accepted. Open a PR. Do not deploy.",
            tools: ["read", "edit", "bash", "lsp"],
          },
          {
            name: "Eng.Review",
            role: "Gate",
            job: "Adversarial pass. Can block.",
            persona: "Adversarial reviewer. Assume something is wrong.",
            instructions: "Read the diff against Product acceptance. Block on secrets or missing tests. Do not edit.",
            tools: ["read", "grep", "lsp"],
            deny: ["edit"],
          },
        ],
      },
      {
        op: "hire",
        name: "DevOps",
        kind: "bot",
        role: "Deploy",
        projectId: "billing",
        reportsTo: "you",
        job: "Staging deploy. Confirm on prod.",
        persona: "Staging-first operator.",
        instructions: "Deploy staging when confirmed. Prod needs a human. Never skip confirm.",
        tools: ["bash", "deploy"],
        deny: ["skip-confirm"],
      },
      {
        op: "hire",
        name: "QA",
        kind: "bot",
        role: "Test",
        projectId: "billing",
        reportsTo: "priya",
        job: "Run checks against acceptance.",
        persona: "Skeptical tester.",
        tools: ["bash", "read"],
        deny: ["deploy"],
      },
      {
        op: "create_team",
        name: "services",
        reportsTo: "you",
        role: "Shared services",
        job: "Explore, docs, scan, audit.",
        specialists: [
          {
            name: "Scout",
            role: "Explore",
            job: "Cheap, disposable search.",
            persona: "Cheap, disposable searcher.",
            tools: ["read", "grep", "webfetch"],
            deny: ["edit"],
          },
          {
            name: "Docs",
            role: "Write",
            job: "Docs paths only.",
            persona: "Docs-only writer.",
            tools: ["read", "edit"],
            deny: ["bash"],
          },
          {
            name: "Sec",
            role: "Scan",
            job: "Secrets and deps. Can block merge.",
            persona: "Secret and dependency scanner.",
            tools: ["read", "grep"],
            deny: ["edit"],
          },
          {
            name: "Scribe",
            role: "Audit",
            job: "Turn runs into the log.",
            persona: "Quiet audit note-taker.",
            tools: ["memory"],
            deny: ["edit", "deploy"],
          },
        ],
      },
    ],
  });
}

function contextBlock(state) {
  const seats = (state.seats || []).map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    kind: s.kind,
    team: s.team,
    projectId: s.projectId,
    system: s.system,
    job: s.job,
  }));
  return JSON.stringify(
    {
      organizations: state.organizations || [],
      projects: state.projects || [],
      teams: (state.teams || []).map((t) => ({ id: t.id, name: t.name, projectId: t.projectId, staffed: t.staffed })),
      seats,
    },
    null,
    2,
  );
}

export function architectPrompt(message, history, state) {
  const prior = (history || [])
    .slice(-8)
    .map((m) => `${m.role || "user"}: ${m.text || m.content || ""}`)
    .join("\n");
  return [
    "Propose ONE OrgPlan as a JSON object. No prose outside a short reply field.",
    "Ops: replace_org, create_project, create_team, hire, reparent, fire. Max 48 ops.",
    "Org → Project → Team → Seat. PMs are project-scoped (asPm: true, knowledge, skills).",
    "When the user wants a whole company or full org, start with replace_org (keeps You, Channel, Architect), then staff the new chart.",
    "Incremental asks (staff a project, hire, layoff) must not use replace_org.",
    "Do not fire you or system seats. Do not apply the plan.",
    `Current org:\n${contextBlock(state)}`,
    prior ? `History:\n${prior}` : "",
    `User: ${message}`,
    'Return JSON: { "summary", "rationale": [], "reply", "ops": [ ... ] }',
  ]
    .filter(Boolean)
    .join("\n\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForPlan(pull, timeoutMs = liveTimeoutMs()) {
  const deadline = Date.now() + timeoutMs;
  let lastBlob = "";
  while (Date.now() < deadline) {
    const parts = await pull("architect");
    const blob = (parts || []).map((p) => p.text || p).join("\n");
    if (blob) lastBlob = blob;
    emit({ scope: "architect", step: "architect.poll", seat: "architect", detail: { bytes: blob.length } });
    const plan = normalizePlan(parsePlanJson(blob));
    if (plan) return { plan, blob };
    await sleep(pollMs());
  }
  return { plan: null, blob: lastBlob };
}

export async function chatArchitect(state, { message, history } = {}, mutators = {}) {
  const text = String(message || "").trim();
  if (!text) {
    const err = new Error("message required");
    err.status = 400;
    throw err;
  }
  const wake = mutators.wakeSeat || wakeSeat;
  const pull = mutators.pullAssistant || pullAssistant;
  const ensureSystem = mutators.ensureSystem || (() => ensure({ kind: "system" }));

  if (process.env.ROSTER_ARCHITECT_MODE === "template") {
    const plan = planFromTemplates(text, state);
    if (!plan) {
      const err = new Error("could not draft a plan");
      err.status = 422;
      throw err;
    }
    plan.source = "template";
    storePlan(state, plan);
    emit({ scope: "architect", step: "architect.plan", seat: "architect", detail: { source: "template", planId: plan.id } });
    return { reply: plan.reply, plan, source: "template" };
  }

  emit({ scope: "architect", step: "architect.ensure", seat: "architect" });
  try {
    await ensureSystem();
  } catch (err) {
    err.status = err.status || 409;
    emit({ level: "error", scope: "architect", step: "architect.error", seat: "architect", detail: { error: err.message } });
    throw err;
  }

  let plan = null;
  let blob = "";
  try {
    emit({ scope: "architect", step: "architect.wake", seat: "architect" });
    const woke = await wake("architect", architectPrompt(text, history, state), {
      from: "you",
      kind: "architect",
    });
    if (woke?.offline) {
      const err = new Error("System harness is offline. Architect needs OpenCode.");
      err.status = 503;
      throw err;
    }
    if (woke?.error || woke?.human) {
      const err = new Error(woke?.error || "Architect could not start a System session.");
      err.status = 503;
      throw err;
    }
    const polled = await pollForPlan(pull);
    plan = polled.plan;
    blob = polled.blob || "";
  } catch (err) {
    emit({ level: "error", scope: "architect", step: "architect.error", seat: "architect", detail: { error: err.message } });
    if (err.status) throw err;
    const wrap = new Error(String(err.message || err));
    wrap.status = 503;
    throw wrap;
  }

  if (!plan) {
    const reply = blob.trim() || "Architect did not return a valid OrgPlan from the System harness.";
    emit({
      level: "warn",
      scope: "architect",
      step: "architect.noreply",
      seat: "architect",
      detail: { bytes: blob.length },
    });
    return { reply, plan: null, source: "live" };
  }
  plan.source = "live";
  storePlan(state, plan);
  emit({ scope: "architect", step: "architect.plan", seat: "architect", detail: { source: "live", planId: plan.id } });
  return { reply: plan.reply, plan, source: "live" };
}

export function getPlan(state, id) {
  return (state.architectPlans || []).find((p) => p.id === id) || null;
}
