import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cores = new Set();

function signalGroup(child, signal) {
  if (!child?.pid || child.exitCode != null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

function killCores(signal) {
  for (const child of cores) signalGroup(child, signal);
}

process.on("SIGTERM", () => {
  killCores("SIGKILL");
  process.exit(143);
});
process.on("exit", () => killCores("SIGKILL"));

/** Boot a throwaway CORE on a random port with an isolated data dir. Test-only. */
export async function bootCore(env) {
  const dir = mkdtempSync(join(tmpdir(), "rf-boot-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const callerSetRuntime = env && ("NODE_ENV" in env || "ENVIRONMENT" in env);
  const skip = /^(1|true)$/i.test(String(env?.ROSTER_SKIP_ONBOARDING || ""));
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
      ROSTER_AUTH_RATE_MAX: "100000",
      ROSTER_AUTH_LOCKOUT_AFTER: "100000",
      HOME: dir,
      ...(skip && !callerSetRuntime ? { ENVIRONMENT: "local" } : {}),
      ...env,
    },
    stdio: "ignore",
    detached: true,
  });
  cores.add(child);
  child.once("exit", () => cores.delete(child));
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
    dir,
    async stop() {
      signalGroup(child, "SIGTERM");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (child.exitCode == null) signalGroup(child, "SIGKILL");
      cores.delete(child);
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

/** Kill every CORE this process booted, including opencode children in its group. */
export async function stopAllCores() {
  const pending = [...cores];
  await Promise.all(
    pending.map(
      (child) =>
        new Promise((resolve) => {
          signalGroup(child, "SIGTERM");
          const timer = setTimeout(() => {
            signalGroup(child, "SIGKILL");
            resolve();
          }, 3000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );
}

