/** Starter company — keep aligned with src/data.ts */
import { examplePayload } from "roster-flow-blocks";
import { skipOnboarding } from "./flags.mjs";

export const seats = [
  { id: "you", name: "You", role: "Board", kind: "human", seatType: "human", job: "Approve deploys. Fire any seat.", tools: ["approve"], deny: [], status: "idle" },
  { id: "maya", name: "Maya", role: "VP Eng", kind: "human", seatType: "human", reportsTo: "you", job: "Owns product and engineering seats.", tools: ["approve"], deny: [], status: "idle" },
  { id: "jules", name: "Jules", role: "Eng lead", kind: "human", seatType: "human", reportsTo: "maya", team: "eng", projectId: "billing", job: "Runs @eng. Attaches harness when a bot stalls.", tools: ["edit", "approve"], deny: ["deploy"], status: "idle" },
  { id: "priya", name: "Priya", role: "QA lead", kind: "human", seatType: "human", reportsTo: "you", job: "Owns the QA gate. Signs staging.", tools: ["approve"], deny: ["deploy"], status: "idle" },
  { id: "channel", name: "Channel", role: "Conductor", kind: "bot", seatType: "specialist", reportsTo: "you", model: "xai/grok-4", persona: "Org conductor. Dry, specific, never ships code.", instructions: "Compile human sentences into run graphs. Own @channel. Route via the bus. Do not edit or deploy. Do not wake every bot — only specialists whose job matches.", job: "Compile sentences into runs. Own @channel. System seat.", tools: ["bus", "read"], deny: ["edit", "deploy"], status: "idle", system: true },
  { id: "architect", name: "Architect", role: "Org design", kind: "bot", seatType: "specialist", reportsTo: "you", model: "xai/grok-4", persona: "Org architect. Dry, specific. Propose plans. Never ship code.", instructions: "Propose an OrgPlan JSON only: replace_org, create_project, create_team, hire, reparent, fire. Cap 48 ops. Do not apply. Do not edit or deploy.", job: "Staff projects and suggest layoffs. System seat.", tools: ["bus", "read"], deny: ["edit", "deploy"], status: "idle", system: true },
  { id: "product", name: "Product", role: "Brief", kind: "bot", seatType: "specialist", reportsTo: "maya", projectId: "billing", model: "xai/grok-4", persona: "Product brief writer. Acceptance over opinions.", instructions: "Turn channel talk into a brief and acceptance list. No edits, no bash write.", knowledge: "Project billing: webhook idempotency. Acceptance over opinions. Confirm on deploy.", skills: ["brief"], job: "Write acceptance. No edits.", tools: ["read", "grep", "webfetch"], deny: ["edit", "bash"], status: "idle" },
  { id: "eng-supervisor", name: "Eng Supervisor", role: "Supervisor", kind: "bot", seatType: "supervisor", reportsTo: "jules", team: "eng", projectId: "billing", model: "xai/grok-4", persona: "Calm dispatcher. You assign work; you do not write code.", instructions: "When mail arrives for @eng, hand Generic undifferentiated work or a specialist whose job matches. Use roster_handoff. Never edit or deploy.", job: "Route @eng work to Generic or a specialist.", tools: ["bus", "read"], deny: ["edit", "deploy", "bash"], status: "idle" },
  { id: "eng-generic", name: "Eng Generic", role: "Generic", kind: "bot", seatType: "generic", reportsTo: "eng-supervisor", team: "eng", projectId: "billing", model: "xai/grok-4", persona: "Versatile eng teammate.", instructions: "Do whatever the Supervisor assigned. Stay in the worktree. Do not deploy.", job: "Default @eng worker for undifferentiated tasks.", tools: ["read", "edit", "bash"], deny: ["deploy"], status: "idle" },
  { id: "build", name: "Eng.Build", role: "Implement", kind: "bot", seatType: "specialist", reportsTo: "eng-supervisor", team: "eng", projectId: "billing", model: "anthropic/claude-sonnet", persona: "Terse implementer. Own the worktree.", instructions: "Implement only what Product accepted. Open a PR. Do not deploy.", job: "Own a worktree. Ship the PR.", tools: ["read", "edit", "bash", "lsp"], deny: ["deploy"], status: "idle" },
  { id: "review", name: "Eng.Review", role: "Gate", kind: "bot", seatType: "specialist", reportsTo: "eng-supervisor", team: "eng", projectId: "billing", model: "openai/gpt-5", persona: "Adversarial reviewer. Assume something is wrong.", instructions: "Read the diff against Product acceptance. Block on secrets or missing tests. Do not edit.", job: "Adversarial pass. Can block.", tools: ["read", "grep", "lsp"], deny: ["edit"], status: "idle" },
  { id: "devops", name: "DevOps", role: "Deploy", kind: "bot", seatType: "specialist", reportsTo: "you", projectId: "billing", model: "xai/grok-4", persona: "Staging-first operator.", instructions: "Deploy staging when confirmed. Prod needs a human. Never skip confirm.", job: "Staging deploy. Confirm on prod.", tools: ["bash", "deploy"], deny: ["skip-confirm"], status: "idle" },
  { id: "qa", name: "QA", role: "Test", kind: "bot", seatType: "specialist", reportsTo: "priya", projectId: "billing", model: "xai/grok-4", persona: "Skeptical tester.", instructions: "Run checks against Product acceptance. Post a structured report. Cannot deploy.", job: "Run checks against acceptance.", tools: ["bash", "read"], deny: ["deploy"], status: "idle" },
  { id: "services-supervisor", name: "Services Supervisor", role: "Supervisor", kind: "bot", seatType: "supervisor", reportsTo: "services", team: "services", model: "xai/grok-4", persona: "Shared-services dispatcher.", instructions: "Route explore, docs, scan, and audit work to the matching specialist or Generic. No edits.", job: "Route @services work.", tools: ["bus", "read"], deny: ["edit", "deploy", "bash"], status: "idle" },
  { id: "services-generic", name: "Services Generic", role: "Generic", kind: "bot", seatType: "generic", reportsTo: "services-supervisor", team: "services", model: "xai/grok-4", persona: "Generalist on the services lane.", instructions: "Handle small shared tasks the Supervisor assigns. Stay read-heavy. Do not deploy.", job: "Default @services worker.", tools: ["read", "grep", "webfetch"], deny: ["deploy"], status: "idle" },
  { id: "scout", name: "Scout", role: "Explore", kind: "bot", seatType: "specialist", reportsTo: "services-supervisor", team: "services", model: "xai/grok-4", persona: "Cheap, disposable searcher.", instructions: "Find the file, the stack, the last two hours. Hand off. Do not edit.", job: "Cheap, disposable search.", tools: ["read", "grep", "webfetch"], deny: ["edit"], status: "idle" },
  { id: "docs", name: "Docs", role: "Write", kind: "bot", seatType: "specialist", reportsTo: "services-supervisor", team: "services", model: "xai/grok-4", persona: "Docs-only writer.", instructions: "Update the file Product pointed at. Nothing else.", job: "Docs paths only.", tools: ["read", "edit"], deny: ["bash"], status: "idle" },
  { id: "sec", name: "Sec", role: "Scan", kind: "bot", seatType: "specialist", reportsTo: "services-supervisor", team: "services", model: "xai/grok-4", persona: "Secret and dependency scanner.", instructions: "Scan for leaks and bad deps. Can block merge. Do not edit.", job: "Secrets and deps. Can block merge.", tools: ["read", "grep"], deny: ["edit"], status: "idle" },
  { id: "scribe", name: "Scribe", role: "Audit", kind: "bot", seatType: "specialist", reportsTo: "services-supervisor", team: "services", model: "xai/grok-4", persona: "Quiet audit note-taker.", instructions: "Turn huddles and runs into the log. No mutating tools.", job: "Turn runs into the log.", tools: ["memory"], deny: ["edit", "deploy"], status: "idle" },
];

