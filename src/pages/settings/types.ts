export type Provider = {
  id: string;
  name: string;
  npm: string;
  baseURL: string;
  models: Array<{ id: string; name: string }>;
  apiKeyEnv: string;
  connected: boolean;
  hasStoredKey?: boolean;
};

export type HarnessKindStatus = {
  kind?: string;
  harness: string;
  binary?: string | null;
  port?: number | null;
  version?: string | null;
  workspace?: string;
  plugin?: string;
  pid?: number | null;
};

export type HarnessStatus = HarnessKindStatus & {
  systemHarness?: HarnessKindStatus;
};

export type SettingsPane = "harness" | "providers" | "agents" | "family" | "routines" | "access";

export const PRESET_PROVIDERS = [
  { id: "anthropic", name: "Anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", models: "claude-sonnet-4", baseURL: "" },
  { id: "openai", name: "OpenAI", apiKeyEnv: "OPENAI_API_KEY", models: "gpt-4.1", baseURL: "" },
  { id: "xai", name: "xAI", apiKeyEnv: "XAI_API_KEY", models: "grok-4", baseURL: "https://api.x.ai/v1" },
  { id: "google", name: "Google", apiKeyEnv: "GOOGLE_GENERATIVE_AI_API_KEY", models: "gemini-2.5-pro", baseURL: "" },
] as const;
