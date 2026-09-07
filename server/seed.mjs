/** Starter company — keep aligned with src/data.ts */

export const seats = [
  { id: "you", name: "You", role: "Board", kind: "human", seatType: "human", job: "Approve deploys. Fire any seat.", tools: ["approve"], deny: [], status: "idle" },
  { id: "maya", name: "Maya", role: "VP Eng", kind: "human", seatType: "human", reportsTo: "you", job: "Owns product and engineering seats.", tools: ["approve"], deny: [], status: "idle" },
  { id: "jules", name: "Jules", role: "Eng lead", kind: "human", seatType: "human", reportsTo: "maya", team: "eng", job: "Runs @eng. Attaches harness when a bot stalls.", tools: ["edit", "approve"], deny: ["deploy"], status: "idle" },
  { id: "priya", name: "Priya", role: "QA lead", kind: "human", seatType: "human", reportsTo: "you", job: "Owns the QA gate. Signs staging.", tools: ["approve"], deny: ["deploy"], status: "idle" },
  { id: "floor", name: "Floor", role: "Conductor", kind: "bot", seatType: "specialist", reportsTo: "you", model: "xai/grok-4", persona: "Org conductor. Dry, specific, never ships code.", instructions: "Compile human sentences into run graphs. Route via the bus. Do not edit or deploy.", job: "Compile sentences into runs. System seat.", tools: ["bus", "read"], deny: ["edit", "deploy"], status: "idle", system: true },
  { id: "product", name: "Product", role: "Brief", kind: "bot", seatType: "specialist", reportsTo: "maya", model: "xai/grok-4", persona: "Product brief writer. Acceptance over opinions.", instructions: "Turn channel talk into a brief and acceptance list. No edits, no bash write.", job: "Write acceptance. No edits.", tools: ["read", "grep", "webfetch"], deny: ["edit", "bash"], status: "idle" },
  { id: "eng-supervisor", name: "Eng Supervisor", role: "Supervisor", kind: "bot", seatType: "supervisor", reportsTo: "jules", team: "eng", model: "xai/grok-4", persona: "Calm dispatcher. You assign work; you do not write code.", instructions: "When mail arrives for @eng, hand Generic undifferentiated work or a specialist whose job matches. Use roster_handoff. Never edit or deploy.", job: "Route @eng work to Generic or a specialist.", tools: ["bus", "read"], deny: ["edit", "deploy", "bash"], status: "idle" },
  { id: "eng-generic", name: "Eng Generic", role: "Generic", kind: "bot", seatType: "generic", reportsTo: "eng-supervisor", team: "eng", model: "xai/grok-4", persona: "Versatile eng teammate.", instructions: "Do whatever the Supervisor assigned. Stay in the worktree. Do not deploy.", job: "Default @eng worker for undifferentiated tasks.", tools: ["read", "edit", "bash"], deny: ["deploy"], status: "idle" },
  { id: "build", name: "Eng.Build", role: "Implement", kind: "bot", seatType: "specialist", reportsTo: "eng-supervisor", team: "eng", model: "anthropic/claude-sonnet", persona: "Terse implementer. Own the worktree.", instructions: "Implement only what Product accepted. Open a PR. Do not deploy.", job: "Own a worktree. Ship the PR.", tools: ["read", "edit", "bash", "lsp"], deny: ["deploy"], status: "idle" },
  { id: "review", name: "Eng.Review", role: "Gate", kind: "bot", seatType: "specialist", reportsTo: "eng-supervisor", team: "eng", model: "openai/gpt-5", persona: "Adversarial reviewer. Assume something is wrong.", instructions: "Read the diff against Product acceptance. Block on secrets or missing tests. Do not edit.", job: "Adversarial pass. Can block.", tools: ["read", "grep", "lsp"], deny: ["edit"], status: "idle" },
  { id: "devops", name: "DevOps", role: "Deploy", kind: "bot", seatType: "specialist", reportsTo: "you", model: "xai/grok-4", persona: "Staging-first operator.", instructions: "Deploy staging when confirmed. Prod needs a human. Never skip confirm.", job: "Staging deploy. Confirm on prod.", tools: ["bash", "deploy"], deny: ["skip-confirm"], status: "idle" },
  { id: "qa", name: "QA", role: "Test", kind: "bot", seatType: "specialist", reportsTo: "priya", model: "xai/grok-4", persona: "Skeptical tester.", instructions: "Run checks against Product acceptance. Post a structured report. Cannot deploy.", job: "Run checks against acceptance.", tools: ["bash", "read"], deny: ["deploy"], status: "idle" },
  { id: "services-supervisor", name: "Services Supervisor", role: "Supervisor", kind: "bot", seatType: "supervisor", reportsTo: "services", team: "services", model: "xai/grok-4", persona: "Shared-services dispatcher.", instructions: "Route explore, docs, scan, and audit work to the matching specialist or Generic. No edits.", job: "Route @services work.", tools: ["bus", "read"], deny: ["edit", "deploy", "bash"], status: "idle" },
  { id: "services-generic", name: "Services Generic", role: "Generic", kind: "bot", seatType: "generic", reportsTo: "services-supervisor", team: "services", model: "xai/grok-4", persona: "Generalist on the services lane.", instructions: "Handle small shared tasks the Supervisor assigns. Stay read-heavy. Do not deploy.", job: "Default @services worker.", tools: ["read", "grep", "webfetch"], deny: ["deploy"], status: "idle" },
  { id: "scout", name: "Scout", role: "Explore", kind: "bot", seatType: "specialist", reportsTo: "services-supervisor", team: "services", model: "xai/grok-4", persona: "Cheap, disposable searcher.", instructions: "Find the file, the stack, the last two hours. Hand off. Do not edit.", job: "Cheap, disposable search.", tools: ["read", "grep", "webfetch"], deny: ["edit"], status: "idle" },
  { id: "docs", name: "Docs", role: "Write", kind: "bot", seatType: "specialist", reportsTo: "services-supervisor", team: "services", model: "xai/grok-4", persona: "Docs-only writer.", instructions: "Update the file Product pointed at. Nothing else.", job: "Docs paths only.", tools: ["read", "edit"], deny: ["bash"], status: "idle" },
  { id: "sec", name: "Sec", role: "Scan", kind: "bot", seatType: "specialist", reportsTo: "services-supervisor", team: "services", model: "xai/grok-4", persona: "Secret and dependency scanner.", instructions: "Scan for leaks and bad deps. Can block merge. Do not edit.", job: "Secrets and deps. Can block merge.", tools: ["read", "grep"], deny: ["edit"], status: "idle" },
  { id: "scribe", name: "Scribe", role: "Audit", kind: "bot", seatType: "specialist", reportsTo: "services-supervisor", team: "services", model: "xai/grok-4", persona: "Quiet audit note-taker.", instructions: "Turn huddles and runs into the log. No mutating tools.", job: "Turn runs into the log.", tools: ["memory"], deny: ["edit", "deploy"], status: "idle" },
];

