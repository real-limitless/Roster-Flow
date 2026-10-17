import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";

test("home renders Room / Harness / Chart story", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Staff an org of agents");
  await expect(page.getByText("SSO ready")).toHaveCount(0);
  await expect(page.getByText("Local owner account")).toBeVisible();
});

test("homepage See #ship lands in starter #ship without an owner", async ({ page }) => {
  await page.goto("/");
  await page.screenshot({ path: "/tmp/walkthrough/home-see-ship.png", fullPage: true });
  await page.getByTestId("cta-see-ship").click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect(page.getByTestId("channel-ship")).toBeVisible();
  await expect(page.getByTestId("demo-banner")).toContainText("Demo");
  await expect(page.getByTestId("demo-banner")).toContainText("resets on restart");
  await page.screenshot({ path: "/tmp/walkthrough/demo-room.png", fullPage: true });
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toBeVisible();
  await page.screenshot({ path: "/tmp/walkthrough/demo-chart.png", fullPage: true });
  await page.getByTestId("mode-harness").click();
  await expect(page.getByTestId("harness-term")).toBeVisible();
  await page.screenshot({ path: "/tmp/walkthrough/demo-harness.png", fullPage: true });
});

test("ship coach inserts the sentence, highlights Chart, and dismisses", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await expect(page.getByTestId("ship-coach")).toBeVisible();
  await expect(page.getByTestId("run-ship-train")).toHaveCount(0);
  await page.getByTestId("ship-coach-insert").click();
  await expect(page.getByTestId("composer")).toHaveValue(/Talk to Product and the Eng team/);
  await page.screenshot({ path: "/tmp/walkthrough/ship-coach.png", fullPage: true });
  await page.getByTestId("ship-coach-send").click();
  await expect(page.getByTestId("mode-chart")).toHaveClass(/on/);
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await expect(page.getByTestId("seat-build").first()).toHaveAttribute("data-coach-path", "1");
  await expect(page.getByTestId("seat-qa").first()).toHaveAttribute("data-coach-path", "1");
  await page.screenshot({ path: "/tmp/walkthrough/ship-coach-chart.png", fullPage: true });
  await page.getByTestId("mode-room").click();
  await page.getByTestId("ship-coach-dismiss").click();
  await expect(page.getByTestId("ship-coach")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect(page.getByTestId("ship-coach")).toHaveCount(0);
});

test("workspace room send and block kit seed", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect(page.getByTestId("toggle-debug")).toBeVisible();
  await expect(page.getByTestId("rail-sessions")).toBeVisible();
  await page.getByTestId("composer").fill("hello from playwright");
  await page.getByTestId("send-message").click();
  await expect(page.getByText("hello from playwright").first()).toBeVisible();
  await expect(page.getByText(/Starting |Waking |Harness offline|No API key|not in Settings/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("toggle-debug").click();
  await expect(page.getByTestId("chat-debug")).toBeVisible();
  await expect(page.getByTestId("run-ship-train")).toHaveCount(0);
  await expect(page.getByText("Pipeline ship-billing")).toHaveCount(0);
  await expect(page.getByTestId("blocks-m2")).toBeVisible();
  await expect(page.getByTestId("blocks-m2")).toContainText("New request");
});

test("block kit builder add-block and json", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await page.getByTestId("open-block-kit").click();
  await expect(page.getByTestId("block-kit-builder")).toBeVisible();
  await expect(page.getByTestId("block-preview")).toContainText("New request");
  await expect(page.getByTestId("block-json")).toHaveValue(/header/);
  await page.getByTestId("add-block-header").click();
  await expect(page.getByTestId("block-json")).toHaveValue(/Header/);
  await page.getByTestId("template-status").click();
  await expect(page.getByTestId("block-preview")).toContainText("Staging deploy");
});

async function resetApi(request: { post: (url: string) => Promise<{ json: () => Promise<unknown> }> }) {
  const res = await request.post("http://127.0.0.1:8790/api/v1/reset");
  const body = (await res.json()) as { seats?: Array<{ id: string; name: string }>; teams?: Array<{ id: string; seatIds?: string[] }> };
  const channel = body.seats?.find((s) => s.id === "channel");
  if (channel?.name !== "Channel") throw new Error(`reset did not restore Channel conductor (got ${channel?.name || "missing"})`);
  const eng = body.teams?.find((t) => t.id === "eng");
  if ((eng?.seatIds?.length || 0) < 4) throw new Error(`reset eng roster too small: ${eng?.seatIds?.join(",")}`);
}

test("composer chips and click message opens seat inspector", async ({ page, request }) => {
  await resetApi(request);
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

  await page.getByTestId("message-who-m2").click();
  await expect(page.getByTestId("seat-inspector")).toContainText("Channel");
  await page.getByTestId("message-who-m3").click();
  await expect(page.getByTestId("seat-inspector")).toContainText("Product");
});

test("org chart connectors meet seats", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toBeVisible();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
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
  await expect(mayaLine).toHaveCount(1, { timeout: 10_000 });

  await page.getByTestId("seat-build").first().click({ force: true });
  await expect(page.getByTestId("seat-inspector")).toContainText("Eng.Build");
  await page.getByTestId("attach-harness").click();
  await expect(page.getByTestId("mode-harness")).toHaveClass(/on/);
});