export const channels = [
  { id: "ship", name: "#ship", topic: "Ship train", teamIds: [], seatIds: ["channel", "product", "build", "review", "devops", "qa", "you", "maya"] },
  { id: "incidents", name: "#incidents", topic: "Incidents", teamIds: ["eng", "services"], seatIds: ["channel", "you", "jules", "scout"] },
  { id: "eng-agents", name: "#eng-agents", topic: "Eng agents", teamIds: ["eng"], seatIds: ["channel"] },
  { id: "general", name: "#general", topic: "Everyone", teamIds: [], seatIds: ["channel", "you", "maya", "jules", "priya"] },
];

export const teams = [
  { id: "eng", name: "@eng", role: "Engineering", description: "Build and review product code.", job: "Ship accepted work as a PR.", rules: "Supervisor routes. Generic does undifferentiated work. Specialists own implement and review.", staffed: true, supervisorSeatId: "eng-supervisor", genericSeatId: "eng-generic", defaultModel: "xai/grok-4", fallbackModel: "anthropic/claude-sonnet", modelStrategy: "default", allowedModels: ["xai/grok-4", "anthropic/claude-sonnet", "openai/gpt-5"], projectId: "billing", seatIds: ["jules", "eng-supervisor", "eng-generic", "build", "review"] },
  { id: "services", name: "@services", role: "Shared services", description: "Explore, docs, scan, audit.", job: "Support every product team without shipping code to prod.", rules: "Read-heavy. Supervisor routes to the matching specialist.", staffed: true, supervisorSeatId: "services-supervisor", genericSeatId: "services-generic", defaultModel: "xai/grok-4", fallbackModel: "xai/grok-4", modelStrategy: "default", allowedModels: ["xai/grok-4"], seatIds: ["services-supervisor", "services-generic", "scout", "docs", "sec", "scribe"] },
  { id: "ship", name: "Ship train", staffed: false, projectId: "billing", seatIds: ["channel", "product", "build", "review", "devops", "qa"] },
];

