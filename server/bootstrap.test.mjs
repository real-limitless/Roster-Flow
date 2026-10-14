import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loginUser } from "./auth.mjs";
import {
  formatPasswordHash,
  ownerFromEnv,
  parsePasswordHash,
  requireBootstrapToken,
  seedOwner,
  seedOwnerFromEnv,
  setupClosed,
} from "./bootstrap.mjs";
import { pendingState } from "./seed.mjs";
import { setupStatus } from "./setup.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("bootstrap token: open when unset, 401 when wrong or missing, ok when matched", () => {
  assert.equal(requireBootstrapToken({ headers: {} }, {}, {}), true);
  const env = { ROSTER_BOOTSTRAP_TOKEN: "s3cret" };
  assert.throws(() => requireBootstrapToken({ headers: {} }, {}, env), (e) => e.status === 401);
  assert.throws(() => requireBootstrapToken({ headers: { "x-roster-bootstrap-token": "nope" } }, {}, env), (e) => e.status === 401);
  assert.equal(requireBootstrapToken({ headers: { "x-roster-bootstrap-token": "s3cret" } }, {}, env), true);
  assert.equal(requireBootstrapToken({ headers: {} }, { bootstrapToken: "s3cret" }, env), true);
});

test("env owner with plaintext password seeds owner, completes onboarding, closes setup", async () => {
  const env = { ROSTER_OWNER_EMAIL: "Ops@Example.com", ROSTER_OWNER_PASSWORD: "password1" };
  const out = await seedOwnerFromEnv(pendingState(), env);
  assert.equal(out.seeded, true);
  assert.equal(out.user.email, "ops@example.com");
  assert.equal(out.state.onboarding.complete, true);
  assert.equal(setupClosed(out.state), true);
  const status = setupStatus(out.state, {});
  assert.equal(status.complete, true);
  assert.equal(status.step, "done");
  const login = await loginUser(out.state, { email: "ops@example.com", password: "password1" });
  assert.ok(login.token);
  const again = await seedOwnerFromEnv(out.state, env);
  assert.equal(again.seeded, false, "re-seeding is a no-op once an owner exists");
});

test("env owner with a password hash logs in with the original password", async () => {
  const hash = await formatPasswordHash("hunter2hunter2");
  assert.deepEqual(Object.keys(parsePasswordHash(hash)), ["salt", "hash"]);
  const out = await seedOwnerFromEnv(pendingState(), { ROSTER_OWNER_EMAIL: "a@b.co", ROSTER_OWNER_PASSWORD_HASH: hash });
  await loginUser(out.state, { email: "a@b.co", password: "hunter2hunter2" });
  await assert.rejects(loginUser(out.state, { email: "a@b.co", password: "placeholder-not-used" }), (e) => e.status === 401);
});

test("env owner config errors are explicit", async () => {
  assert.equal(ownerFromEnv({}), null);
  assert.throws(() => ownerFromEnv({ ROSTER_OWNER_EMAIL: "a@b.co" }), /ROSTER_OWNER_PASSWORD/);
  assert.throws(() => parsePasswordHash("plain"), /scrypt/);
  const st = (await seedOwner(pendingState(), { email: "a@b.co", name: "A", password: "password1" })).state;
  await assert.rejects(seedOwner(st, { email: "c@d.co", name: "C", password: "password1" }), (e) => e.status === 409);
});

test("setup status flags the bootstrap token only before an owner exists", () => {
  const prev = process.env.ROSTER_BOOTSTRAP_TOKEN;
  process.env.ROSTER_BOOTSTRAP_TOKEN = "s3cret";
  try {
    assert.equal(setupStatus(pendingState(), {}).bootstrapTokenRequired, true);
  } finally {
    if (prev === undefined) delete process.env.ROSTER_BOOTSTRAP_TOKEN;
    else process.env.ROSTER_BOOTSTRAP_TOKEN = prev;
  }
});

async function bootCore(env) {
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
      await new Promise((r) => child.once("exit", r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("fresh CORE with env owner comes up with an owner and no setup screen", async () => {
  const core = await bootCore({ ROSTER_OWNER_EMAIL: "ops@example.com", ROSTER_OWNER_PASSWORD: "password1" });
  try {
    const status = await (await fetch(`${core.base}/api/v1/setup/status`)).json();
    assert.equal(status.hasUser, true);
    assert.equal(status.complete, true);
    assert.equal(status.step, "done");
    const first = await fetch(`${core.base}/api/v1/setup/first-user`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@example.com", password: "password1" }),
    });
    assert.equal(first.status, 409);
    const login = await fetch(`${core.base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ops@example.com", password: "password1" }),
    });
    assert.equal(login.status, 200);
  } finally {
    await core.stop();
  }
});

test("fresh CORE with ROSTER_BOOTSTRAP_TOKEN requires it to create the owner", async () => {
  const core = await bootCore({ ROSTER_BOOTSTRAP_TOKEN: "s3cret" });
  const body = JSON.stringify({ name: "Ops", email: "ops@example.com", password: "password1" });
  try {
    const status = await (await fetch(`${core.base}/api/v1/setup/status`)).json();
    assert.equal(status.bootstrapTokenRequired, true);
    const denied = await fetch(`${core.base}/api/v1/setup/first-user`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(denied.status, 401);
    const ok = await fetch(`${core.base}/api/v1/setup/first-user`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-roster-bootstrap-token": "s3cret" },
      body,
    });
    assert.equal(ok.status, 201);
    const closed = await fetch(`${core.base}/api/v1/setup/first-user`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-roster-bootstrap-token": "s3cret" },
      body,
    });
    assert.equal(closed.status, 409);
  } finally {
    await core.stop();
  }
});
