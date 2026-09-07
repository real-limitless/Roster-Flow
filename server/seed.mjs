/** Starter company — keep aligned with src/data.ts */

export const seats = [
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

export const channels = [
  { id: "ship", name: "#ship" },
  { id: "incidents", name: "#incidents" },
  { id: "eng-agents", name: "#eng-agents" },
  { id: "general", name: "#general" },
];

export const teams = [
  { id: "eng", name: "@eng", seatIds: ["jules", "build", "review"] },
  { id: "services", name: "@services", seatIds: ["scout", "docs", "sec", "scribe"] },
  { id: "ship", name: "Ship train", seatIds: ["floor", "product", "build", "review", "devops", "qa"] },
];

export const messages = [
  { id: "m1", channel: "ship", who: "Maya", kind: "human", text: "Talk to Product and the Eng team. When they complete, have DevOps deploy to staging and QA test everything.", time: "21:04" },
  { id: "m2", channel: "ship", who: "Floor", kind: "bot", text: "Compiled run ship-billing. Product → @eng → confirm → DevOps → QA.", time: "21:04", run: true },
  { id: "m3", channel: "ship", who: "Product", kind: "bot", text: "Brief ready. Acceptance: webhook is idempotent, duplicate Stripe events do not double-charge, regression tests in billing/webhook.test.ts.", time: "21:05" },
  { id: "m4", channel: "incidents", who: "Jules", kind: "human", text: "Flaky 500 on /billing/webhook. Scout the last 2 hours then hand to Eng.Build.", time: "20:41" },
  { id: "m5", channel: "incidents", who: "Scout", kind: "bot", text: "Reproduced on staging. Stack in billing/webhook.ts:142. Handing off.", time: "20:42" },
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
