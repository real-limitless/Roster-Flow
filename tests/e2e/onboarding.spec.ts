import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const PORT = 8799;

async function waitForApi() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/health`);
      if (res.ok) return;
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("onboarding API did not start");
}

async function routeToIsolatedApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const dest = `http://127.0.0.1:${PORT}${url.pathname}${url.search}`;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers())) {
      if (key.toLowerCase() === "host") continue;
      headers[key] = value;
    }
    const method = req.method();
    const res = await fetch(dest, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : req.postData() || undefined,
    });
    await route.fulfill({
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" },
      body: await res.text(),
    });
  });
}

test.describe("first-run onboarding", () => {
  let child: ChildProcess | undefined;
  let dir = "";

  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "roster-onboard-"));
    const env = { ...process.env, ROSTER_API_PORT: String(PORT), ROSTER_DATA_DIR: dir };
    delete env.ROSTER_SKIP_ONBOARDING;
    child = spawn("node", ["server/index.mjs"], { env, stdio: "pipe" });
    await waitForApi();
  });

  test.afterAll(() => {
    child?.kill("SIGTERM");
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("gates /app until setup, then login after complete", async ({ page }) => {
    await routeToIsolatedApi(page);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/setup/);
    await expect(page.getByTestId("setup-page")).toBeVisible();
    await expect(page.getByTestId("setup-step-install")).toBeVisible();
    await page.getByTestId("setup-continue-install").click();

    await expect(page.getByTestId("setup-step-first-user")).toBeVisible();
    await page.getByTestId("setup-name").fill("Chen");
    await page.getByTestId("setup-email").fill("chen@example.com");
    await page.getByTestId("setup-password").fill("password1");
    await page.getByTestId("setup-create-owner").click();

    await expect(page.getByTestId("setup-step-login")).toBeVisible();
    await page.getByTestId("setup-login-email").fill("chen@example.com");
    await page.getByTestId("setup-login-password").fill("password1");
    await page.getByTestId("setup-login-submit").click();

    await expect(page.getByTestId("setup-step-harness")).toBeVisible();
    await page.getByTestId("setup-skip-harness").click();

    await expect(page.getByTestId("setup-step-welcome")).toBeVisible();
    await page.getByTestId("setup-template-empty").click();
    await page.getByTestId("setup-enter-workspace").click();

    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    await expect(page.getByTestId("channel-general")).toBeVisible();

    await page.evaluate(() => localStorage.removeItem("roster-flow-token"));
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("login-page")).toBeVisible();

    await page.getByTestId("login-start-over").click();
    await page.getByTestId("start-over-email").fill("chen@example.com");
    await page.getByTestId("start-over-confirm").click();
    await expect(page).toHaveURL(/\/setup/);
    await expect(page.getByTestId("setup-page")).toBeVisible();
    await expect(page.getByTestId("setup-step-install")).toBeVisible();
  });
});