test("org chart cards do not overlap and canvas pans without a seat", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await expect(page.getByTestId("org-team-eng").first()).toBeVisible();
  await expect(page.getByTestId("seat-qa")).toBeVisible();

  const overlap = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".tree-card")].map((el) => el.getBoundingClientRect());
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i];
        const b = cards[j];
        const hit = a.left < b.right - 4 && a.right > b.left + 4 && a.top < b.bottom - 4 && a.bottom > b.top + 4;
        if (hit) return { i, j, a: { x: a.x, y: a.y, w: a.width, h: a.height }, b: { x: b.x, y: b.y, w: b.width, h: b.height } };
      }
    }
    return null;
  });
  expect(overlap).toBeNull();

  const lineHitsQa = await page.evaluate(() => {
    const qa = document.querySelector("[data-testid=seat-qa]")?.getBoundingClientRect();
    const path = document.querySelector('[data-testid=org-line][data-child="team:eng"], [data-testid=org-line][data-child="eng-supervisor"]') as SVGPathElement | null;
    if (!qa || !path) return false;
    const len = path.getTotalLength();
    for (let i = 0; i <= 20; i++) {
      const p = path.getPointAtLength((len * i) / 20);
      const svg = path.ownerSVGElement;
      if (!svg) return false;
      const pt = svg.createSVGPoint();
      pt.x = p.x;
      pt.y = p.y;
      const ctm = path.getScreenCTM();
      if (!ctm) return false;
      const screen = pt.matrixTransform(ctm);
      if (screen.x > qa.left + 6 && screen.x < qa.right - 6 && screen.y > qa.top + 6 && screen.y < qa.bottom - 6) {
        return true;
      }
    }
    return false;
  });
  expect(lineHitsQa).toBeFalsy();

  const you = await page.getByTestId("seat-you").boundingBox();
  const panFrom = await page.evaluate(() => {
    const chart = document.querySelector("[data-testid=org-chart]")?.getBoundingClientRect();
    if (!chart) return null;
    const cards = [...document.querySelectorAll(".tree-card")].map((el) => el.getBoundingClientRect());
    const spots = [
      [chart.left + 12, chart.bottom - 12],
      [chart.right - 12, chart.bottom - 12],
      [chart.left + 12, chart.top + 12],
      [chart.right - 12, chart.top + 12],
    ];
    for (const [x, y] of spots) {
      const hit = cards.some((c) => x >= c.left && x <= c.right && y >= c.top && y <= c.bottom);
      if (!hit) return { x, y };
    }
    return { x: chart.left + 8, y: chart.bottom - 8 };
  });
  expect(you && panFrom).toBeTruthy();
  if (!you || !panFrom) return;
  await page.mouse.move(panFrom.x, panFrom.y);
  await page.mouse.down();
  await page.mouse.move(panFrom.x + 90, panFrom.y + 40, { steps: 8 });
  await page.mouse.up();
  const moved = await page.getByTestId("seat-you").boundingBox();
  expect(moved).toBeTruthy();
  if (moved) expect(Math.abs(moved.x - you.x) + Math.abs(moved.y - you.y)).toBeGreaterThan(40);
  await page.waitForTimeout(700);
  const stayed = await page.getByTestId("seat-you").boundingBox();
  expect(stayed).toBeTruthy();
  if (moved && stayed) {
    expect(Math.abs(stayed.x - moved.x) + Math.abs(stayed.y - moved.y)).toBeLessThan(8);
  }

  const beforeZoom = await page.getByTestId("org-chart").getAttribute("data-zoom");
  await page.getByTestId("org-chart").hover();
  await page.mouse.wheel(0, -480);
  await expect.poll(async () => page.getByTestId("org-chart").getAttribute("data-zoom")).not.toBe(beforeZoom);
  const zoomed = await page.getByTestId("org-chart").getAttribute("data-zoom");
  await page.waitForTimeout(700);
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-zoom", zoomed || "");
});

test("chart nodes collapse from the handle and reset expands them", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await expect(page.getByTestId("seat-maya")).toBeVisible();
  await expect(page.getByTestId("org-project-billing")).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("roster-flow.chart-collapsed"));
  await page.getByTestId("reset-chart-layout").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  const mayaHandle = page.getByTestId("tree-collapse-maya");
  await expect(mayaHandle).toBeVisible();
  await expect(mayaHandle).toHaveAttribute("aria-expanded", "true");
  // Fitted zoom shrinks SVG foreignObject controls; click via the DOM node.
  await mayaHandle.evaluate((el) => (el as HTMLButtonElement).click());
  await expect(mayaHandle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("org-project-billing")).toHaveCount(0);
  await page.getByTestId("reset-chart-layout").click();
  await expect(page.getByTestId("org-project-billing")).toBeVisible();
});

test("org chart connectors survive narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toBeVisible();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  expect(await page.getByTestId("org-line").count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("seat-you")).toBeVisible();
});

test("family mcp-flow is not up when the ping is Roster HTML", async ({ page }) => {
  await page.goto("/app/settings");
  await page.getByTestId("settings-nav-family").click();
  await expect(page.getByTestId("settings-family")).toBeVisible();
  const status = page.getByTestId("family-mcp-status");
  await expect(status).toBeVisible();
  await expect(status).not.toContainText(" · up ·");
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
  const res = await request.get("http://127.0.0.1:8790/api/v1/providers");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.some((p: { id: string }) => p.id === "demo-llm")).toBeTruthy();
});

