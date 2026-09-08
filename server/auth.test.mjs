import assert from "node:assert/strict";
import test from "node:test";
import { addFirstUser, hashPassword, loginUser, publicUser, userFromToken, verifyPassword } from "./auth.mjs";
import { skipOnboarding } from "./flags.mjs";
import { pendingState } from "./seed.mjs";

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
