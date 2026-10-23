import { openCodeIsV2 } from "./opencode-generation.mjs";

/** Default Featherless chat model. Small instruct model that answers inside a room turn. */
export const FEATHERLESS_CHAT_ID = "Qwen/Qwen2.5-7B-Instruct";

/** Coding model already published on the Featherless catalog. Seats assigned this id stay on it. */
export const FEATHERLESS_CODER_ID = "Qwen/Qwen2.5-Coder-32B-Instruct";

/** OpenCode 2 rewrites a recognized `featherless` id onto its signed-in provider. */
export const FEATHERLESS_PROVIDER_ID = openCodeIsV2() ? "roster-featherless" : "featherless";
export const FEATHERLESS_CHAT_MODEL = `${FEATHERLESS_PROVIDER_ID}/${FEATHERLESS_CHAT_ID}`;
export const FEATHERLESS_CODER_MODEL = `${FEATHERLESS_PROVIDER_ID}/${FEATHERLESS_CODER_ID}`;

/**
 * Reasoning models spend the completion budget before they emit visible text.
 * Chat seats and the conductor must not be given a cap below this.
 */
export const MIN_OUTPUT_TOKENS = 512;

/** Written onto provider models when a caller does not set a higher completion budget. */
export const DEFAULT_OUTPUT_TOKENS = 8192;

/**
 * Context window stored beside the completion budget. OpenCode rejects a model
 * limit that sets output without context.
 */
export const DEFAULT_CONTEXT_TOKENS = 128000;

/** Qwen2.5 7B context window. A missing limit must not fall back to the generic 128000. */
export const FEATHERLESS_CHAT_CONTEXT = 32768;

/** A positive request is kept, and anything below {@link MIN_OUTPUT_TOKENS} is raised to that floor. */
export function outputTokenLimit(value) {
  const n = Number(value);
  const chosen = Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_OUTPUT_TOKENS;
  return Math.max(MIN_OUTPUT_TOKENS, chosen);
}

/** A positive context window is kept. A missing one uses the chat window for V4.1 Flash, otherwise {@link DEFAULT_CONTEXT_TOKENS}. */
export function contextTokenLimit(value, modelId) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  if (modelId === FEATHERLESS_CHAT_ID || modelId === "deepseek-ai/DeepSeek-V4.1-Flash") {
    return modelId === FEATHERLESS_CHAT_ID ? FEATHERLESS_CHAT_CONTEXT : 262144;
  }
  return DEFAULT_CONTEXT_TOKENS;
}
