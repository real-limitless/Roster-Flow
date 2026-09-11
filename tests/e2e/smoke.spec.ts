import { expect, test, type Page } from "@playwright/test";

test("home renders Room / Harness / Chart story", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Staff an org of agents");
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
  await expect(page.getByTestId("team-models")).toContainText("xai/grok-4");
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
  await page.goto("/product");
  await expect(page.getByRole("heading", { name: /the room, the org, the harness/i })).toBeVisible();
  await page.goto("/orchestration");
  await expect(page.getByText("roster_task_claim")).toBeVisible();
  await expect(page.getByText("depend_on")).toBeVisible();
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