export const organizations = [{ id: "roster-flow", name: "Roster-flow" }];

export const projects = [
  {
    id: "billing",
    orgId: "roster-flow",
    name: "Billing",
    brief: "Webhook idempotency and the ship train.",
    constitution: "Acceptance over opinions. Confirm on deploy. Do not skip the QA gate.",
    pmSeatId: "product",
    teamIds: ["eng", "ship"],
  },
];

const kit = examplePayload();

export const messages = [
  { id: "m1", channel: "ship", who: "Maya", kind: "human", seatId: "maya", text: "Talk to Product and the Eng team. When they complete, have DevOps deploy to staging and QA test everything.", time: "21:04" },
  { id: "m2", channel: "ship", who: "Channel", kind: "bot", seatId: "channel", text: kit.text, time: "21:04", blocks: kit.blocks },
  { id: "m3", channel: "ship", who: "Product", kind: "bot", seatId: "product", text: "Brief ready. Acceptance: webhook is idempotent, duplicate Stripe events do not double-charge, regression tests in billing/webhook.test.ts.", time: "21:05", files: [{ path: "billing/webhook.test.ts", name: "webhook.test.ts" }], skills: [{ id: "brief", name: "brief" }] },
  { id: "m4", channel: "incidents", who: "Jules", kind: "human", seatId: "jules", text: "Flaky 500 on /billing/webhook. Scout the last 2 hours then hand to Eng.Build.", time: "20:41" },
  { id: "m5", channel: "incidents", who: "Scout", kind: "bot", seatId: "scout", text: "Reproduced on staging. Stack in billing/webhook.ts:142. Handing off.", time: "20:42", files: [{ path: "billing/webhook.ts", name: "webhook.ts" }] },
];

const NICK = {
  "grok-4": "xai/grok-4",
  "claude-sonnet": "anthropic/claude-sonnet",
  "gpt-5": "openai/gpt-5",
  fast: "xai/grok-4",
};

export function normalizeModelId(model) {
  if (!model) return "";
  const raw = String(model).trim();
  if (!raw) return "";
  if (NICK[raw]) return NICK[raw];
  return raw;
}

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

export function normalizeSeat(seat) {
  if (!seat) return seat;
  const kind = seat.kind === "human" ? "human" : "bot";
  const seatType = seat.seatType || (kind === "human" ? "human" : "specialist");
  return {
    ...seat,
    kind,
    seatType,
    model: kind === "human" ? undefined : normalizeModelId(seat.model) || undefined,
    fallbackModel: kind === "human" ? undefined : normalizeModelId(seat.fallbackModel) || undefined,
    persona: seat.persona || undefined,
    instructions: seat.instructions || undefined,
    knowledge: seat.knowledge || undefined,
    skills: Array.isArray(seat.skills) ? seat.skills.map(String).filter(Boolean) : undefined,
    projectId: seat.projectId || undefined,
  };
}

