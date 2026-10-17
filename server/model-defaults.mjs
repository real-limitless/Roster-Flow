/** Default Featherless chat model for conductor, channel, architect, and other former Grok seats. */
export const FEATHERLESS_CHAT_ID = "deepseek-ai/DeepSeek-V4.1-Flash";

/** Coding model already published on the Featherless catalog. Seats assigned this id stay on it. */
export const FEATHERLESS_CODER_ID = "Qwen/Qwen2.5-Coder-32B-Instruct";

export const FEATHERLESS_CHAT_MODEL = `featherless/${FEATHERLESS_CHAT_ID}`;
export const FEATHERLESS_CODER_MODEL = `featherless/${FEATHERLESS_CODER_ID}`;

/**
 * Reasoning models spend the completion budget before they emit visible text.
 * Chat seats and the conductor must not be given a cap below this.
 */
export const MIN_OUTPUT_TOKENS = 512;

/** Written onto provider models when a caller does not set a higher completion budget. */
export const DEFAULT_OUTPUT_TOKENS = 8192;

/** A positive request is kept, and anything below {@link MIN_OUTPUT_TOKENS} is raised to that floor. */
export function outputTokenLimit(value) {
  const n = Number(value);
  const chosen = Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_OUTPUT_TOKENS;
  return Math.max(MIN_OUTPUT_TOKENS, chosen);
}