test("team inspector shows seat count and hire specialist", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("team-eng").click();
  await expect(page.getByTestId("conversation-title")).toContainText("eng");
  await expect(page.getByTestId("team-inspector")).toHaveCount(0);
  await page.getByTestId("conversation-title").click();
  await expect(page.getByTestId("conversation-modal")).toBeVisible();
  await expect(page.getByTestId("team-inspector")).toBeVisible();
  await expect(page.getByTestId("team-seat-count")).toBeVisible();
  const count = Number(await page.getByTestId("team-seat-count").innerText());
  expect(count).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId("team-models")).toContainText("featherless/deepseek-ai/DeepSeek-V4.1-Flash");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("conversation-modal")).toHaveCount(0);

  await page.getByTestId("create-team").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await expect(page.getByTestId("create-team-form")).toBeVisible();
  await page.getByTestId("team-name").fill("platform");
  await page.getByTestId("team-create-submit").click();
  await expect(page.getByTestId("create-modal")).toHaveCount(0);
  await expect(page.getByTestId("mode-chart")).toHaveClass(/on/);
  await expect(page.getByTestId("team-platform")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("team-platform").click();
  await page.getByTestId("conversation-title").click();
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

test("project team roster update room and inspector rules", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect(page.getByTestId("seat-inspector")).toHaveCount(0);

  await page.getByTestId("project-billing").click();
  await expect(page.getByTestId("conversation-title")).toContainText("Billing");
  await expect(page.getByTestId("room-tab-messages")).toHaveClass(/on/);
  await expect(page.getByTestId("room-tab-canvas")).toHaveCount(0);
  await expect(page.getByTestId("seat-inspector")).toHaveCount(0);
  await page.getByTestId("room-tab-files").click();
  await expect(page.getByTestId("conversation-files")).toBeVisible();
  await page.getByTestId("room-tab-messages").click();

  await page.getByTestId("conversation-title").click();
  await expect(page.getByTestId("conversation-modal")).toBeVisible();
  await expect(page.getByTestId("project-inspector")).toBeVisible();
  await expect(page.getByTestId("project-goal")).toContainText(/billing train|ship-train/i);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("conversation-modal")).toHaveCount(0);

  await page.getByTestId("roster-maya").click();
  await expect(page.getByTestId("conversation-title")).toContainText("Maya");
  await expect(page.getByTestId("seat-inspector")).toContainText("Maya");

  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("seat-inspector")).toBeVisible();
  await page.getByTestId("seat-inspector").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("seat-inspector")).toHaveCount(0);
});

test("mention picker inserts @channel", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("composer-mention").click();
  await page.getByTestId("picker-item-channel").click();
  await expect(page.getByTestId("composer")).toHaveValue(/@channel/);
});

test("channel members can add and remove a team", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await page.getByTestId("conversation-title").click();
  await expect(page.getByTestId("conversation-modal")).toBeVisible();
  await expect(page.getByTestId("channel-editor")).toBeVisible();
  await page.getByTestId("channel-team-eng").click();
  await expect(page.getByTestId("channel-team-eng")).toHaveClass(/on/);
});

test("org chart shows team clusters", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await expect(page.getByTestId("org-team-eng").first()).toBeVisible();
  await page.getByTestId("org-team-head-eng").first().click({ force: true });
  await expect(page.getByTestId("org-team-head-eng").first()).toHaveClass(/on/);
  await expect(page.getByTestId("team-inspector")).toHaveCount(0);
  await expect(page.getByTestId("seat-inspector")).toBeVisible();
});

test("project nodes exist and can be created by hand", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await expect(page.getByTestId("org-project-billing")).toBeVisible();
  await expect(page.getByTestId("project-billing")).toBeVisible();

  await page.getByTestId("create-project").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await expect(page.getByTestId("create-project-form")).toBeVisible();
  await page.getByTestId("project-name").fill("mobile");
  await page.getByTestId("project-brief").fill("Second product");
  await page.getByTestId("project-create-submit").click();

  await expect(page.getByTestId("create-modal")).toHaveCount(0);
  await expect(page.getByTestId("mode-chart")).toHaveClass(/on/);
  await expect(page.getByTestId("org-project-mobile")).toBeVisible();
  await expect(page.getByTestId("project-mobile")).toBeVisible();
  await expect(page.getByTestId("create-project-form")).toHaveCount(0);
});

test("architect staffs a project and can fire from a plan", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-project-billing")).toBeVisible();
  await expect(page.getByTestId("architect-dock")).toBeVisible();
  await page.getByTestId("architect-chip-project").click();
  await expect(page.getByTestId("architect-plan")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("architect-apply").click();
  await expect(page.getByTestId("org-project-mobile")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("seat-mobile-pm")).toBeVisible();

  await page.getByTestId("architect-chip-layoff").click();
  await expect(page.getByTestId("architect-plan").last()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("architect-apply").last().click();
  await expect(page.getByTestId("seat-scout")).toHaveCount(0, { timeout: 10_000 });
});

test("architect full org replaces the company", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("architect-dock")).toBeVisible();
  await page.getByTestId("architect-chip-org").click();
  await expect(page.getByTestId("architect-plan").last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("architect-source").last()).toHaveText("template");
  await expect(page.getByTestId("architect-plan").last()).toContainText("replace org");
  await page.getByTestId("architect-apply").click();
  await expect(page.getByTestId("org-project-billing")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("seat-you")).toBeVisible();
  await expect(page.getByTestId("seat-maya")).toBeVisible();
  await expect(page.getByTestId("org-team-eng")).toBeVisible();
});

