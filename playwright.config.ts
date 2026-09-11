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
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || "e2e-github-token",
        ROSTER_GITHUB_API: process.env.ROSTER_GITHUB_API || "http://127.0.0.1:8798",
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
