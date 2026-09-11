import { examplePayload, type Block } from "roster-flow-blocks";

export type SeatKind = "human" | "bot";
export type SeatType = "human" | "supervisor" | "generic" | "specialist";
export type SeatStatus = "idle" | "running" | "blocked" | "done" | "paused";

export type Organization = {
  id: string;
  name: string;
};

export type Project = {
  id: string;
  orgId: string;
  name: string;
  brief: string;
  constitution?: string;
  pmSeatId?: string;
  teamIds: string[];
  goalIds?: string[];
};

export type Goal = {
  id: string;
  title: string;
  description?: string;
  parentId?: string;
  status?: string;
};

export type Approval = {
  id: string;
  kind: "hire" | "strategy" | "budget_override" | "deploy" | string;
  status: "pending" | "approved" | "rejected" | string;
  actor: string;
  planId?: string;
  seatId?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
  resolvedAt?: string;
};

export type Routine = {
  id: string;
  seatId: string;
  title: string;
  intervalMinutes: number;
  cron?: string;
  timezone?: string;
  prompt: string;
  skillId?: string;
  enabled: boolean;
  impliesDeploy?: boolean;
  lastRunAt?: string | null;
  lastError?: string | null;
  activeRunId?: string | null;
  hasWebhookSecret?: boolean;
};

export type Seat = {
  id: string;
  name: string;
  role: string;
  kind: SeatKind;
  seatType?: SeatType;
  reportsTo?: string;
  team?: string;
  /** Unset = org-shared (Channel, Architect, services). */
  projectId?: string;
  tools: string[];
  deny: string[];
  model?: string;
  fallbackModel?: string;
  persona?: string;
  instructions?: string;
  knowledge?: string;
  skills?: string[];
  job: string;
  status: SeatStatus;
  /** Hidden on the org chart unless “Show system seats” is on. Channel is the conductor. */
  system?: boolean;
  preview?: "hire" | "fire";
};

export type ModelStrategy = "default" | "random" | "round_robin" | "fuse";

export type Team = {
  id: string;
  name: string;
  role?: string;
  description?: string;
  job?: string;
  rules?: string;
  seatIds: string[];
  staffed?: boolean;
  supervisorSeatId?: string;
  genericSeatId?: string;
  defaultModel?: string;
  fallbackModel?: string;
  modelStrategy?: ModelStrategy;
  allowedModels?: string[];
  projectId?: string;
  seatCount?: number;
  models?: string[];
};

export type Channel = {
  id: string;
  name: string;
  topic?: string;
  teamIds?: string[];
  seatIds?: string[];
};

export type CatalogModel = {
  providerID: string;
  modelID: string;
  name: string;
  connected?: boolean;
};

export const organizations: Organization[] = [{ id: "roster-flow", name: "Roster-flow" }];

export const projects: Project[] = [
  {
    id: "billing",
    orgId: "roster-flow",
    name: "Billing",
    brief: "Webhook idempotency and the ship train.",
    constitution: "Acceptance over opinions. Confirm on deploy. Do not skip the QA gate.",
    pmSeatId: "product",
    teamIds: ["eng", "ship"],
    goalIds: ["ship-train"],
  },
];

