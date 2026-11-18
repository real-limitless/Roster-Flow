import { expect, test } from "@playwright/test";

test("the page meta tag and /api/version report the same build SHA", async ({ page }) => {
  await page.goto("/");
  const sha = await page.locator('meta[name="roster-build"]').getAttribute("content");
  expect(sha).toBeTruthy();
  const res = await page.request.get("/api/version");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.sha).toBe(sha);
  expect(typeof body.builtAt).toBe("string");
  expect(typeof body.version).toBe("string");
  expect(Object.keys(body).sort()).toEqual(["builtAt", "sha", "version"]);
});
