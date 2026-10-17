import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  INTERNAL_SEAT_FIELDS,
  internalPluginToken,
  internalTokenAllows,
  isInternalPluginToken,
  rotateInternalPluginToken,
} from "./internal-token.mjs";
import { TOKEN_PREFIX } from "./tokens.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the internal plugin token is an in-memory secret that rotates", () => {
  const first = internalPluginToken();
  assert.ok(first.startsWith(`${TOKEN_PREFIX}int_`));
  assert.ok(isInternalPluginToken(first));
  assert.equal(isInternalPluginToken(`${first.slice(0, -1)}x`), false);
  assert.equal(isInternalPluginToken(""), false);
  assert.equal(isInternalPluginToken(undefined), false);
  const next = rotateInternalPluginToken();
  assert.notEqual(next, first);
  assert.equal(isInternalPluginToken(first), false);
  assert.ok(isInternalPluginToken(next));
});

test("the internal token reaches plugin routes only", () => {
  for (const [method, path] of [
    ["POST", "/api/v1/messages"],
    ["POST", "/api/v1/bus/send"],
    ["GET", "/api/v1/sessions/ses_1/room"],
    ["GET", "/api/v1/seats/build/channels"],
    ["PATCH", "/api/v1/seats/build"],
    ["POST", "/api/v1/jobs/job-1/complete"],
    ["GET", "/api/v1/jobs/job-1"],
  ]) {
    assert.ok(internalTokenAllows(method, path), `${method} ${path}`);
  }
  for (const [method, path] of [
    ["GET", "/api/v1/jobs/callback-secret"],
    ["POST", "/api/v1/jobs/callback-secret/rotate"],
    ["DELETE", "/api/v1/seats/build"],
    ["POST", "/api/v1/tokens"],
    ["GET", "/api/v1/tokens"],
    ["POST", "/api/v1/reset"],
    ["PATCH", "/api/v1/channels/ship"],
    ["GET", "/api/v1/seats/build/inbox/extra"],
  ]) {
    assert.equal(internalTokenAllows(method, path), false, `${method} ${path}`);
  }
  assert.equal(internalTokenAllows("GET", "/api/v1/jobs/callback-secret"), false);
  assert.deepEqual(INTERNAL_SEAT_FIELDS, ["lastSession"]);
});

test("the internal token gets 403 on callback secret read and rotate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-internal-secret-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env };
  delete env.ROSTER_API_TOKEN;
  delete env.ROSTER_CALLBACK_SECRET;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { internalPluginToken } from ${JSON.stringify(join(repoRoot, "server/internal-token.mjs"))};
    await import(${JSON.stringify(join(repoRoot, "server/index.mjs"))});
    const base = "http://127.0.0.1:" + process.env.ROSTER_API_PORT;
    let up = false;
    for (let i = 0; i < 50; i++) {
      try {
        const health = await fetch(base + "/api/v1/health");
        if (health.ok) { up = true; break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!up) throw new Error("core did not start");
    const headers = { authorization: "Bearer " + internalPluginToken() };
    const get = await fetch(base + "/api/v1/jobs/callback-secret", { headers });
    const getBody = await get.text();
    const rot = await fetch(base + "/api/v1/jobs/callback-secret/rotate", { method: "POST", headers });
    const rotBody = await rot.text();
    console.log("RESULT " + JSON.stringify({ get: get.status, rotate: rot.status, getBody, rotBody }));
    process.exit(0);
  `], {
    cwd: repoRoot,
    env: {
      ...env,
      ROSTER_SKIP_ONBOARDING: "",
      ROSTER_API_HOST: "127.0.0.1",
      ROSTER_API_PORT: String(port),
      ROSTER_DATA_DIR: join(dir, "data"),
      ROSTER_OPENCODE_DIR: join(dir, "opencode"),
      ROSTER_WORKSPACE: join(dir, "ws"),
      ROSTER_DISABLE_ROUTINES: "1",
      ROSTER_HARNESS_AUTOSTART: "0",
      ROSTER_OWNER_EMAIL: "ops@example.com",
      ROSTER_OWNER_PASSWORD: "password1",
      OPENCODE_BIN: "/nonexistent/opencode",
      HOME: dir,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0, `${stderr}\n${stdout}`);
    const line = stdout.split("\n").find((row) => row.startsWith("RESULT "));
    const result = JSON.parse(line.slice("RESULT ".length));
    assert.equal(result.get, 403);
    assert.equal(result.rotate, 403);
    assert.doesNotMatch(result.getBody, /rfcb_/);
    assert.doesNotMatch(result.rotBody, /rfcb_/);
  } finally {
    if (child.exitCode == null) child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