export const seats: Seat[] = [
  { id: "you", name: "You", role: "Board", kind: "human", seatType: "human", job: "Approve deploys. Fire any seat.", tools: ["approve"], deny: [], status: "idle" },
  { id: "maya", name: "Maya", role: "VP Eng", kind: "human", seatType: "human", reportsTo: "you", job: "Owns product and engineering seats.", tools: ["approve"], deny: [], status: "idle" },
  { id: "jules", name: "Jules", role: "Eng lead", kind: "human", seatType: "human", reportsTo: "maya", team: "eng", projectId: "billing", job: "Runs @eng. Attaches harness when a bot stalls.", tools: ["edit", "approve"], deny: ["deploy"], status: "idle" },
  { id: "priya", name: "Priya", role: "QA lead", kind: "human", seatType: "human", reportsTo: "you", job: "Owns the QA gate. Signs staging.", tools: ["approve"], deny: ["deploy"], status: "idle" },
  { id: "channel", name: "Channel", role: "Conductor", kind: "bot", seatType: "specialist", reportsTo: "you", model: "xai/grok-4", persona: "Org conductor. Dry, specific, never ships code.", instructions: "Compile human sentences into run graphs. Own @channel. Route via the bus. Do not edit or deploy.", job: "Compile sentences into runs. Own @channel. System seat.", tools: ["bus", "read"], deny: ["edit", "deploy"], status: "idle", system: true },
  { id: "architect", name: "Architect", role: "Org design", kind: "bot", seatType: "specialist", reportsTo: "you", model: "xai/grok-4", persona: "Org architect. Dry, specific. Propose plans. Never ship code.", instructions: "Propose an OrgPlan JSON only: replace_org, create_project, create_team, hire, reparent, fire. Cap 48 ops. Do not apply. Do not edit or deploy.", job: "Staff projects and suggest layoffs. System seat.", tools: ["bus", "read"], deny: ["edit", "deploy"], status: "idle", system: true },
  { id: "product", name: "Product", role: "Brief", kind: "bot", seatType: "specialist", reportsTo: "maya", projectId: "billing", model: "xai/grok-4", persona: "Product brief writer. Acceptance over opinions.", instructions: "Turn channel talk into a brief and acceptance list. No edits, no bash write.", knowledge: "Project billing: webhook idempotency. Acceptance over opinions. Confirm on deploy.", skills: ["brief"], job: "Write acceptance. No edits.", tools: ["read", "grep", "webfetch"], deny: ["edit", "bash"], status: "idle" },
  { id: "eng-supervisor", name: "Eng Supervisor", role: "Supervisor", kind: "bot", seatType: "supervisor", reportsTo: "jules", team: "eng", projectId: "billing", model: "xai/grok-4", persona: "Calm dispatcher. You assign work; you do not write code.", instructions: "When mail arrives for @eng, hand Generic undifferentiated work or a specialist whose job matches. Use roster_handoff. Never edit or deploy.", job: "Route @eng work to Generic or a specialist.", tools: ["bus", "read"], deny: ["edit", "deploy", "bash"], status: "idle" },
  { id: "eng-generic", name: "Eng Generic", role: "Generic", kind: "bot", seatType: "generic", reportsTo: "eng-supervisor", team: "eng", projectId: "billing", model: "xai/grok-4", persona: "Versatile eng teammate.", instructions: "Do whatever the Supervisor assigned. Stay in the worktree. Do not deploy.", job: "Default @eng worker for undifferentiated tasks.", tools: ["read", "edit", "bash"], deny: ["deploy"], status: "idle" },
  { id: "build", name: "Eng.Build", role: "Implement", kind: "bot", seatType: "specialist", reportsTo: "eng-supervisor", team: "eng", projectId: "billing", model: "opencode/big-pickle", persona: "Terse implementer. Own the worktree.", instructions: "Implement only what Product accepted. Open a PR. Do not deploy.", job: "Own a worktree. Ship the PR.", tools: ["read", "edit", "bash", "lsp"], deny: ["deploy"], status: "idle" },
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

export const teams: Team[] = [
  {
    id: "eng",
    name: "@eng",
    staffed: true,
    supervisorSeatId: "eng-supervisor",
    genericSeatId: "eng-generic",
    role: "Engineering",
    description: "Build and review product code.",
    job: "Ship accepted work as a PR.",
    rules: "Supervisor routes. Generic does undifferentiated work.",
    defaultModel: "xai/grok-4",
    fallbackModel: "anthropic/claude-sonnet",
    modelStrategy: "default",
    allowedModels: ["xai/grok-4", "anthropic/claude-sonnet", "openai/gpt-5"],
    projectId: "billing",
    seatIds: ["jules", "eng-supervisor", "eng-generic", "build", "review"],
  },
  {
    id: "services",
    name: "@services",
    role: "Shared services",
    description: "Explore, docs, scan, audit.",
    job: "Support every product team without shipping code to prod.",
    rules: "Read-heavy. Supervisor routes to the matching specialist.",
    staffed: true,
    supervisorSeatId: "services-supervisor",
    genericSeatId: "services-generic",
    defaultModel: "xai/grok-4",
    modelStrategy: "default",
    allowedModels: ["xai/grok-4"],
    seatIds: ["services-supervisor", "services-generic", "scout", "docs", "sec", "scribe"],
  },
  {
    id: "ship",
    name: "Ship train",
    staffed: false,
    projectId: "billing",
    seatIds: ["channel", "product", "build", "review", "devops", "qa"],
  },
];

export const channels: Channel[] = [
  { id: "ship", name: "#ship", topic: "Ship train", teamIds: [], seatIds: ["channel", "product", "build", "review", "devops", "qa", "you", "maya"] },
  { id: "incidents", name: "#incidents", topic: "Incidents", teamIds: ["eng", "services"], seatIds: ["channel", "you", "jules", "scout"] },
  { id: "eng-agents", name: "#eng-agents", topic: "Eng agents", teamIds: ["eng"], seatIds: ["channel"] },
  { id: "general", name: "#general", topic: "Everyone", teamIds: [], seatIds: ["channel", "you", "maya", "jules", "priya"] },
];

export type MsgAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
};

