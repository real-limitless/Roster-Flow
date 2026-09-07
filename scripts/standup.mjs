import { spawn } from "node:child_process";

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