test("workspace search modal opens and jumps to a room", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect(page.getByTestId("search-projects")).toBeVisible();
  await expect(page.getByTestId("search-teams")).toBeVisible();
  await expect(page.getByTestId("search-seats")).toBeVisible();
  await page.getByTestId("conversation-search").click();
  await expect(page.getByTestId("search-modal")).toBeVisible();
  await expect(page.getByTestId("search-scope-current")).toContainText("Search in #ship");
  await page.getByTestId("search-modal-input").fill("incidents");
  await expect(page.getByTestId("search-result-room-incidents")).toBeVisible();
  await page.getByTestId("search-result-room-incidents").click();
  await expect(page.getByTestId("search-modal")).toHaveCount(0);
  await expect(page.getByTestId("channel-incidents")).toHaveClass(/on/);
  await expect(page.getByTestId("conversation-title")).toContainText("#incidents");

  await page.getByTestId("workspace-search").click();
  await expect(page.getByTestId("search-modal")).toBeVisible();
  await page.getByTestId("search-modal-input").fill("Flaky 500");
  await expect(page.getByTestId("search-result-message-m4")).toBeVisible();
  await page.getByTestId("search-result-message-m4").click();
  await expect(page.getByTestId("message-m4")).toBeVisible();
});

test("related pages still render chart/room", async ({ page }) => {
  await page.goto("/org");
  await expect(page.getByRole("heading", { name: /org chart is the control plane/i })).toBeVisible();
  await expect(page.getByTestId("org-chart")).toBeVisible();
  await expect(page.getByText(/yaml export is not shipped/i)).toBeVisible();
  await expect(page.getByText("multi-team.yaml")).toHaveCount(0);
  await page.goto("/product");
  await expect(page.getByRole("heading", { name: /the room, the org, the harness/i })).toBeVisible();
  await expect(page.getByTestId("clone-note")).toContainText("git checkout DEVELOPMENT");
  await expect(page.getByTestId("clone-note")).not.toContainText("default is CORE");
  await expect(page.getByText(/huddles/i)).toHaveCount(0);
  await page.goto("/orchestration");
  await expect(page.getByText("send_message")).toBeVisible();
  await expect(page.getByText("share_memory")).toHaveCount(0);
  await expect(page.getByText("roster_task_claim")).toBeVisible();
  await expect(page.getByText("depend_on")).toBeVisible();
});

test("footer discussions link and changelog has no fake office hours", async ({ page }) => {
  await page.goto("/");
  const link = page.getByTestId("community-discussions");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://github.com/real-limitless/Roster-Flow/discussions");
  await page.screenshot({ path: "/tmp/walkthrough/community-footer.png", fullPage: true });
  await page.goto("/changelog");
  await expect(page.getByTestId("office-hours-empty")).toContainText("None scheduled");
  await page.screenshot({ path: "/tmp/walkthrough/changelog-community.png", fullPage: true });
});

test("pause pip and blocked attach", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await page.getByTestId("seat-build").first().click({ force: true });
  await expect(page.getByTestId("seat-inspector")).toContainText("Eng.Build");
  await page.getByTestId("pause-seat").click();
  await expect(page.getByTestId("seat-status")).toHaveText("paused");
  await expect(page.getByTestId("pip-build").first()).toHaveClass(/paused/);
  await expect(page.getByTestId("seat-build").first()).toHaveAttribute("data-paused", "1");
  await page.getByTestId("attach-harness").click();
  await expect(page.getByTestId("mode-chart")).toHaveClass(/on/);
  await expect(page.getByTestId("mode-harness")).not.toHaveClass(/on/);
  const attach = await request.post("http://127.0.0.1:8790/api/v1/seats/build/attach", { data: {} });
  expect((await attach.json() as { paused?: boolean }).paused).toBeTruthy();
});

test("inbox mark-read clears unread on Chart", async ({ page, request }) => {
  await resetApi(request);
  await request.post("http://127.0.0.1:8790/api/v1/bus/send", {
    data: { from: "product", to: "build", kind: "send_message", text: "inbox ping for playwright", wake: false },
  });
  await page.goto("/app");
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await expect(page.getByTestId("inbox-count-build").first()).toBeVisible();
  await page.getByTestId("seat-build").first().click({ force: true });
  await expect(page.getByTestId("seat-inbox")).toContainText("inbox ping for playwright");
  await page.getByTestId("inbox-mark-read").click();
  await expect(page.getByTestId("seat-inbox")).toContainText("Caught up");
  await expect(page.getByTestId("inbox-count-build")).toHaveCount(0);
});

test("settings account pane documents owner:reset", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app/settings");
  await page.getByTestId("settings-nav-account").click();
  await expect(page.getByTestId("settings-account")).toBeVisible();
  await expect(page.getByTestId("account-recover")).toContainText("npm run owner:reset");
  await page.screenshot({ path: "/tmp/walkthrough/settings-account-demo.png", fullPage: true });
});

test("org hire copy names tokenBudget", async ({ page }) => {
  await page.goto("/org");
  await expect(page.getByTestId("org-hire-copy")).toContainText("tokenBudget");
});

