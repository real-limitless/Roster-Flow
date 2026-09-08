import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.resolve(root, "docs/images");
const base = process.env.BASE_URL || "http://127.0.0.1:5173";
const setupPort = Number(process.env.CAPTURE_SETUP_PORT || 8798);

const hideScrollbars = `
  html, body { scrollbar-width: none !important; }
  *::-webkit-scrollbar { display: none !important; }
`;

const shots = [
  {
    file: "campaign-hero.png",
    url: "/",
    ready: (page) => page.getByRole("heading", { level: 1 }),
    prepare: async (page) => {
      await page.getByTestId("harness-xterm").waitFor({ state: "visible" }).catch(() => undefined);
      await page
        .waitForFunction(() => /ready/i.test(document.querySelector("[data-testid=harness-meta]")?.textContent || ""), {
          timeout: 20_000,
        })
        .catch(() => undefined);
      await page.waitForTimeout(4000);
    },
  },
  {
    file: "campaign-why.png",
    url: "/",
    ready: (page) => page.getByRole("heading", { name: /agents don’t work together/i }),
    prepare: async (page) => {
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll("h2")].find((h) => /don’t work together/i.test(h.textContent || ""));
        const section = heading?.closest(".section");
        if (section) {
          const y = section.getBoundingClientRect().top + window.scrollY - 8;
          window.scrollTo(0, Math.max(0, y));
        }
      });
    },
  },
  {
    file: "campaign-orchestration.png",
    url: "/orchestration",
    ready: (page) => page.getByRole("heading", { name: /bots talk to bots/i }),
  },
  {
    file: "chat-room.png",
    url: "/app",
    ready: (page) => page.getByTestId("workspace-shell"),
    prepare: async (page) => {
      await page.getByTestId("channel-ship").click();
      await page.getByTestId("blocks-m2").waitFor({ state: "visible" });
    },
  },
  {
    file: "chat-harness.png",
    url: "/harness",
    ready: (page) => page.getByTestId("harness-xterm"),
    prepare: async (page) => {
      await page.getByTestId("mock-mode-harness").click();
      await page.getByTestId("harness-xterm").waitFor({ state: "visible" });
      await page.getByTestId("harness-term").scrollIntoViewIfNeeded();
      await page
        .waitForFunction(() => /ready/i.test(document.querySelector("[data-testid=harness-meta]")?.textContent || ""), {
          timeout: 20_000,
        })
        .catch(() => undefined);
      await page.waitForTimeout(4000);
    },
  },
  {
    file: "chat-chart.png",
    url: "/app?mode=chart",
    ready: (page) => page.getByTestId("org-chart"),
    prepare: async (page) => {
      await page
        .waitForFunction(() => document.querySelector("[data-testid=org-chart]")?.getAttribute("data-fitted") === "1")
        .catch(() => undefined);
    },
  },
];

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: hideScrollbars });
  await page.waitForTimeout(400);
}

async function writeShot(page, file) {
  await settle(page);
  await page.waitForTimeout(250);
  const dest = path.join(outDir, file);
  await page.screenshot({ path: dest, type: "png", animations: "disabled" });
  console.log("wrote", dest);
}

async function waitForApi(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (res.ok) return;
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`onboarding capture API did not start on ${port}`);
}

async function routeToIsolatedApi(page, port) {
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const dest = `http://127.0.0.1:${port}${url.pathname}${url.search}`;
    const headers = {};
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

async function captureOnboarding(page) {
  const dir = mkdtempSync(path.join(tmpdir(), "roster-capture-"));
  const env = { ...process.env, ROSTER_API_PORT: String(setupPort), ROSTER_DATA_DIR: dir };
  delete env.ROSTER_SKIP_ONBOARDING;
  const child = spawn(process.execPath, ["server/index.mjs"], { cwd: root, env, stdio: "ignore" });

  try {
    await waitForApi(setupPort);
    await routeToIsolatedApi(page, setupPort);
    await page.addInitScript(() => localStorage.removeItem("roster-flow-token"));

    await page.goto(new URL("/setup", base).href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("setup-step-install").waitFor({ state: "visible", timeout: 30_000 });
    await writeShot(page, "setup-install.png");
    await page.getByTestId("setup-continue-install").click();

    await page.getByTestId("setup-step-first-user").waitFor({ state: "visible" });
    await page.getByTestId("setup-name").fill("Chen");
    await page.getByTestId("setup-email").fill("chen@example.com");
    await page.getByTestId("setup-password").fill("password1");
    await writeShot(page, "setup-owner.png");
    await page.getByTestId("setup-create-owner").click();

    await page.getByTestId("setup-step-login").waitFor({ state: "visible" });
    await page.getByTestId("setup-login-email").fill("chen@example.com");
    await page.getByTestId("setup-login-password").fill("password1");
    await writeShot(page, "setup-signin.png");
    await page.getByTestId("setup-login-submit").click();

    await page.getByTestId("setup-step-harness").waitFor({ state: "visible" });
    await writeShot(page, "setup-harness.png");
    await page.getByTestId("setup-skip-harness").click();

    await page.getByTestId("setup-step-welcome").waitFor({ state: "visible" });
    await page.getByTestId("setup-template-starter").click();
    await writeShot(page, "setup-welcome.png");

    await page.getByTestId("setup-enter-workspace").click();
    await page.getByTestId("workspace-shell").waitFor({ state: "visible", timeout: 30_000 });
    await page.evaluate(() => localStorage.removeItem("roster-flow-token"));
    await page.goto(new URL("/login", base).href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("login-page").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("setup-login-email").fill("chen@example.com");
    await page.getByTestId("setup-login-password").fill("password1");
    await writeShot(page, "login.png");
  } finally {
    await page.unroute("**/api/v1/**").catch(() => undefined);
    child.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});

await mkdir(outDir, { recursive: true });

for (const shot of shots) {
  await page.goto(new URL(shot.url, base).href, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await shot.ready(page).waitFor({ state: "visible", timeout: 30_000 });
  await settle(page);
  if (shot.prepare) await shot.prepare(page);
  await page.waitForTimeout(250);
  const dest = path.join(outDir, shot.file);
  await page.screenshot({ path: dest, type: "png", animations: "disabled" });
  console.log("wrote", dest);
}

await captureOnboarding(page);
await browser.close();
