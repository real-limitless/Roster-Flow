import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.ROSTER_WEB_PORT || "5175";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node server/index.mjs",
      port: 8790,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        ROSTER_ARCHITECT_MODE: "template",
        ENVIRONMENT: "local",
        ROSTER_SKIP_ONBOARDING: "1",
        ROSTER_DEMO: "1",
        ROSTER_ALLOW_RESET: "1",
        ROSTER_DEMO_RESET_MS: "0",
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || "e2e-slack-token",
        SLACK_CHANNEL_SHIP: process.env.SLACK_CHANNEL_SHIP || "C-SHIP",
        ROSTER_SLACK_API: process.env.ROSTER_SLACK_API || "http://127.0.0.1:8796",
        ROSTER_SLACK_SKIP_VERIFY: "1",
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || "e2e-github-token",
        ROSTER_GITHUB_API: process.env.ROSTER_GITHUB_API || "http://127.0.0.1:8798",
        ROSTER_CALLBACK_ALLOWLIST: "127.0.0.1",
      },
    },
    {
      command: "npm run dev",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