test("seat tokenBudget pause is distinct from idle", async ({ page, request }) => {
  await resetApi(request);
  const hired = await request.post("http://127.0.0.1:8790/api/v1/seats", {
    data: { name: "Budget.Bot", team: "eng", tokenBudget: 1000, job: "Metered specialist." },
  });
  expect(hired.ok()).toBeTruthy();
  const seat = (await hired.json()) as { id: string; tokenBudget?: number; spent?: number };
  expect(seat.id).toBe("budget-bot");
  expect(seat.tokenBudget).toBe(1000);
  const patched = await request.patch("http://127.0.0.1:8790/api/v1/seats/budget-bot", { data: { spent: 1000 } });
  const after = (await patched.json()) as { status?: string; pauseReason?: string; spent?: number };
  expect(after.status).toBe("paused");
  expect(after.pauseReason).toBe("budget");
  expect(after.spent).toBe(1000);
  const attach = await request.post("http://127.0.0.1:8790/api/v1/seats/budget-bot/attach", { data: {} });
  const attachBody = (await attach.json()) as { paused?: boolean; reason?: string };
  expect(attachBody.paused).toBeTruthy();
  expect(attachBody.reason).toBe("budget");
  const bus = await request.post("http://127.0.0.1:8790/api/v1/bus/send", {
    data: { from: "you", to: "budget-bot", text: "should not wake", wake: true },
  });
  expect(bus.ok()).toBeTruthy();
  const listed = await request.get("http://127.0.0.1:8790/api/v1/seats");
  const seats = (await listed.json()) as Array<{ id: string; status?: string; pauseReason?: string }>;
  expect(seats.find((s) => s.id === "budget-bot")?.pauseReason).toBe("budget");

  await page.goto("/app");
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await page.getByTestId("seat-budget-bot").first().click({ force: true });
  await expect(page.getByTestId("seat-inspector")).toContainText("Budget.Bot");
  await expect(page.getByTestId("seat-status")).toHaveText("paused");
  await expect(page.getByTestId("seat-budget-remaining")).toContainText("0 / 1000");
  await expect(page.getByTestId("budget-paused-note")).toBeVisible();
  await expect(page.getByTestId("seat-budget-bot").first()).toHaveAttribute("data-budget-paused", "1");
  await expect(page.getByTestId("pip-budget-bot").first()).toHaveClass(/budget/);
  await page.getByTestId("mode-room").click();
  await expect(page.getByTestId("budget-banner")).toBeVisible();
  await expect(page.getByTestId("budget-banner-budget-bot")).toContainText("tokenBudget exhausted");
});

test("settings usage filters and pricing is honest about the meter", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app/settings?pane=usage");
  await expect(page.getByTestId("settings-usage")).toBeVisible();
  await expect(page.getByTestId("usage-empty")).toContainText(/unmetered|harness-offline|No meter events/i);
  await request.post("http://127.0.0.1:8790/api/v1/usage", {
    data: { seatId: "channel", inputTokens: 120, outputTokens: 40, source: "wake" },
  });
  await request.post("http://127.0.0.1:8790/api/v1/usage", {
    data: { seatId: "build", inputTokens: 300, outputTokens: 80, runId: "ship-train" },
  });
  await page.goto("/app/settings?pane=usage");
  await expect(page.getByTestId("usage-seat-channel")).toBeVisible();
  await expect(page.getByTestId("usage-seat-build")).toBeVisible();
  await expect(page.getByTestId("settings-usage")).not.toContainText("sk-");
  await expect(page.getByTestId("usage-key-leak")).toHaveCount(0);
  await page.getByTestId("usage-filter-project").selectOption("billing");
  await expect(page.getByTestId("usage-seat-build")).toBeVisible();
  await expect(page.getByTestId("usage-seat-channel")).toHaveCount(0);
  await page.getByTestId("usage-filter-project").selectOption("");
  await page.getByTestId("usage-filter-team").selectOption("eng");
  await expect(page.getByTestId("usage-seat-build")).toBeVisible();
  await expect(page.getByTestId("usage-seat-channel")).toHaveCount(0);
  const csv = await request.get("http://127.0.0.1:8790/api/v1/usage?format=csv");
  const text = await csv.text();
  expect(text).toMatch(/seatId/);
  expect(text).not.toMatch(/apiKey|sk-/);

  await page.goto("/app");
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("usage-chip")).toContainText(/tok/);

  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: /tokens on the meter/i })).toBeVisible();
  await expect(page.getByText(/not a billed bot-hour product/i)).toBeVisible();
  await expect(page.getByText("Shared bot-hours")).toHaveCount(0);
});

test("heartbeat wakes unread inbox and inspector disables it", async ({ page, request }) => {
  await resetApi(request);
  await request.patch("http://127.0.0.1:8790/api/v1/seats/product", { data: { heartbeatMinutes: 15 } });
  await request.post("http://127.0.0.1:8790/api/v1/bus/send", {
    data: { from: "you", to: "product", text: "heartbeat please", wake: false },
  });
  const tick = await request.post("http://127.0.0.1:8790/api/v1/heartbeats/tick", { data: {} });
  const body = (await tick.json()) as { due?: Array<{ seatId?: string; coalesced?: boolean }> };
  expect(body.due?.some((d) => d.seatId === "product")).toBeTruthy();
  await request.patch("http://127.0.0.1:8790/api/v1/seats/devops", { data: { heartbeatMinutes: 5 } });
  await request.post("http://127.0.0.1:8790/api/v1/bus/send", {
    data: { from: "you", to: "devops", text: "deploy ping", wake: false },
  });
  const deployTick = await request.post("http://127.0.0.1:8790/api/v1/heartbeats/tick", { data: {} });
  const deployBody = (await deployTick.json()) as { due?: Array<{ seatId?: string }> };
  expect(deployBody.due?.some((d) => d.seatId === "devops")).toBeFalsy();

  await page.goto("/app");
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await expect(page.getByTestId("seat-product").first()).toHaveAttribute("data-heartbeat", "1");
  await page.getByTestId("roster-product").click();
  await expect(page.getByTestId("seat-inspector")).toContainText("Product");
  await expect(page.getByTestId("disable-heartbeat")).toBeVisible();
  await page.getByTestId("disable-heartbeat").click();
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await expect(page.getByTestId("seat-product").first()).toHaveAttribute("data-heartbeat", "0");
});

