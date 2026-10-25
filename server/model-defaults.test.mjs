import assert from "node:assert/strict";
import test from "node:test";
import { contextTokenLimit, DEFAULT_CONTEXT_TOKENS, DEFAULT_OUTPUT_TOKENS, FEATHERLESS_CHAT_CONTEXT, FEATHERLESS_CHAT_ID, MIN_OUTPUT_TOKENS, outputTokenLimit } from "./model-defaults.mjs";

test("chat and conductor output budget stays at or above 512", () => {
  assert.ok(MIN_OUTPUT_TOKENS >= 512);
  assert.ok(DEFAULT_OUTPUT_TOKENS >= MIN_OUTPUT_TOKENS);
  assert.equal(outputTokenLimit(undefined), DEFAULT_OUTPUT_TOKENS);
  assert.equal(outputTokenLimit(0), DEFAULT_OUTPUT_TOKENS);
  assert.equal(outputTokenLimit(64), MIN_OUTPUT_TOKENS);
  assert.equal(outputTokenLimit(512), 512);
  assert.equal(outputTokenLimit(4096), 4096);
  assert.equal(contextTokenLimit(undefined), DEFAULT_CONTEXT_TOKENS);
  assert.equal(contextTokenLimit(200000), 200000);
  assert.equal(FEATHERLESS_CHAT_CONTEXT, 32768);
  assert.equal(contextTokenLimit(undefined, FEATHERLESS_CHAT_ID), 32768);
  assert.equal(contextTokenLimit(undefined, "deepseek-ai/DeepSeek-V4.1-Flash"), 262144);
});
