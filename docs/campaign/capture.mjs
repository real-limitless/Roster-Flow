import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(root, "../images");
const base = process.env.BASE_URL || "http://127.0.0.1:5173";

const hideScrollbars = `
  html, body { scrollbar-width: none !important; }
  *::-webkit-scrollbar { display: none !important; }
`;

const shots = [
  {
    file: "campaign-hero.png",
    url: "/",
    ready: (page) => page.getByRole("heading", { level: 1 }),
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
    ready: (page) => page.getByRole("heading", { name: /room when you’re talking/i }),
    prepare: async (page) => {
      await page.getByTestId("mock-mode-harness").click();
      await page.getByText("opencode attach eng.build").waitFor({ state: "visible" });
    },
  },
  {
    file: "chat-chart.png",
    url: "/app?mode=chart",
    ready: (page) => page.getByTestId("org-chart"),
  },
];

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: hideScrollbars });
  await page.waitForTimeout(400);
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

await browser.close();