export type MsgSkill = {
  id: string;
  name: string;
};

export type MsgFile = {
  path: string;
  name: string;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
};

export type WorkspaceFile = {
  path: string;
  name: string;
};

export type GithubCheckState = "success" | "pending" | "failure" | "unknown";

export type GithubCard = {
  kind: "pull" | "issue";
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  state: "open" | "closed" | "merged" | string;
  merged?: boolean;
  draft?: boolean;
  branch?: string;
  base?: string;
  checks?: {
    status: GithubCheckState;
    summary: string;
    total: number;
    passed: number;
    failed: number;
  };
  stale: boolean;
  connected: boolean;
  fetchedAt?: string;
  mergeable?: boolean | null;
  note?: string;
};

export type Msg = {
  id: string;
  channel: string;
  who: string;
  kind: SeatKind;
  text: string;
  time: string;
  seatId?: string;
  attachments?: MsgAttachment[];
  skills?: MsgSkill[];
  files?: MsgFile[];
  blocks?: Block[];
  github?: GithubCard;
  system?: boolean;
  mirrored?: boolean;
  sessionId?: string;
};

export const skills: Skill[] = [
  { id: "brief", name: "brief", description: "Write acceptance and a Product brief." },
  { id: "review", name: "review", description: "Adversarial gate on the PR." },
  { id: "deploy", name: "deploy", description: "Staging deploy. Confirm on prod." },
  { id: "test", name: "test", description: "Run checks against acceptance." },
  { id: "scout", name: "scout", description: "Cheap disposable search of logs and code." },
];

export const workspaceFiles: WorkspaceFile[] = [
  { path: "billing/webhook.ts", name: "webhook.ts" },
  { path: "billing/webhook.test.ts", name: "webhook.test.ts" },
  { path: "docs/acceptance.md", name: "acceptance.md" },
  { path: "ops/staging.yml", name: "staging.yml" },
  { path: "constitution.md", name: "constitution.md" },
];

const kit = examplePayload();

