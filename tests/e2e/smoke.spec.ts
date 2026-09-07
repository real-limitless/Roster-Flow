import { expect, test } from "@playwright/test";

test("home renders Room / Harness / Chart story", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Staff an org of agents");
});

test("workspace room send and ship train", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("composer").fill("hello from playwright");
  await page.getByTestId("send-message").click();
  await expect(page.getByText("hello from playwright").first()).toBeVisible();
  await page.getByTestId("run-ship-train").click();
  await expect(page.getByText("Pipeline ship-billing").first()).toBeVisible({ timeout: 10_000 });
});

test("org chart connectors meet seats", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toBeVisible();
  await expect(page.getByTestId("seat-you")).toBeVisible();
  await expect(page.getByTestId("seat-maya")).toBeVisible();
  const lines = page.getByTestId("org-line");
  await expect(lines.first()).toBeVisible();
  const count = await lines.count();
  expect(count).toBeGreaterThanOrEqual(3);

  const you = await page.getByTestId("seat-you").boundingBox();
  const maya = await page.getByTestId("seat-maya").boundingBox();
  expect(you && maya).toBeTruthy();
  if (you && maya) {
    expect(maya.y).toBeGreaterThan(you.y + you.height / 2);
  }

  await page.getByTestId("seat-build").click();
  await expect(page.getByTestId("seat-inspector")).toContainText("Eng.Build");
  await page.getByTestId("attach-harness").click();
  await expect(page.getByTestId("mode-harness")).toHaveClass(/on/);
});

test("org chart connectors survive narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-connectors")).toBeVisible();
  expect(await page.getByTestId("org-line").count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("seat-you")).toBeVisible();
});

test("settings writes a provider through the API", async ({ page, request }) => {
  await page.goto("/app/settings");
  await expect(page.getByTestId("settings-providers")).toBeVisible();
  await page.getByTestId("provider-id").fill("demo-llm");
  await page.getByLabel("Display name").fill("Demo LLM");
  await page.getByLabel("Base URL").fill("http://127.0.0.1:11434/v1");
  await page.getByLabel("Models (comma-separated)").fill("demo-small");
  await page.getByTestId("provider-save").click();
  await expect(page.getByTestId("provider-card-demo-llm")).toBeVisible();
  const res = await request.get("http://127.0.0.1:8787/api/v1/providers");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.some((p: { id: string }) => p.id === "demo-llm")).toBeTruthy();
});

test("related pages still render chart/room", async ({ page }) => {
  await page.goto("/org");
  await expect(page.getByRole("heading", { name: /org chart is the control plane/i })).toBeVisible();
  await expect(page.getByTestId("org-chart")).toBeVisible();
  await page.goto("/product");
  await expect(page.getByRole("heading", { name: /the room, the org, the harness/i })).toBeVisible();
});
