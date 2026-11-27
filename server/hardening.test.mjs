import assert from "node:assert/strict";
import test from "node:test";
import { chargeAuthRate, authGuardKind, authGuardLimits, clearAuthFailures, recordAuthFailure, resetAuthGuard } from "./auth-guard.mjs";
import { clientIp } from "./client-ip.mjs";
import { allowOrigin, corsHeaders } from "./cors.mjs";
import { bootCore } from "./test-helpers.mjs";

function req({ origin, host, remote, headers = {} }) {
  return {
    headers: { origin, host, ...headers },
    socket: { remoteAddress: remote },
  };
}

test("auth guard kind covers login, access, setup, and slack", () => {
  assert.equal(authGuardKind("POST", "/api/v1/auth/login"), "login");
  assert.equal(authGuardKind("GET", "/api/v1/access"), "access");
  assert.equal(authGuardKind("POST", "/api/v1/setup/first-user"), "setup");
  assert.equal(authGuardKind("POST", "/api/v1/slack/events"), "slack");
  assert.equal(authGuardKind("GET", "/api/v1/health"), "");
});

test("auth guard defaults stay at 30 requests and 8 failures", () => {
  const limits = authGuardLimits({});
  assert.equal(limits.max, 30);
  assert.equal(limits.lockAfter, 8);
  assert.equal(authGuardLimits({ ROSTER_AUTH_GUARD_RESET: "1" }).max, 30);
  assert.equal(authGuardLimits({ ROSTER_AUTH_GUARD_RESET: "1" }).lockAfter, 8);
});

test("rate limit and lockout share one bucket per IP", () => {
  resetAuthGuard();
  const env = {
    ROSTER_AUTH_RATE_MAX: "2",
    ROSTER_AUTH_RATE_WINDOW_MS: "60000",
    ROSTER_AUTH_LOCKOUT_AFTER: "100",
    ROSTER_AUTH_LOCKOUT_MS: "60000",
  };
  assert.equal(chargeAuthRate("client-a", 1_000, env), null);
  assert.equal(chargeAuthRate("client-a", 1_100, env), null);
  const blocked = chargeAuthRate("client-a", 1_200, env);
  assert.equal(blocked.reason, "rate");
  assert.equal(blocked.error, "too many requests");
  assert.equal(blocked.retryAfter >= 1, true);
  assert.equal(chargeAuthRate("client-b", 1_200, env), null);
  resetAuthGuard();

  const lockEnv = {
    ROSTER_AUTH_RATE_MAX: "100",
    ROSTER_AUTH_RATE_WINDOW_MS: "60000",
    ROSTER_AUTH_LOCKOUT_AFTER: "2",
    ROSTER_AUTH_LOCKOUT_MS: "15000",
  };
  assert.equal(chargeAuthRate("client-a", 5_000, lockEnv), null);
  recordAuthFailure("client-a", 5_000, lockEnv);
  recordAuthFailure("client-a", 5_100, lockEnv);
  const locked = chargeAuthRate("client-a", 5_200, lockEnv);
  assert.equal(locked.reason, "lockout");
  assert.equal(locked.retryAfter, 15);
  clearAuthFailures("client-a");
  assert.equal(chargeAuthRate("client-a", 5_300, lockEnv), null);
  resetAuthGuard();
});

test("client IP ignores forwarded headers unless the peer is trusted", () => {
  const headers = { "cf-connecting-ip": "client-cf", "x-forwarded-for": "client-xff, peer-b" };
  const peer = req({ remote: "peer-a", headers });
  assert.equal(clientIp(peer, {}), "peer-a");
  assert.equal(clientIp(peer, { ROSTER_TRUST_PROXY: "1" }), "client-cf");
  assert.equal(
    clientIp(req({ remote: "::ffff:peer-a", headers: { "x-forwarded-for": "client-xff" } }), { ROSTER_TRUSTED_PROXIES: "peer-a" }),
    "client-xff",
  );
});

test("CORS allowlist defaults to same-origin and never reflects a wildcard", () => {
  const same = req({ origin: "https://app.example", host: "app.example" });
  assert.equal(allowOrigin(same, {}), "https://app.example");
  assert.equal(allowOrigin(req({ origin: "https://evil.example", host: "app.example" }), {}), "");
  assert.equal(allowOrigin(req({ host: "app.example" }), {}), "");
  const listed = { ROSTER_CORS_ORIGINS: "https://app.example, https://admin.example" };
  assert.equal(allowOrigin(req({ origin: "https://admin.example", host: "api.example" }), listed), "https://admin.example");
  assert.equal(allowOrigin(req({ origin: "https://app.example.evil", host: "api.example" }), listed), "");
  const headers = corsHeaders(req({ origin: "*", host: "app.example" }), { "access-control-allow-origin": "*" }, {});
  assert.equal(headers["access-control-allow-origin"], undefined);
});