export const channels = [
  { id: "ship", name: "#ship" },
  { id: "incidents", name: "#incidents" },
  { id: "eng-agents", name: "#eng-agents" },
  { id: "general", name: "#general" },
];

export const teams = [
  { id: "eng", name: "@eng", staffed: true, supervisorSeatId: "eng-supervisor", genericSeatId: "eng-generic", defaultModel: "xai/grok-4", seatIds: ["jules", "eng-supervisor", "eng-generic", "build", "review"] },
  { id: "services", name: "@services", staffed: true, supervisorSeatId: "services-supervisor", genericSeatId: "services-generic", defaultModel: "xai/grok-4", seatIds: ["services-supervisor", "services-generic", "scout", "docs", "sec", "scribe"] },
  { id: "ship", name: "Ship train", staffed: false, seatIds: ["floor", "product", "build", "review", "devops", "qa"] },
];

export const messages = [
  { id: "m1", channel: "ship", who: "Maya", kind: "human", seatId: "maya", text: "Talk to Product and the Eng team. When they complete, have DevOps deploy to staging and QA test everything.", time: "21:04" },
  { id: "m2", channel: "ship", who: "Floor", kind: "bot", seatId: "floor", text: "Compiled run ship-billing. Product → @eng → confirm → DevOps → QA.", time: "21:04", run: true },
  { id: "m3", channel: "ship", who: "Product", kind: "bot", seatId: "product", text: "Brief ready. Acceptance: webhook is idempotent, duplicate Stripe events do not double-charge, regression tests in billing/webhook.test.ts.", time: "21:05", files: [{ path: "billing/webhook.test.ts", name: "webhook.test.ts" }], skills: [{ id: "brief", name: "brief" }] },
  { id: "m4", channel: "incidents", who: "Jules", kind: "human", seatId: "jules", text: "Flaky 500 on /billing/webhook. Scout the last 2 hours then hand to Eng.Build.", time: "20:41" },
  { id: "m5", channel: "incidents", who: "Scout", kind: "bot", seatId: "scout", text: "Reproduced on staging. Stack in billing/webhook.ts:142. Handing off.", time: "20:42", files: [{ path: "billing/webhook.ts", name: "webhook.ts" }] },
];

export const runSteps = [
  { id: "product", label: "Product", kind: "bot" },
  { id: "build", label: "Eng.Build", kind: "bot" },
  { id: "review", label: "Eng.Review", kind: "bot" },
  { id: "you", label: "Confirm", kind: "human" },
  { id: "devops", label: "DevOps", kind: "bot" },
  { id: "qa", label: "QA", kind: "bot" },
];

export const stepCopy = {
  product: "Acceptance written. Webhook must be idempotent. Tests in billing/webhook.test.ts.",
  build: "PR #482 opened on worktree billing-fix. Tests green.",
  review: "Gate open. No secret leak. Asking You to confirm deploy.",
  you: "Confirmed. Staging only.",
  devops: "Staging deploy complete. Waiting on QA.",
  qa: "14/14 passing. Report posted. Run ship-billing done.",
};

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
    persona: seat.persona || undefined,
    instructions: seat.instructions || undefined,
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

export function migrateState(state) {
  const next = state && typeof state === "object" ? state : emptyState();
  next.seats = (next.seats || []).map(normalizeSeat);
  next.teams = (next.teams || []).map((team) => {
    const staffed = team.staffed !== false && team.id !== "ship";
    const copy = {
      ...team,
      staffed,
      defaultModel: normalizeModelId(team.defaultModel) || (staffed ? "xai/grok-4" : undefined),
      seatIds: [...(team.seatIds || [])],
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
  return next;
}

export function emptyState() {
  return {
    seats: structuredClone(seats),
    channels: structuredClone(channels),
    teams: structuredClone(teams),
    messages: structuredClone(messages),
    bus: [],
    runs: [],
    sessions: {},
    providers: [],
    defaultProvider: "",
    defaultModel: "",
  };
}
