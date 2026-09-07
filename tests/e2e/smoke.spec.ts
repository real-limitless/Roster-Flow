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
  const runBtn = page.getByTestId("run-ship-train");
  if (await runBtn.isEnabled()) await runBtn.click();
  await expect(page.getByText("Pipeline ship-billing").first()).toBeVisible({ timeout: 10_000 });
});

test("composer chips and click message opens seat inspector", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("composer-skill").click();
  await page.getByTestId("picker-item-deploy").click();
  await expect(page.getByTestId("compose-chip-skill-deploy")).toBeVisible();
  await page.getByTestId("composer-file").click();
  await page.getByTestId("picker-item-billing-webhook-ts").click();
  await expect(page.getByTestId("compose-chip-file-billing-webhook-ts")).toBeVisible();
  await page.getByTestId("composer").fill("chip check 42");
  await page.getByTestId("send-message").click();
  await expect(page.getByText("chip check 42").first()).toBeVisible();
  await expect(page.getByTestId("chip-skill-deploy").first()).toBeVisible();
  await expect(page.getByTestId("chip-file-billing-webhook-ts").first()).toBeVisible();

  await page.getByRole("button", { name: "Floor" }).first().click();
  await expect(page.getByTestId("seat-inspector")).toContainText("Floor");
  await page.getByRole("button", { name: "Product" }).first().click();
  await expect(page.getByTestId("seat-inspector")).toContainText("Product");
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

  const mayaLine = page.locator('[data-testid="org-line"][data-child="maya"]');
  await expect(mayaLine).toHaveCount(1);
  const endsAtMaya = await page.evaluate(() => {
    const chart = document.querySelector("[data-testid=org-chart]") as HTMLElement;
    const maya = document.querySelector("[data-testid=seat-maya]") as HTMLElement;
    const path = document.querySelector('[data-testid=org-line][data-child=maya]') as SVGPathElement;
    if (!chart || !maya || !path) return false;
    const crate = chart.getBoundingClientRect();
    const box = maya.getBoundingClientRect();
    const d = path.getAttribute("d") || "";
    const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const x2 = nums[nums.length - 2];
    const y2 = nums[nums.length - 1];
    const expectX = box.left + box.width / 2 - crate.left + chart.scrollLeft;
    const expectY = box.top - crate.top + chart.scrollTop;
    return Math.abs(x2 - expectX) < 8 && Math.abs(y2 - expectY) < 8;
  });
  expect(endsAtMaya).toBeTruthy();

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

test("team inspector shows seat count and hire specialist", async ({ page, request }) => {
  await request.post("http://127.0.0.1:8787/api/v1/reset");
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("team-eng").click();
  await expect(page.getByTestId("team-inspector")).toBeVisible();
  await expect(page.getByTestId("team-seat-count")).toBeVisible();
  const count = Number(await page.getByTestId("team-seat-count").innerText());
  expect(count).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId("team-models")).toContainText("anthropic/claude-sonnet");

  await page.getByTestId("mode-chart").click();
  await page.getByTestId("create-team").click();
  await expect(page.getByTestId("create-team-form")).toBeVisible();
  await page.getByTestId("team-name").fill("platform");
  await page.getByTestId("team-create-submit").click();
  await expect(page.getByTestId("team-platform")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("team-platform").click();
  await page.getByTestId("hire-specialist").click();
  await expect(page.getByTestId("hire-form")).toBeVisible();
  await page.getByPlaceholder("Eng.Mobile").fill("Platform.API");
  await page.getByTestId("hire-persona").fill("API implementer.");
  await page.getByTestId("hire-instructions").fill("Own the API worktree. Do not deploy.");
  await page.getByTestId("hire-submit").click();
  await page.getByTestId("seat-platform-api").click();
  await expect(page.getByTestId("seat-inspector")).toContainText("Platform.API");
  await expect(page.getByTestId("seat-persona")).toHaveValue(/API implementer/);
  await page.getByTestId("seat-model").selectOption({ index: 0 });
});

test("related pages still render chart/room", async ({ page }) => {
  await page.goto("/org");
  await expect(page.getByRole("heading", { name: /org chart is the control plane/i })).toBeVisible();
  await expect(page.getByTestId("org-chart")).toBeVisible();
  await page.goto("/product");
  await expect(page.getByRole("heading", { name: /the room, the org, the harness/i })).toBeVisible();
});