test("login lockout returns 429 with Retry-After and CORS stays on the allowlist", async () => {
  const core = await bootCore({
    ROSTER_AUTH_RATE_MAX: "100",
    ROSTER_AUTH_LOCKOUT_AFTER: "2",
    ROSTER_AUTH_LOCKOUT_MS: "60000",
    ROSTER_CORS_ORIGINS: "https://app.example",
    NODE_ENV: "production",
    ENVIRONMENT: "production",
  });
  try {
    const login = () =>
      fetch(`${core.base}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify({ email: "nobody@example.com", password: "not-the-password" }),
      });
    const first = await login();
    assert.equal(first.status, 401);
    assert.equal(first.headers.get("access-control-allow-origin"), "https://app.example");
    const second = await login();
    assert.equal(second.status, 401);
    const third = await login();
    assert.equal(third.status, 429);
    assert.equal(Number(third.headers.get("retry-after")) >= 1, true);
    assert.equal((await third.json()).error, "too many failed attempts");
    const evil = await fetch(`${core.base}/api/v1/health`, { headers: { origin: "https://evil.example" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
    const trace = await fetch(`${core.base}/api/v1/debug/trace`);
    assert.equal(trace.status, 404);
  } finally {
    await core.stop();
  }
});

test("auth guard reset is off in production and clears a local test process", async () => {
  const login = (base) =>
    fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "not-the-password" }),
    });
  const prod = await bootCore({
    ROSTER_AUTH_RATE_MAX: "2",
    ROSTER_AUTH_LOCKOUT_AFTER: "100",
    ROSTER_AUTH_GUARD_RESET: "1",
    NODE_ENV: "production",
    ENVIRONMENT: "production",
  });
  try {
    const hidden = await fetch(`${prod.base}/api/v1/debug/auth-guard/reset`, { method: "POST" });
    assert.equal(hidden.status, 404);
    assert.equal((await login(prod.base)).status, 401);
    assert.equal((await login(prod.base)).status, 401);
    assert.equal((await login(prod.base)).status, 429);
    const again = await fetch(`${prod.base}/api/v1/debug/auth-guard/reset`, { method: "POST" });
    assert.equal(again.status, 404);
    assert.equal((await login(prod.base)).status, 429);
  } finally {
    await prod.stop();
  }

  const local = await bootCore({
    ROSTER_AUTH_RATE_MAX: "2",
    ROSTER_AUTH_LOCKOUT_AFTER: "100",
    ROSTER_AUTH_GUARD_RESET: "1",
    NODE_ENV: "local",
    ENVIRONMENT: "local",
  });
  try {
    assert.equal((await login(local.base)).status, 401);
    assert.equal((await login(local.base)).status, 401);
    assert.equal((await login(local.base)).status, 429);
    const reset = await fetch(`${local.base}/api/v1/debug/auth-guard/reset`, { method: "POST" });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).ok, true);
    assert.equal((await login(local.base)).status, 401);
  } finally {
    await local.stop();
  }

  const closed = await bootCore({
    ROSTER_AUTH_GUARD_RESET: "",
    NODE_ENV: "local",
    ENVIRONMENT: "local",
  });
  try {
    const reset = await fetch(`${closed.base}/api/v1/debug/auth-guard/reset`, { method: "POST" });
    assert.equal(reset.status, 404);
  } finally {
    await closed.stop();
  }
});

test("debug trace is served when the environment is dev", async () => {
  const core = await bootCore({
    ROSTER_SKIP_ONBOARDING: "1",
    ENVIRONMENT: "local",
    NODE_ENV: "dev",
    ROSTER_HARNESS_AUTOSTART: "0",
  });
  try {
    const trace = await fetch(`${core.base}/api/v1/debug/trace`);
    assert.equal(trace.status, 200);
    const body = await trace.json();
    assert.ok(Array.isArray(body.events));
    const setup = await fetch(`${core.base}/api/v1/setup/status`);
    assert.equal(setup.status, 200);
  } finally {
    await core.stop();
  }
});
