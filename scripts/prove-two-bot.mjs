/**
 * Prove two seats talk via OpenCode + the bus. Do not start the scripted ship train.
 * Usage: npm run standup (elsewhere) && npm run prove:two-bot
 */
const API = process.env.ROSTER_API || "http://127.0.0.1:8790";

async function req(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function hasKey() {
  return Boolean(
    process.env.XAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  );
}

const health = await req("/api/v1/health");
if (!health.providerKeys && !hasKey()) {
  console.error("prove-two-bot: no provider key in env or Settings. Set XAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY.");
  process.exit(2);
}

try {
  await req("/api/v1/harness/ensure", { method: "POST", body: "{}" });
} catch (err) {
  console.error("prove-two-bot: harness ensure failed:", err.message);
  process.exit(1);
}

const before = await req("/api/v1/bus");
const beforeIds = new Set((before || []).map((b) => b.id));

await req("/api/v1/messages", {
  method: "POST",
  body: JSON.stringify({
    from: "product",
    to: "build",
    text: "One-line acceptance: webhook must be idempotent. Reply via roster_send_message or roster_handoff.",
    wake: true,
  }),
});

const deadline = Date.now() + 45000;
let extra = [];
while (Date.now() < deadline) {
  const bus = await req("/api/v1/bus");
  extra = (bus || []).filter((b) => !beforeIds.has(b.id));
  const fromBuild = extra.some((b) => b.from === "build");
  const fromProduct = extra.some((b) => b.from === "product");
  if (fromBuild && fromProduct) {
    console.log("prove-two-bot: ok", extra.map((b) => `${b.from}→${b.to}`).join(", "));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

console.error("prove-two-bot: timed out waiting for product+build bus traffic");
console.error(JSON.stringify(extra, null, 2));
process.exit(1);
