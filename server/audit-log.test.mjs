import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  actorLabel,
  auditLog,
  auditRuntimeEnv,
  beginRequestAudit,
  classifyAudit,
  emitResponseAudit,
  keyPrefix,
  redactAuditText,
  requestIdFrom,
} from "./audit-log.mjs";
import { clientIp } from "./client-ip.mjs";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

test("audit lines are JSON with the required fields and no extra secret fields", () => {
  const lines = [];
  const line = auditLog(
    {
      event: "key_change",
      action: "token.create",
      outcome: "success",
      actor: "usr-1",
      request_id: "req-12345678",
      client_ip: "client-a",
      user_agent: "test",
      host: "app.example",
      path: "/api/v1/tokens",
      method: "POST",
      status: 201,
      password: "super-secret",
      token: "rf_abcdefghijklmnopqrstuvwxyz",
      authorization: "Bearer rf_abcdefghijklmnopqrstuvwxyz",
      email: "person@example.com",
    },
    { write: (row) => lines.push(row), env: { NODE_ENV: "production" } },
  );
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  for (const key of [
    "ts",
    "level",
    "service",
    "env",
    "project",
    "event",
    "request_id",
    "actor",
    "client_ip",
    "user_agent",
    "host",
    "path",
    "method",
    "status",
    "action",
    "outcome",
  ]) {
    assert.equal(Object.hasOwn(parsed, key), true, key);
  }
  assert.deepEqual(parsed, line);
  assert.equal(parsed.project, "real-limitless");
  assert.equal(parsed.env, "production");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.event, "key_change");
  assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(lines[0].includes("super-secret"), false);
  assert.equal(lines[0].includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(lines[0].includes("person@example.com"), false);
  assert.equal(lines[0].includes("Bearer"), false);
  assert.equal(lines[0].includes("password"), false);
});

test("redaction and actor labels keep only a key prefix", () => {
  assert.equal(keyPrefix("rf_abcdefghijklmnopqrstuvwxyz"), "rf_abcd");
  assert.equal(actorLabel({ user: { id: "usr-9" }, presented: "rf_abcdefghijklmnopqrstuvwxyz" }), "usr-9");
  assert.equal(actorLabel({ tokenId: "tok-1", presented: "rf_abcdefghijklmnopqrstuvwxyz" }), "tok-1");
  assert.equal(actorLabel({ presented: "rf_abcdefghijklmnopqrstuvwxyz" }), "rf_abcd");
  assert.equal(redactAuditText("owner person@example.com Bearer rf_abcdefghijklmnopqrstuvwxyz"), "owner [redacted] Bearer [redacted]");
  assert.equal(redactAuditText("person@example.com").includes("person@"), false);
  assert.equal(auditRuntimeEnv({ ENVIRONMENT: "dev" }), "development");
  assert.equal(auditRuntimeEnv({ NODE_ENV: "prod" }), "production");
});

test("request ids are per request and forwarded headers need a trusted peer", () => {
  const generated = requestIdFrom({ headers: { "x-request-id": "Bearer secret" } });
  assert.match(generated, /^[a-f0-9]{16}$/);
  assert.equal(requestIdFrom({ headers: { "x-request-id": "req-12345678" } }), "req-12345678");
  const headers = { "cf-connecting-ip": "client-cf", "x-forwarded-for": "client-xff" };
  const peer = { headers, socket: { remoteAddress: "peer-a" } };
  assert.equal(clientIp(peer, {}), "peer-a");
  assert.equal(clientIp(peer, { ROSTER_TRUST_PROXY: "1" }), "client-cf");
});

test("status classification logs auth failure, denial, and rate limits once", () => {
  assert.equal(classifyAudit(401, { error: "invalid email or password" }).event, "auth_failure");
  assert.equal(classifyAudit(401, { error: "authentication required" }).event, "denial");
  assert.equal(classifyAudit(403, { error: "token scope does not allow this request" }).event, "denial");
  assert.equal(classifyAudit(429, { error: "cycle detector: too many ping-pongs" }).event, "rate_limit");
  const lines = [];
  const original = auditLog;
  const res = { rosterReq: { audit: { request_id: "req-12345678", path: "/api/v1/auth/login", method: "POST", actor: "" } } };
  const first = emitResponseAudit(res, 401, { error: "invalid email or password" });
  assert.equal(first.event, "auth_failure");
  assert.equal(first.outcome, "failure");
  const second = emitResponseAudit(res, 401, { error: "invalid email or password" });
  assert.equal(second, null);
  assert.equal(original, auditLog);
  beginRequestAudit(
    { headers: { host: "app.example", "user-agent": "unit", "x-request-id": "req-abcdef12" }, socket: { remoteAddress: "peer-a" } },
    res,
    { path: "/api/v1/auth/login", method: "POST" },
  );
  assert.equal(res.rosterReq.audit.request_id, "req-abcdef12");
  assert.equal(lines.length, 0);
});

test("failed login writes one auth_failure line and does not log the password or email", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-audit-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(repoRoot, "server/index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ROSTER_SKIP_ONBOARDING: "",
      ROSTER_API_HOST: "127.0.0.1",
      ROSTER_API_PORT: String(port),
      ROSTER_DATA_DIR: join(dir, "data"),
      ROSTER_OPENCODE_DIR: join(dir, "oc"),
      ROSTER_WORKSPACE: join(dir, "ws"),
      ROSTER_HARNESS_AUTOSTART: "0",
      ROSTER_DISABLE_ROUTINES: "1",
      OPENCODE_BIN: "/nonexistent/opencode",
      HOME: dir,
      NODE_ENV: "production",
      ENVIRONMENT: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let i = 0; i < 50; i++) {
      try {
        const health = await fetch(`${base}/api/v1/health`);
        if (health.ok) {
          up = true;
          break;
        }
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(up, true);
    const password = "not-the-password";
    const email = "nobody@example.com";
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-login-1" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("x-request-id"), "req-login-1");
    await new Promise((r) => setTimeout(r, 50));
    const events = stdout
      .split("\n")
      .filter((row) => row.startsWith("{"))
      .map((row) => JSON.parse(row))
      .filter((row) => row.event === "auth_failure");
    assert.equal(events.length, 1);
    assert.equal(events[0].request_id, "req-login-1");
    assert.equal(events[0].outcome, "failure");
    assert.equal(events[0].path, "/api/v1/auth/login");
    assert.equal(events[0].project, "real-limitless");
    assert.equal(events[0].env, "production");
    assert.equal(stdout.includes(password), false);
    assert.equal(stdout.includes(email), false);
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