export function supervisorTemplate(team, extra = {}) {
  const label = String(team.name || team.id).replace(/^@/, "");
  return {
    id: extra.id || `${team.id}-supervisor`,
    name: extra.name || `${label} Supervisor`,
    role: "Supervisor",
    kind: "bot",
    seatType: "supervisor",
    reportsTo: extra.reportsTo || "you",
    team: team.id,
    projectId: extra.projectId || team.projectId,
    model: extra.model || team.defaultModel || "xai/grok-4",
    persona: extra.persona || "Calm dispatcher. You assign work; you do not write code.",
    instructions:
      extra.instructions ||
      `When mail arrives for ${team.name || "@" + team.id}, hand Generic undifferentiated work or a specialist whose job matches. Use roster_handoff. Never edit or deploy.`,
    job: extra.job || `Route ${team.name || team.id} work to Generic or a specialist.`,
    tools: ["bus", "read"],
    deny: ["edit", "deploy", "bash"],
    status: "idle",
  };
}

export function genericTemplate(team, extra = {}) {
  const label = String(team.name || team.id).replace(/^@/, "");
  return {
    id: extra.id || `${team.id}-generic`,
    name: extra.name || `${label} Generic`,
    role: "Generic",
    kind: "bot",
    seatType: "generic",
    reportsTo: extra.reportsTo || team.supervisorSeatId || `${team.id}-supervisor`,
    team: team.id,
    projectId: extra.projectId || team.projectId,
    model: extra.model || team.defaultModel || "xai/grok-4",
    persona: extra.persona || "Versatile teammate for undifferentiated work.",
    instructions:
      extra.instructions ||
      "Do whatever the Supervisor assigned. Stay in scope. Do not deploy.",
    job: extra.job || `Default ${team.name || team.id} worker.`,
    tools: extra.tools || ["read"],
    deny: extra.deny || ["deploy"],
    status: "idle",
  };
}

function rewriteFloorId(id) {
  return id === "floor" ? "channel" : id;
}

export function migrateFloorToChannel(state) {
  const seats = state.seats || [];
  const floor = seats.find((s) => s.id === "floor");
  const existing = seats.find((s) => s.id === "channel");
  if (floor && !existing) {
    floor.id = "channel";
    floor.name = "Channel";
    floor.role = floor.role || "Conductor";
    floor.system = true;
    if (!floor.job || /system seat/i.test(floor.job)) floor.job = "Compile sentences into runs. Own @channel. System seat.";
  } else if (floor && existing) {
    state.seats = seats.filter((s) => s.id !== "floor");
  }
  const conductor = (state.seats || []).find((s) => s.id === "channel");
  if (conductor && conductor.name === "Floor") conductor.name = "Channel";
  for (const team of state.teams || []) {
    team.seatIds = (team.seatIds || []).map(rewriteFloorId);
  }
  for (const msg of state.messages || []) {
    if (msg.seatId === "floor") msg.seatId = "channel";
    if (msg.who === "Floor") msg.who = "Channel";
  }
  for (const entry of state.bus || []) {
    if (entry.from === "floor") entry.from = "channel";
    if (entry.to === "floor") entry.to = "channel";
  }
  if (state.sessions?.floor) {
    state.sessions.channel = state.sessions.channel || state.sessions.floor;
    delete state.sessions.floor;
  }
  return state;
}

const BILLING_SEAT_IDS = new Set(["jules", "product", "eng-supervisor", "eng-generic", "build", "review", "devops", "qa"]);

export function architectTemplate() {
  return {
    id: "architect",
    name: "Architect",
    role: "Org design",
    kind: "bot",
    seatType: "specialist",
    reportsTo: "you",
    model: "xai/grok-4",
    persona: "Org architect. Dry, specific. Propose plans. Never ship code.",
    instructions:
      "Propose an OrgPlan JSON only: replace_org, create_project, create_team, hire, reparent, fire. Cap 48 ops. Do not apply. Do not edit or deploy.",
    job: "Staff projects and suggest layoffs. System seat.",
    tools: ["bus", "read"],
    deny: ["edit", "deploy"],
    status: "idle",
    system: true,
  };
}

export const defaultOnboarding = {
  complete: true,
  template: "starter",
  harnessSkipped: false,
  installSeen: true,
  harnessSeen: true,
};

export function pendingOnboarding() {
  return {
    complete: false,
    template: null,
    harnessSkipped: false,
    installSeen: false,
    harnessSeen: false,
  };
}

