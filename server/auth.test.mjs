import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { addFirstUser, changePassword, hashPassword, loginUser, publicUser, resetOwnerPassword, userFromToken, verifyPassword } from "./auth.mjs";
import { skipOnboarding } from "./flags.mjs";
import { pendingState } from "./seed.mjs";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

test("scrypt hash verifies and rejects a wrong password", async () => {
  const { salt, hash } = await hashPassword("correct-horse");
  assert.equal(await verifyPassword("correct-horse", salt, hash), true);
  assert.equal(await verifyPassword("wrong-password", salt, hash), false);
});

test("addFirstUser is 409 when an owner already exists", async () => {
  const state = pendingState();
  const first = await addFirstUser(state, { name: "Chen", email: "chen@example.com", password: "password1" });
  assert.equal(first.role, "owner");
  assert.equal(first.seatId, "you");
  assert.ok(first.passwordHash);
  assert.deepEqual(publicUser(first).passwordHash, undefined);
  await assert.rejects(
    () => addFirstUser(state, { name: "Other", email: "other@example.com", password: "password1" }),
    (err) => err.status === 409,
  );
});

test("loginUser returns a bearer session and rejects a bad password", async () => {
  const state = pendingState();
  await addFirstUser(state, { name: "Chen", email: "chen@example.com", password: "password1" });
  const ok = await loginUser(state, { email: "chen@example.com", password: "password1" });
  assert.ok(ok.token.length >= 32);
  assert.equal(ok.user.email, "chen@example.com");
  assert.equal(userFromToken(state, ok.token)?.email, "chen@example.com");
  await assert.rejects(() => loginUser(state, { email: "chen@example.com", password: "nope-nope" }), (err) => err.status === 401);
});

test("changePassword rotates the hash and revokes other sessions", async () => {
  const state = pendingState();
  const owner = await addFirstUser(state, { name: "Chen", email: "chen@example.com", password: "password1" });
  const keep = await loginUser(state, { email: "chen@example.com", password: "password1" });
  const other = await loginUser(state, { email: "chen@example.com", password: "password1" });
  const out = await changePassword(state, {
    userId: owner.id,
    currentPassword: "password1",
    newPassword: "password2",
    keepToken: keep.token,
  });
  assert.equal(out.revoked, 1);
  assert.equal(out.kept, 1);
  assert.match(out.policy, /revokes every other session/);
  assert.equal(userFromToken(state, keep.token)?.email, "chen@example.com");
  assert.equal(userFromToken(state, other.token), null);
  await assert.rejects(() => loginUser(state, { email: "chen@example.com", password: "password1" }), (err) => err.status === 401);
  const next = await loginUser(state, { email: "chen@example.com", password: "password2" });
  assert.ok(next.token);
  await assert.rejects(
    () => changePassword(state, { userId: owner.id, currentPassword: "nope-nope", newPassword: "password3" }),
    (err) => err.status === 401,
  );
});

test("resetOwnerPassword keeps seats and drops every session", async () => {
  const state = pendingState();
  state.seats = [
    { id: "you", name: "You" },
    { id: "product", name: "Product" },
  ];
  await addFirstUser(state, { name: "Chen", email: "chen@example.com", password: "password1" });
  const session = await loginUser(state, { email: "chen@example.com", password: "password1" });
  const out = await resetOwnerPassword(state, { password: "recovered1" });
  assert.equal(out.revoked, 1);
  assert.equal(out.kept, 0);
  assert.equal(state.seats.length, 2);
  assert.equal(userFromToken(state, session.token), null);
  const ok = await loginUser(state, { email: "chen@example.com", password: "recovered1" });
  assert.ok(ok.token);
});

test("owner-reset CLI rewrites hash without deleting seats", async () => {
  const dir = mkdtempSync(join(tmpdir(), "roster-reset-"));
  try {
    const state = pendingState();
    await addFirstUser(state, { name: "Chen", email: "chen@example.com", password: "password1" });
    state.seats = [
      { id: "you", name: "You" },
      { id: "product", name: "Product" },
    ];
    writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
    const r = spawnSync(process.execPath, [join(repoRoot, "scripts/owner-reset.mjs"), "--password", "newpass99"], {
      env: { ...process.env, ROSTER_DATA_DIR: dir },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
    const next = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    assert.ok(next.seats.some((s) => s.id === "you"));
    assert.ok(next.seats.some((s) => s.id === "product"));
    assert.equal(next.authSessions.length, 0);
    assert.equal(await verifyPassword("newpass99", next.users[0].passwordSalt, next.users[0].passwordHash), true);
    assert.equal(await verifyPassword("password1", next.users[0].passwordSalt, next.users[0].passwordHash), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skipOnboarding is false unless the env flag is 1 or true", () => {
  const prev = process.env.ROSTER_SKIP_ONBOARDING;
  try {
    process.env.ROSTER_SKIP_ONBOARDING = "";
    assert.equal(skipOnboarding(), false);
    process.env.ROSTER_SKIP_ONBOARDING = "0";
    assert.equal(skipOnboarding(), false);
    process.env.ROSTER_SKIP_ONBOARDING = "1";
    assert.equal(skipOnboarding(), true);
    process.env.ROSTER_SKIP_ONBOARDING = "true";
    assert.equal(skipOnboarding(), true);
  } finally {
    if (prev === undefined) delete process.env.ROSTER_SKIP_ONBOARDING;
    else process.env.ROSTER_SKIP_ONBOARDING = prev;
  }
});
