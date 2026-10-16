import assert from "node:assert/strict";
import test from "node:test";
import { allowStateReset, demoMode, demoResetMs, skipOnboarding } from "./flags.mjs";

function withEnv(map, fn) {
  const prev = {};
  for (const key of Object.keys(map)) {
    prev[key] = process.env[key];
    const next = map[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(map)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test("demoMode is off unless ROSTER_DEMO is 1 or true", () => {
  withEnv({ ROSTER_DEMO: "" }, () => assert.equal(demoMode(), false));
  withEnv({ ROSTER_DEMO: "0" }, () => assert.equal(demoMode(), false));
  withEnv({ ROSTER_DEMO: "1" }, () => assert.equal(demoMode(), true));
  withEnv({ ROSTER_DEMO: "true" }, () => assert.equal(demoMode(), true));
});

test("allowStateReset is false on public demo unless ROSTER_ALLOW_RESET", () => {
  withEnv({ ROSTER_DEMO: "1", ROSTER_ALLOW_RESET: "" }, () => assert.equal(allowStateReset(), false));
  withEnv({ ROSTER_DEMO: "1", ROSTER_ALLOW_RESET: "1" }, () => assert.equal(allowStateReset(), true));
  withEnv({ ROSTER_DEMO: "", ROSTER_ALLOW_RESET: "" }, () => assert.equal(allowStateReset(), true));
});

test("demoResetMs defaults to 30 minutes in demo and 0 otherwise", () => {
  withEnv({ ROSTER_DEMO: "", ROSTER_DEMO_RESET_MS: undefined }, () => assert.equal(demoResetMs(), 0));
  withEnv({ ROSTER_DEMO: "1", ROSTER_DEMO_RESET_MS: undefined }, () => assert.equal(demoResetMs(), 30 * 60 * 1000));
  withEnv({ ROSTER_DEMO: "1", ROSTER_DEMO_RESET_MS: "0" }, () => assert.equal(demoResetMs(), 0));
  withEnv({ ROSTER_DEMO: "1", ROSTER_DEMO_RESET_MS: "5000" }, () => assert.equal(demoResetMs(), 5000));
});

test("skipOnboarding still reads ROSTER_SKIP_ONBOARDING", () => {
  withEnv({ ROSTER_SKIP_ONBOARDING: "1" }, () => assert.equal(skipOnboarding(), true));
});
