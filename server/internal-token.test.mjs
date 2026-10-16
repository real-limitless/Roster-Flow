import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERNAL_SEAT_FIELDS,
  internalPluginToken,
  internalTokenAllows,
  isInternalPluginToken,
  rotateInternalPluginToken,
} from "./internal-token.mjs";
import { TOKEN_PREFIX } from "./tokens.mjs";

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
  ]) {
    assert.ok(internalTokenAllows(method, path), `${method} ${path}`);
  }
  for (const [method, path] of [
    ["DELETE", "/api/v1/seats/build"],
    ["POST", "/api/v1/tokens"],
    ["GET", "/api/v1/tokens"],
    ["POST", "/api/v1/reset"],
    ["PATCH", "/api/v1/channels/ship"],
    ["GET", "/api/v1/seats/build/inbox/extra"],
  ]) {
    assert.equal(internalTokenAllows(method, path), false, `${method} ${path}`);
  }
  assert.deepEqual(INTERNAL_SEAT_FIELDS, ["lastSession"]);
});