export const seedMessages: Msg[] = [
  { id: "m1", channel: "ship", who: "Maya", kind: "human", seatId: "maya", text: "Talk to Product and the Eng team. When they complete, have DevOps deploy to staging and QA test everything.", time: "21:04" },
  { id: "m2", channel: "ship", who: "Channel", kind: "bot", seatId: "channel", text: kit.text, time: "21:04", blocks: kit.blocks },
  { id: "m3", channel: "ship", who: "Product", kind: "bot", seatId: "product", text: "Brief ready. Acceptance: webhook is idempotent, duplicate Stripe events do not double-charge, regression tests in billing/webhook.test.ts.", time: "21:05", files: [{ path: "billing/webhook.test.ts", name: "webhook.test.ts" }], skills: [{ id: "brief", name: "brief" }] },
  { id: "m4", channel: "incidents", who: "Jules", kind: "human", seatId: "jules", text: "Flaky 500 on /billing/webhook. Scout the last 2 hours then hand to Eng.Build.", time: "20:41" },
  { id: "m5", channel: "incidents", who: "Scout", kind: "bot", seatId: "scout", text: "Reproduced on staging. Stack in billing/webhook.ts:142. Handing off.", time: "20:42", files: [{ path: "billing/webhook.ts", name: "webhook.ts" }] },
];

export function seatIdForWho(who: string, roster: Seat[] = seats): string | undefined {
  const exact = roster.find((s) => s.name === who || s.id === who);
  if (exact) return exact.id;
  const lower = who.toLowerCase();
  return roster.find((s) => s.name.toLowerCase() === lower)?.id;
}

export function seatForMessage(msg: Pick<Msg, "seatId" | "who">, roster: Seat[] = seats): Seat | undefined {
  if (msg.seatId) {
    const byId = roster.find((s) => s.id === msg.seatId);
    if (byId) return byId;
  }
  return roster.find((s) => s.name === msg.who);
}

export function fileTestId(path: string) {
  return path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const testimonials = [
  { q: "I told the channel to talk to Eng and QA. I opened Harness on DevOps when the deploy hung. Same session.", who: "Maya · VP Eng" },
  { q: "It feels like Slack until I hit ⌘. and I’m in OpenCode.", who: "Jules · Founding engineer" },
  { q: "I’m a bot on the team. I don’t get a surprise dump. I get a run that waits for me.", who: "Priya · Head of QA" },
];

export const changelog = [
  { date: "2026-09-07", title: "Roster Block Kit", items: ["Bots post rich blocks in the room", "In-app builder at /app/blocks", "SDK in roster-flow-blocks"] },
  { date: "2026-09-07", title: "Chart Architect", items: ["Org → Project → Team → Seat", "Architect dock proposes plans", "Fire seats from the inspector"] },
  { date: "2026-09-07", title: "Team seats", items: ["Supervisor + Generic on every staffed team", "Specialist persona and instructions", "OpenCode agent write-through"] },
  { date: "2026-09-07", title: "CORE branch", items: ["OpenCode harness wrapper + plugin", "Teams/bots API", "Provider settings", "Org-chart connectors"] },
  { date: "2026-09-06", title: "Roster-flow named", items: ["Wordmark locked", "Room | Harness | Chart as mode 3"] },
  { date: "2026-09-02", title: "Org chart control plane", items: ["Hire / fire / attach from the chart", "Live run path overlay"] },
  { date: "2026-08-20", title: "OpenCode attach", items: ["Same session in Room and TUI", "Confirm on deploy"] },
];

export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

export function isServiceSeat(s: Seat) {
  return s.reportsTo === "services" || s.team === "services";
}

export function displayParentId(seat: Seat, roster: Seat[], showSystem: boolean): string | undefined {
  if (isServiceSeat(seat)) return "services";
  const byId = new Map(roster.map((s) => [s.id, s]));
  let p = seat.reportsTo;
  if (!showSystem) {
    while (p && byId.get(p)?.system) p = byId.get(p)?.reportsTo;
  }
  return p;
}

export function modelRef(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`;
}

export function enrichTeam(team: Team, roster: Seat[]): Team {
  const members = (team.seatIds || []).map((id) => roster.find((s) => s.id === id)).filter(Boolean) as Seat[];
  const models = [...new Set(members.map((s) => s.model).filter(Boolean))] as string[];
  return { ...team, seatCount: members.length || team.seatIds?.length || 0, models };
}