test("access form persists on CORE and Settings lists it", async ({ page, request }) => {
  await resetApi(request);
  const email = `playwright-${Date.now()}@example.com`;
  await page.goto("/access");
  await page.getByLabel("Name").fill("Playwright Visitor");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Company").fill("Helix");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByTestId("access-success")).toBeVisible();
  const listed = await request.get("http://127.0.0.1:8790/api/v1/access");
  expect(listed.ok()).toBeTruthy();
  const body = (await listed.json()) as { requests: Array<{ email: string; company: string }> };
  expect(body.requests.some((row) => row.email === email && row.company === "Helix")).toBeTruthy();
  await page.goto("/app/settings");
  await page.getByTestId("settings-nav-access").click();
  await expect(page.getByTestId("settings-access")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
});

test("settings routine test-run posts bus mail", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app/settings");
  await page.getByTestId("settings-nav-routines").click();
  await expect(page.getByTestId("settings-routines")).toBeVisible();
  await page.getByTestId("routine-title").fill("Playwright ping");
  await page.getByTestId("routine-seat").selectOption("product");
  await page.getByTestId("routine-prompt").fill("Check the ship train.");
  await page.getByTestId("routine-create-submit").click();
  const card = page.locator('[data-testid^="routine-card-"]').first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Test run" }).click();
  await expect.poll(async () => {
    const res = await request.get("http://127.0.0.1:8790/api/v1/bus");
    const bus = (await res.json()) as Array<{ from?: string; to?: string; text?: string }>;
    return bus.some((e) => e.from === "routine" && e.to === "product" && /ship train/i.test(e.text || ""));
  }).toBeTruthy();
});

test("project knowledge connector search is scoped and disconnects", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await page.getByTestId("project-billing").click();
  await page.getByTestId("conversation-title").click();
  await expect(page.getByTestId("project-inspector")).toBeVisible();
  await page.getByTestId("knowledge-kind").selectOption("docs");
  await page.getByTestId("knowledge-path").fill("docs");
  await page.getByTestId("knowledge-attach").click();
  await expect(page.locator('[data-testid^="knowledge-conn-"]').first()).toBeVisible();
  await page.getByTestId("knowledge-query").fill("constitution");
  await page.getByTestId("knowledge-search").click();
  await expect(page.getByTestId("knowledge-hit").first()).toBeVisible();
  await expect(page.getByTestId("knowledge-source")).toContainText("core");
  await page.screenshot({ path: "/tmp/walkthrough/project-knowledge.png", fullPage: true });

  const forbidden = await request.get(
    "http://127.0.0.1:8790/api/v1/projects/billing/knowledge?q=constitution&seatId=scout",
  );
  expect(forbidden.status()).toBe(403);

  await page.locator('[data-testid^="knowledge-disconnect-"]').first().click();
  await expect(page.locator('[data-testid^="knowledge-conn-"]')).toHaveCount(0);

  await page.goto("/security");
  await expect(page.getByText(/not used for training/i).first()).toBeVisible();
  await page.screenshot({ path: "/tmp/walkthrough/security-knowledge.png", fullPage: true });
});

test("github PR report card in #ship is human-gated and goes stale", async ({ page, request }) => {
  const mock = await startGithubMock(8798);
  try {
    await resetApi(request);
    const report = await request.post("http://127.0.0.1:8790/api/v1/bus/send", {
      data: {
        from: "build",
        to: "channel:ship",
        kind: "report",
        channel: "ship",
        wake: false,
        text: "PR ready https://github.com/real-limitless/Roster-Flow/pull/42",
        prUrl: "https://github.com/real-limitless/Roster-Flow/pull/42",
        branch: "eng/webhook-idempotency",
      },
    });
    expect(report.ok()).toBeTruthy();
    const posted = (await report.json()) as { id?: string };
    const messagesRes = await request.get("http://127.0.0.1:8790/api/v1/channels/ship/messages");
    const messages = (await messagesRes.json()) as Array<{
      id: string;
      github?: { title?: string; stale?: boolean; url?: string };
    }>;
    const cardMsg = messages.find((m) => m.github?.title);
    expect(cardMsg?.github?.title).toContain("Idempotent");
    expect(cardMsg?.github?.stale).toBeFalsy();
    expect(JSON.stringify(cardMsg)).not.toMatch(/e2e-github-token|ghs_|ghp_/i);

    const jules = await request.post("http://127.0.0.1:8790/api/v1/block-actions", {
      data: { messageId: cardMsg?.id, actionId: "github.merge", userId: "jules" },
    });
    expect(jules.status()).toBe(403);

    await page.goto("/app");
    const card = page.locator('[data-testid^="github-card-"]').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Idempotent Stripe webhooks");
    await expect(card.getByTestId("github-checks-" + cardMsg!.id)).toContainText("checks");
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId("github-merge")).toBeVisible();
    await page.screenshot({ path: "/tmp/walkthrough/room-github-pr-card.png", fullPage: true });

    await card.getByTestId("github-merge").click();
    await expect(card).toHaveAttribute("data-state", "merged", { timeout: 10_000 });

    const busRes = await request.get("http://127.0.0.1:8790/api/v1/bus");
    const bus = (await busRes.json()) as Array<{ kind?: string; from?: string }>;
    expect(bus.some((e) => e.kind === "github_merge" && e.from === "you")).toBeTruthy();

    await mock.close();
    await card.getByTestId("github-refresh").click();
    await expect(card).toHaveAttribute("data-stale", "1", { timeout: 10_000 });
    await card.scrollIntoViewIfNeeded();
    await expect(page.getByTestId(`github-link-${cardMsg!.id}`)).toHaveAttribute(
      "href",
      "https://github.com/real-limitless/Roster-Flow/pull/42",
    );
    await page.screenshot({ path: "/tmp/walkthrough/room-github-stale.png", fullPage: true });

    await page.goto("/app/settings");
    await page.getByTestId("settings-nav-family").click();
    await expect(page.getByTestId("family-card-github")).toBeVisible();
    await expect(page.getByTestId("family-github-status")).toContainText("token stays in env");
    await page.screenshot({ path: "/tmp/walkthrough/family-github.png", fullPage: true });

    await page.goto("/app");
    await expect(page.getByTestId("composer")).toBeVisible();
    await page.getByTestId("composer").fill("room still works after stale github");
    await page.getByTestId("send-message").click();
    await expect(page.getByText("room still works after stale github").first()).toBeVisible();
    expect(posted.id).toBeTruthy();
  } finally {
    await mock.close().catch(() => undefined);
  }
});

