import { spawn } from "node:child_process";

const env = {
  ...process.env,
  ROSTER_SKIP_ONBOARDING: process.env.ROSTER_SKIP_ONBOARDING || "1",
  ROSTER_DEMO: process.env.ROSTER_DEMO || "1",
  ROSTER_DEMO_RESET_MS: process.env.ROSTER_DEMO_RESET_MS || String(30 * 60 * 1000),
};

console.log("Demo (no owner): http://127.0.0.1:5173/app  — starter #ship, Chart, Harness");
console.log("Resets on restart and on the DEMO_RESET interval. POST /api/v1/reset is off.");
console.log("Owner + keys + OpenCode: npm run standup → http://127.0.0.1:5173/setup");

const kids = [
  spawn(process.execPath, ["server/index.mjs"], { stdio: "inherit", env }),
  spawn("npm", ["run", "dev"], { stdio: "inherit", env, shell: true }),
];

function shut() {
  for (const k of kids) {
    if (!k.killed) k.kill("SIGTERM");
  }
}
process.on("SIGINT", shut);
process.on("SIGTERM", shut);
for (const k of kids) {
  k.on("exit", (code) => {
    if (code && code !== 0) shut();
  });
}
