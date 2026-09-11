import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
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
        ROSTER_SKIP_ONBOARDING: "1",
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || "e2e-slack-token",
        SLACK_CHANNEL_SHIP: process.env.SLACK_CHANNEL_SHIP || "C-SHIP",
        ROSTER_SLACK_API: process.env.ROSTER_SLACK_API || "http://127.0.0.1:8796",
        ROSTER_SLACK_SKIP_VERIFY: "1",
      },
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
