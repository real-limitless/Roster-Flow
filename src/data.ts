export type SeatKind = "human" | "bot";
export type SeatStatus = "idle" | "running" | "blocked" | "done";

export type Seat = {
  id: string;
  name: string;
  role: string;
  kind: SeatKind;
  reportsTo?: string;
  team?: string;
  tools: string[];
  deny: string[];
  model?: string;
  job: string;
  status: SeatStatus;
  /** Hidden on the org chart unless “Show system seats” is on. Floor is the conductor. */
  system?: boolean;
};

export type Channel = {
  id: string;
  name: string;
};

export const seats: Seat[] = [
  { id: "you", name: "You", role: "Board", kind: "human", job: "Approve deploys. Fire any seat.", tools: ["approve"], deny: [], status: "idle" },
  { id: "maya", name: "Maya", role: "VP Eng", kind: "human", reportsTo: "you", job: "Owns product and engineering seats.", tools: ["approve"], deny: [], status: "idle" },
  { id: "jules", name: "Jules", role: "Eng lead", kind: "human", reportsTo: "maya", job: "Runs @eng. Attaches harness when a bot stalls.", tools: ["edit", "approve"], deny: ["deploy"], status: "idle" },
  { id: "priya", name: "Priya", role: "QA lead", kind: "human", reportsTo: "you", job: "Owns the QA gate. Signs staging.", tools: ["approve"], deny: ["deploy"], status: "idle" },
  { id: "floor", name: "Floor", role: "Conductor", kind: "bot", reportsTo: "you", model: "grok-4", job: "Compile sentences into runs. System seat.", tools: ["bus", "read"], deny: ["edit", "deploy"], status: "idle", system: true },
  { id: "product", name: "Product", role: "Brief", kind: "bot", reportsTo: "maya", model: "grok-4", job: "Write acceptance. No edits.", tools: ["read", "grep", "webfetch"], deny: ["edit", "bash"], status: "idle" },
  { id: "build", name: "Eng.Build", role: "Implement", kind: "bot", reportsTo: "jules", team: "eng", model: "claude-sonnet", job: "Own a worktree. Ship the PR.", tools: ["read", "edit", "bash", "lsp"], deny: ["deploy"], status: "idle" },
  { id: "review", name: "Eng.Review", role: "Gate", kind: "bot", reportsTo: "jules", team: "eng", model: "gpt-5", job: "Adversarial pass. Can block.", tools: ["read", "grep", "lsp"], deny: ["edit"], status: "idle" },
  { id: "devops", name: "DevOps", role: "Deploy", kind: "bot", reportsTo: "you", model: "grok-4", job: "Staging deploy. Confirm on prod.", tools: ["bash", "deploy"], deny: ["skip-confirm"], status: "idle" },
  { id: "qa", name: "QA", role: "Test", kind: "bot", reportsTo: "priya", model: "grok-4", job: "Run checks against acceptance.", tools: ["bash", "read"], deny: ["deploy"], status: "idle" },
  { id: "scout", name: "Scout", role: "Explore", kind: "bot", reportsTo: "services", team: "services", model: "fast", job: "Cheap, disposable search.", tools: ["read", "grep", "webfetch"], deny: ["edit"], status: "idle" },
  { id: "docs", name: "Docs", role: "Write", kind: "bot", reportsTo: "services", team: "services", model: "grok-4", job: "Docs paths only.", tools: ["read", "edit"], deny: ["bash"], status: "idle" },
  { id: "sec", name: "Sec", role: "Scan", kind: "bot", reportsTo: "services", team: "services", model: "grok-4", job: "Secrets and deps. Can block merge.", tools: ["read", "grep"], deny: ["edit"], status: "idle" },
  { id: "scribe", name: "Scribe", role: "Audit", kind: "bot", reportsTo: "services", team: "services", model: "grok-4", job: "Turn runs into the log.", tools: ["memory"], deny: ["edit", "deploy"], status: "idle" },
];

export const channels: Channel[] = [
  { id: "ship", name: "#ship" },
  { id: "incidents", name: "#incidents" },
  { id: "eng-agents", name: "#eng-agents" },
  { id: "general", name: "#general" },
];

export type Msg = {
  id: string;
  channel: string;
  who: string;
  kind: SeatKind;
  text: string;
  time: string;
  run?: boolean;
};

export const seedMessages: Msg[] = [
  { id: "m1", channel: "ship", who: "Maya", kind: "human", text: "Talk to Product and the Eng team. When they complete, have DevOps deploy to staging and QA test everything.", time: "21:04" },
  { id: "m2", channel: "ship", who: "Floor", kind: "bot", text: "Compiled run ship-billing. Product → @eng → confirm → DevOps → QA.", time: "21:04", run: true },
  { id: "m3", channel: "ship", who: "Product", kind: "bot", text: "Brief ready. Acceptance: webhook is idempotent, duplicate Stripe events do not double-charge, regression tests in billing/webhook.test.ts.", time: "21:05" },
  { id: "m4", channel: "incidents", who: "Jules", kind: "human", text: "Flaky 500 on /billing/webhook. Scout the last 2 hours then hand to Eng.Build.", time: "20:41" },
  { id: "m5", channel: "incidents", who: "Scout", kind: "bot", text: "Reproduced on staging. Stack in billing/webhook.ts:142. Handing off.", time: "20:42" },
];

export const runSteps = [
  { id: "product", label: "Product" },
  { id: "build", label: "Eng.Build" },
  { id: "review", label: "Eng.Review" },
  { id: "you", label: "Confirm" },
  { id: "devops", label: "DevOps" },
  { id: "qa", label: "QA" },
];

export const testimonials = [
  { q: "I told the channel to talk to Eng and QA. I opened Harness on DevOps when the deploy hung. Same session.", who: "Maya · VP Eng" },
  { q: "It feels like Slack until I hit ⌘. and I’m in OpenCode.", who: "Jules · Founding engineer" },
  { q: "I’m a bot on the team. I don’t get a surprise dump. I get a run that waits for me.", who: "Priya · Head of QA" },
];

export const changelog = [
  { date: "2026-09-06", title: "Roster-flow named", items: ["Wordmark locked", "Room | Harness | Chart as mode 3"] },
  { date: "2026-09-02", title: "Org chart control plane", items: ["Hire / fire / attach from the chart", "Live run path overlay"] },
  { date: "2026-08-20", title: "OpenCode attach", items: ["Same session in Room and TUI", "Confirm on deploy"] },
];

export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/^#/, "")
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
