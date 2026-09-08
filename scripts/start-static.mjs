import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/ is missing. Run npm run build first.");
  process.exit(1);
}

const env = {
  ...process.env,
  ROSTER_STATIC_DIR: process.env.ROSTER_STATIC_DIR || dist,
  ROSTER_API_HOST: process.env.ROSTER_API_HOST || "0.0.0.0",
  ROSTER_PUBLIC_URL: process.env.ROSTER_PUBLIC_URL || `http://127.0.0.1:${process.env.ROSTER_API_PORT || 8787}`,
};

const child = spawn(process.execPath, ["server/index.mjs"], { stdio: "inherit", env, cwd: root });
function shut() {
  if (!child.killed) child.kill("SIGTERM");
}
process.on("SIGINT", shut);
process.on("SIGTERM", shut);
child.on("exit", (code) => process.exit(code ?? 0));