export function holdOrgSeed(state) {
  const o = state?.onboarding;
  if (!o) return false;
  if (o.complete === false) return true;
  return o.template === "empty";
}

export function migrateOnboarding(state) {
  if (!Array.isArray(state.users)) state.users = [];
  if (!Array.isArray(state.authSessions)) state.authSessions = [];
  if (!state.onboarding || typeof state.onboarding !== "object") {
    state.onboarding = { ...defaultOnboarding };
    return state;
  }
  const o = state.onboarding;
  const template = o.template === "empty" ? "empty" : o.template === "starter" ? "starter" : o.complete ? "starter" : null;
  state.onboarding = {
    complete: Boolean(o.complete),
    template,
    harnessSkipped: Boolean(o.harnessSkipped),
    installSeen: Boolean(o.installSeen),
    harnessSeen: Boolean(o.harnessSeen),
  };
  return state;
}

export function migrateOrgsAndProjects(state) {
  if (!Array.isArray(state.organizations) || !state.organizations.length) {
    state.organizations = structuredClone(organizations);
  }
  if (!state.organizations.some((o) => o.id === "roster-flow")) {
    state.organizations.push({ id: "roster-flow", name: "Roster-flow" });
  }
  if (!Array.isArray(state.projects)) state.projects = [];
  if (holdOrgSeed(state)) {
    if (state.onboarding?.complete && !(state.seats || []).some((s) => s.id === "architect")) {
      state.seats = [...(state.seats || []), architectTemplate()];
    }
    if (!Array.isArray(state.architectPlans)) state.architectPlans = [];
    if (!state.systemSessions || typeof state.systemSessions !== "object") state.systemSessions = {};
    if (!state.sessionRooms || typeof state.sessionRooms !== "object") state.sessionRooms = {};
    return state;
  }
  if (!state.projects.some((p) => p.id === "billing")) {
    state.projects.push(structuredClone(projects[0]));
  }
  const billing = state.projects.find((p) => p.id === "billing");
  if (billing) {
    billing.orgId = billing.orgId || "roster-flow";
    billing.teamIds = Array.isArray(billing.teamIds) ? billing.teamIds : [];
    for (const id of ["eng", "ship"]) {
      if (!billing.teamIds.includes(id) && (state.teams || []).some((t) => t.id === id)) billing.teamIds.push(id);
    }
    if (!billing.pmSeatId && (state.seats || []).some((s) => s.id === "product")) billing.pmSeatId = "product";
  }
  for (const team of state.teams || []) {
    if ((team.id === "eng" || team.id === "ship") && !team.projectId) team.projectId = "billing";
  }
  for (const seat of state.seats || []) {
    if (BILLING_SEAT_IDS.has(seat.id) && !seat.projectId) seat.projectId = "billing";
  }
  if (!(state.seats || []).some((s) => s.id === "architect")) {
    state.seats = [...(state.seats || []), architectTemplate()];
  }
  if (!Array.isArray(state.architectPlans)) state.architectPlans = [];
  if (!state.systemSessions || typeof state.systemSessions !== "object") state.systemSessions = {};
  if (!state.sessionRooms || typeof state.sessionRooms !== "object") state.sessionRooms = {};
  return state;
}

function defaultChannelMembership(id) {
  if (id === "ship") return { teamIds: [], seatIds: ["channel", "product", "build", "review", "devops", "qa", "you", "maya"] };
  if (id === "eng-agents") return { teamIds: ["eng"], seatIds: ["channel"] };
  if (id === "incidents") return { teamIds: ["eng", "services"], seatIds: ["channel", "you", "jules", "scout"] };
  if (id === "general") return { teamIds: [], seatIds: ["channel", "you", "maya", "jules", "priya"] };
  return { teamIds: [], seatIds: ["channel"] };
}