async function startGithubMock(port: number) {
  const { createServer } = await import("node:http");
  let merged = false;
  const server = createServer((req, res) => {
    const url = req.url || "";
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "PUT" && /\/pulls\/42\/merge/.test(url)) {
      merged = true;
      send(200, { merged: true, sha: "abc123" });
      return;
    }
    if (/\/pulls\/42$/.test(url)) {
      send(200, {
        html_url: "https://github.com/real-limitless/Roster-Flow/pull/42",
        title: "Idempotent Stripe webhooks",
        state: merged ? "closed" : "open",
        merged,
        draft: false,
        mergeable: true,
        head: { ref: "eng/webhook-idempotency", sha: "abc123" },
        base: { ref: "main" },
      });
      return;
    }
    if (url.includes("/check-runs")) {
      send(200, {
        total_count: 2,
        check_runs: [
          { name: "ci", status: "completed", conclusion: "success" },
          { name: "lint", status: "completed", conclusion: "success" },
        ],
      });
      return;
    }
    send(404, { message: "not found" });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

test("webhook adapter wake and report land in #ship", async ({ page, request }) => {
  mkdirSync("/tmp/walkthrough", { recursive: true });
  await resetApi(request);

  const wakes: unknown[] = [];
  const mock = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      try {
        wakes.push(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        wakes.push({});
      }
      res.writeHead(202, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", () => resolve()));
  const addr = mock.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const wakeUrl = `http://127.0.0.1:${port}/wake`;

  try {
    await page.goto("/app");
    await page.getByTestId("hire-seat").click();
    await expect(page.getByTestId("hire-form")).toBeVisible();
    await page.getByTestId("hire-name").fill("Hook Bot");
    await page.getByTestId("hire-adapter").selectOption("webhook");
    await page.getByTestId("hire-adapter-url").fill(wakeUrl);
    await page.getByTestId("hire-submit").click();
    await expect(page.getByTestId("seat-adapter")).toContainText("webhook");
    await expect(page.getByTestId("adapter-note")).toBeVisible();
    await expect(page.getByTestId("attach-harness")).toHaveCount(0);

    await page.getByTestId("mode-chart").click();
    await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
    await expect(page.getByTestId("seat-hook-bot")).toHaveAttribute("data-adapter", "webhook");
    await expect(page.getByTestId("seat-hook-bot")).toContainText("webhook");
    await page.screenshot({ path: "/tmp/walkthrough/chart-webhook-adapter.png" });

    const sent = await request.post("http://127.0.0.1:8790/api/v1/bus/send", {
      data: { from: "you", to: "hook-bot", kind: "send_message", text: "please report the ship", wake: true },
    });
    expect(sent.ok()).toBeTruthy();
    await expect.poll(() => wakes.length).toBeGreaterThan(0);

    const reported = await request.post("http://127.0.0.1:8790/api/v1/seats/hook-bot/adapter/report", {
      data: { text: "webhook report: shipped" },
    });
    expect(reported.ok()).toBeTruthy();

    await page.goto("/app");
    const report = page.getByText("webhook report: shipped").first();
    await expect(report).toBeVisible();
    await report.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/walkthrough/room-webhook-report.png" });
  } finally {
    await new Promise<void>((resolve) => mock.close(() => resolve()));
  }
});

test("mcp guest posts onto the bus and appears on the chart", async ({ page, request }) => {
  mkdirSync("/tmp/walkthrough", { recursive: true });
  await resetApi(request);
  const init = await request.post("http://127.0.0.1:8790/mcp", {
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", clientInfo: { name: "playwright" } },
    },
  });
  expect(init.ok()).toBeTruthy();
  const initBody = (await init.json()) as { result?: { serverInfo?: { name?: string } } };
  expect(initBody.result?.serverInfo?.name).toBe("roster-flow");
  expect(init.headers()["mcp-session-id"]).toBeTruthy();

  const listed = await request.post("http://127.0.0.1:8790/mcp", {
    data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
  });
  const listedBody = (await listed.json()) as { result?: { tools?: Array<{ name: string }> } };
  const names = (listedBody.result?.tools || []).map((t) => t.name);
  expect(names).toContain("roster_send_message");
  expect(names).toContain("roster_inbox");

  const sent = await request.post("http://127.0.0.1:8790/mcp", {
    data: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "roster_send_message",
        arguments: { to: "channel:ship", text: "hello from MCP guest" },
      },
    },
  });
  expect(sent.ok()).toBeTruthy();
  const bus = await request.get("http://127.0.0.1:8790/api/v1/bus");
  const entries = (await bus.json()) as Array<{ from?: string; text?: string }>;
  expect(entries.some((e) => e.from === "mcp-guest" && /hello from MCP guest/.test(e.text || ""))).toBeTruthy();

  await page.goto("/app");
  await expect(page.getByText("hello from MCP guest").first()).toBeVisible();
  await page.screenshot({ path: "/tmp/walkthrough/room-mcp-guest.png" });
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await expect(page.getByTestId("seat-mcp-guest")).toBeVisible();
  await expect(page.getByTestId("seat-mcp-guest")).toHaveAttribute("data-mcp-guest", "1");
  await expect(page.getByTestId("seat-mcp-guest")).toContainText("mcp");
  await page.getByTestId("seat-mcp-guest").first().click({ force: true });
  await expect(page.getByTestId("seat-inspector")).toContainText("MCP Guest");
  await expect(page.getByTestId("mcp-guest-note")).toBeVisible();
  await expect(page.getByTestId("attach-harness")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/walkthrough/chart-mcp-guest.png" });

  await page.goto("/app/settings");
  await page.getByTestId("settings-nav-family").click();
  await expect(page.getByTestId("roster-mcp-snippet")).toBeVisible();
  await expect(page.getByTestId("roster-mcp-url")).toContainText("127.0.0.1:8790/mcp");
  await page.getByTestId("roster-mcp-snippet").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/walkthrough/family-mcp-room.png" });
});

test("task claim lock and depend_on", async ({ page, request }) => {
  await resetApi(request);
  const blocked = await request.post("http://127.0.0.1:8790/api/v1/tasks/task-eng-implement/claim", {
    data: { seatId: "build" },
  });
  expect(blocked.status()).toBe(409);
  await request.post("http://127.0.0.1:8790/api/v1/tasks/task-product-brief/complete", { data: { seatId: "product" } });
  const first = await request.post("http://127.0.0.1:8790/api/v1/tasks/task-eng-implement/claim", {
    data: { seatId: "build" },
  });
  const second = await request.post("http://127.0.0.1:8790/api/v1/tasks/task-eng-implement/claim", {
    data: { seatId: "review" },
  });
  expect(first.ok()).toBeTruthy();
  expect(second.status()).toBe(409);
  await page.goto("/app");
  await expect(page.getByTestId("task-board")).toBeVisible();
  await expect(page.getByTestId("task-row-task-eng-implement")).toHaveAttribute("data-status", "claimed");
  await page.getByTestId("mode-chart").click();
  await expect(page.getByTestId("org-chart")).toHaveAttribute("data-fitted", "1");
  await expect(page.getByTestId("seat-build").first()).toHaveAttribute("data-claimed", "1");
});

test("slack inbound lands in #ship and ask_human confirm posts bus", async ({ page, request }) => {
  const posted: Array<{ url: string; body: Record<string, unknown> }> = [];
  const mock = await startSlackMock(8796, posted);
  try {
    await resetApi(request);
    const ev = await request.post("http://127.0.0.1:8790/api/v1/slack/events", {
      data: {
        type: "event_callback",
        event: {
          type: "message",
          channel: "C-SHIP",
          user: "U1",
          text: "please ask @eng to ship the webhook",
          ts: "1.1",
        },
      },
    });
    expect(ev.ok()).toBeTruthy();
    const body = (await ev.json()) as { ok?: boolean; room?: string };
    expect(body.ok).toBeTruthy();
    expect(body.room).toBe("ship");

    await page.goto("/app");
    await expect(page.getByText("please ask @eng to ship the webhook").first()).toBeVisible();
    await expect(page.locator('[data-testid^="chip-slack-"]').first()).toBeVisible();
    await page.screenshot({ path: "/tmp/walkthrough/room-slack-inbound.png", fullPage: true });

    const ask = await request.post("http://127.0.0.1:8790/api/v1/bus/send", {
      data: {
        from: "product",
        to: "you",
        kind: "ask_human",
        channel: "ship",
        text: "Confirm staging deploy?",
        wake: false,
      },
    });
    expect(ask.ok()).toBeTruthy();
    await expect.poll(() => posted.some((p) => String(p.url).includes("chat.postMessage"))).toBeTruthy();
    const slackBody = posted.find((p) => String(p.url).includes("chat.postMessage"))?.body as {
      blocks?: Array<{ type: string; elements?: Array<{ action_id?: string }> }>;
    };
    const actions = slackBody?.blocks?.find((b) => b.type === "actions")?.elements?.map((e) => e.action_id);
    expect(actions).toEqual(["slack.confirm", "slack.deny"]);

    const messages = (await (await request.get("http://127.0.0.1:8790/api/v1/channels/ship/messages")).json()) as Array<{
      id: string;
      text?: string;
    }>;
    const askMsg = messages.find((m) => /Confirm staging deploy/.test(m.text || ""));
    const action = await request.post("http://127.0.0.1:8790/api/v1/slack/actions", {
      data: { actions: [{ action_id: "slack.confirm", value: askMsg?.id }] },
    });
    expect(action.ok()).toBeTruthy();
    const bus = (await (await request.get("http://127.0.0.1:8790/api/v1/bus")).json()) as Array<{
      kind?: string;
      text?: string;
    }>;
    expect(bus.some((e) => e.kind === "block_actions" && /slack.confirm/.test(e.text || ""))).toBeTruthy();

    await page.goto("/app/settings");
    await page.getByTestId("settings-nav-family").click();
    await expect(page.getByTestId("family-card-slack")).toBeVisible();
    await expect(page.getByTestId("family-slack-status")).toContainText("token stays in env");
    await page.screenshot({ path: "/tmp/walkthrough/family-slack.png", fullPage: true });
  } finally {
    await mock.close().catch(() => undefined);
  }
});

async function startSlackMock(port: number, posted: Array<{ url: string; body: Record<string, unknown> }>) {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        body = {};
      }
      posted.push({ url: String(req.url || ""), body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ts: "2.2" }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
