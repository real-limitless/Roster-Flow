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
        ROSTER_SKIP_ONBOARDING: "1",
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
