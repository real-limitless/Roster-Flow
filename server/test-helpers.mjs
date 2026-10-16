import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Boot a throwaway CORE on a random port with an isolated data dir. Test-only. */
export async function bootCore(env) {
  const dir = mkdtempSync(join(tmpdir(), "rf-boot-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(root, "server/index.mjs")], {
    env: {
      ...process.env,
      ROSTER_SKIP_ONBOARDING: "",
      ROSTER_API_HOST: "127.0.0.1",
      ROSTER_API_PORT: String(port),
      ROSTER_DATA_DIR: join(dir, "data"),
      ROSTER_OPENCODE_DIR: join(dir, "opencode"),
      ROSTER_WORKSPACE: join(dir, "ws"),
      ROSTER_DISABLE_ROUTINES: "1",
      OPENCODE_BIN: "/nonexistent/opencode",
      HOME: dir,
      ...env,
    },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/api/v1/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base,
    async stop() {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (child.exitCode == null) child.kill("SIGKILL");
      for (let i = 0; i < 5; i++) {
        try {
          rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    },
  };
}

