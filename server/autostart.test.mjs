import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { autostartHarness, harnessReadiness, providerFromEnv, seedProviderFromEnv, shouldAutostart } from "./autostart.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("providerFromEnv builds an upsert body without the key itself", () => {
  assert.equal(providerFromEnv({}), null);
  const p = providerFromEnv({
    ROSTER_PROVIDER_ID: "featherless",
    ROSTER_PROVIDER_BASE_URL: "https://api.featherless.ai/v1",
    ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
    ROSTER_PROVIDER_MODELS: "a/b, c/d",
    FEATHERLESS_API_KEY: "secret",
  });
  assert.deepEqual(p, {
    id: "featherless",
    name: "featherless",
    baseURL: "https://api.featherless.ai/v1",
    apiKeyEnv: "FEATHERLESS_API_KEY",
    models: ["a/b", "c/d"],
  });
  assert.ok(!JSON.stringify(p).includes("secret"));
  let seen = null;
  seedProviderFromEnv({ ROSTER_PROVIDER_ID: "x" }, (body) => (seen = body));
  assert.equal(seen.id, "x");
});

test("shouldAutostart needs an owner and a provider unless forced or disabled", () => {
  assert.equal(shouldAutostart({ env: {}, hasOwner: false, providerReady: true }).start, false);
  assert.equal(shouldAutostart({ env: {}, hasOwner: true, providerReady: false }).start, false);
  assert.equal(shouldAutostart({ env: {}, hasOwner: true, providerReady: true }).start, true);
  assert.equal(shouldAutostart({ env: { ROSTER_HARNESS_AUTOSTART: "0" }, hasOwner: true, providerReady: true }).start, false);
  assert.equal(shouldAutostart({ env: { ROSTER_HARNESS_AUTOSTART: "1" }, hasOwner: false, providerReady: false }).start, true);
});

test("autostartHarness starts company and system and records failures without throwing", async () => {
  const kinds = [];
  const up = await autostartHarness({ env: { ROSTER_HARNESS_AUTOSTART: "1" }, hasOwner: true, ensureFn: async ({ kind }) => kinds.push(kind) });
  assert.deepEqual(kinds, ["company", "system"]);
  assert.equal(up.status, "up");
  const failed = await autostartHarness({
    env: { ROSTER_HARNESS_AUTOSTART: "1" },
    hasOwner: true,
    ensureFn: async ({ kind }) => {
      if (kind === "system") throw new Error("boom");
    },
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /system: boom/);
  const r = harnessReadiness((kind) => ({ harness: kind === "company" ? "up" : "offline" }));
  assert.equal(r.ready, false);
});

test("fresh CORE with env owner + provider reports harness ready on /api/v1/health with no clicks", async () => {
  chmodSync(join(here, "fixtures/fake-opencode.mjs"), 0o755); // exec bit is not guaranteed after API-based commits
  const dir = mkdtempSync(join(tmpdir(), "rf-auto-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(here, "index.mjs")], {
    env: {
      ...process.env,
      ROSTER_SKIP_ONBOARDING: "",
      ROSTER_API_HOST: "127.0.0.1",
      ROSTER_API_PORT: String(port),
      ROSTER_DATA_DIR: join(dir, "data"),
      ROSTER_OPENCODE_DIR: join(dir, "opencode"),
      ROSTER_WORKSPACE: join(dir, "ws"),
      ROSTER_DISABLE_ROUTINES: "1",
      HOME: dir,
      OPENCODE_BIN: join(here, "fixtures/fake-opencode.mjs"),
      OPENCODE_PORT: String(port + 1),
      OPENCODE_SYSTEM_PORT: String(port + 2),
      ROSTER_HARNESS_AUTOSTART: "auto",
      ROSTER_OWNER_EMAIL: "ops@example.com",
      ROSTER_OWNER_PASSWORD: "password1",
      ROSTER_PROVIDER_ID: "featherless",
      ROSTER_PROVIDER_BASE_URL: "https://api.featherless.ai/v1",
      ROSTER_PROVIDER_API_KEY_ENV: "FEATHERLESS_API_KEY",
      ROSTER_PROVIDER_MODELS: "Qwen/Qwen2.5-Coder-32B-Instruct",
      FEATHERLESS_API_KEY: "test-key",
    },
    stdio: "ignore",
  });
  try {
    let health = null;
    for (let i = 0; i < 150; i++) {
      try {
        health = await (await fetch(`http://127.0.0.1:${port}/api/v1/health`)).json();
        if (health.harnessReady) break;
      } catch {
        /* booting */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(health?.harnessReady, true, JSON.stringify(health?.readiness));
    assert.equal(health.readiness.autostart.status, "up");
    assert.equal(health.providerKeys, true);
    assert.equal(health.readiness.autostart.reason, "owner and provider configured");
    const setup = await (await fetch(`http://127.0.0.1:${port}/api/v1/setup/status`)).json();
    assert.equal(setup.step, "done");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    rmSync(dir, { recursive: true, force: true });
  }
});
