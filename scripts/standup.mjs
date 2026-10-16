import { spawn } from "node:child_process";

console.log(`Setup: http://127.0.0.1:${process.env.ROSTER_WEB_PORT || 5175}/setup`);

const kids = [
  spawn(process.execPath, ["server/index.mjs"], { stdio: "inherit", env: process.env }),
  spawn("npm", ["run", "dev"], { stdio: "inherit", env: process.env, shell: true }),
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