export function migrateState(state) {
  const next = state && typeof state === "object" ? state : emptyState();
  migrateOnboarding(next);
  migrateFloorToChannel(next);
  migrateOrgsAndProjects(next);
  next.seats = (next.seats || []).map(normalizeSeat);
  next.teams = (next.teams || []).map((team) => {
    const staffed = team.staffed !== false && team.id !== "ship";
    const copy = {
      ...team,
      staffed,
      role: team.role || (staffed ? "Team" : "Run roster"),
      description: team.description || "",
      job: team.job || "",
      rules: team.rules || "",
      defaultModel: normalizeModelId(team.defaultModel) || (staffed ? "xai/grok-4" : undefined),
      fallbackModel: normalizeModelId(team.fallbackModel) || undefined,
      modelStrategy: team.modelStrategy || "default",
      allowedModels: Array.isArray(team.allowedModels) ? team.allowedModels.map(normalizeModelId).filter(Boolean) : [],
      projectId: team.projectId || undefined,
      seatIds: [...(team.seatIds || [])].map(rewriteFloorId),
    };
    if (!staffed) return copy;
    if (!copy.supervisorSeatId || !next.seats.some((s) => s.id === copy.supervisorSeatId)) {
      const sup = supervisorTemplate(copy);
      if (!next.seats.some((s) => s.id === sup.id)) next.seats.push(sup);
      copy.supervisorSeatId = sup.id;
    }
    if (!copy.genericSeatId || !next.seats.some((s) => s.id === copy.genericSeatId)) {
      const gen = genericTemplate({ ...copy });
      if (!next.seats.some((s) => s.id === gen.id)) next.seats.push(gen);
      copy.genericSeatId = gen.id;
    }
    for (const id of [copy.supervisorSeatId, copy.genericSeatId]) {
      if (id && !copy.seatIds.includes(id)) copy.seatIds.push(id);
    }
    return copy;
  });
  next.channels = (next.channels || []).map((ch) => {
    const name = ch.name || `#${ch.id}`;
    const teamIds = Array.isArray(ch.teamIds) ? [...ch.teamIds] : [];
    const seatIds = Array.isArray(ch.seatIds) ? ch.seatIds.map(rewriteFloorId) : [];
    const seeded = defaultChannelMembership(ch.id);
    return {
      id: ch.id,
      name: name.startsWith("#") ? name : `#${name}`,
      topic: ch.topic || "",
      teamIds: teamIds.length ? teamIds : seeded.teamIds,
      seatIds: [...new Set((seatIds.length ? seatIds : seeded.seatIds).concat(["channel"]))],
    };
  });
  return next;
}

function baseFields() {
  return {
    architectPlans: [],
    bus: [],
    sessions: {},
    systemSessions: {},
    sessionRooms: {},
    providers: [],
    defaultProvider: "",
    defaultModel: "",
    users: [],
    authSessions: [],
  };
}

export function youSeat(name = "You") {
  return {
    id: "you",
    name,
    role: "Board",
    kind: "human",
    seatType: "human",
    job: "Approve deploys. Fire any seat.",
    tools: ["approve"],
    deny: [],
    status: "idle",
  };
}

export function channelSeat() {
  const found = seats.find((s) => s.id === "channel");
  return structuredClone(found);
}

export function starterState() {
  return {
    seats: structuredClone(seats),
    channels: structuredClone(channels),
    teams: structuredClone(teams),
    organizations: structuredClone(organizations),
    projects: structuredClone(projects),
    messages: structuredClone(messages),
    ...baseFields(),
    onboarding: { ...defaultOnboarding },
  };
}

export function pendingState() {
  return {
    seats: [],
    channels: [],
    teams: [],
    organizations: structuredClone(organizations),
    projects: [],
    messages: [],
    ...baseFields(),
    onboarding: pendingOnboarding(),
  };
}

export function emptyOrgState(ownerName = "You") {
  return {
    seats: [youSeat(ownerName), channelSeat(), architectTemplate()],
    channels: [{ id: "general", name: "#general", topic: "Everyone", teamIds: [], seatIds: ["channel", "you"] }],
    teams: [],
    organizations: structuredClone(organizations),
    projects: [],
    messages: [
      {
        id: "welcome",
        channel: "general",
        who: "Channel",
        kind: "bot",
        seatId: "channel",
        text: `Welcome, ${ownerName}. This is #general. Staff the chart when you are ready.`,
        time: "00:00",
      },
    ],
    ...baseFields(),
    onboarding: {
      complete: true,
      template: "empty",
      harnessSkipped: false,
      installSeen: true,
      harnessSeen: true,
    },
  };
}

export function bootState() {
  return skipOnboarding() ? starterState() : pendingState();
}

/** Starter company. Tests and existing callers keep this name. */
export function emptyState() {
  return starterState();
}
