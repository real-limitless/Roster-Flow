import { expect, test, type APIRequestContext } from "@playwright/test";
import { startFakeOpenCode } from "./fake-opencode";

const API = "http://127.0.0.1:8790";
const COMPANY_PORT = 14180;
const SYSTEM_PORT = 14181;

async function resetApi(request: APIRequestContext) {
  const res = await request.post(`${API}/api/v1/reset`);
  expect(res.ok()).toBeTruthy();
}

/** A connected provider the fake serve reports as loaded, so the seat's model plan is usable. */
async function useFakeModel(request: APIRequestContext, seatIds: string[]) {
  const put = await request.put(`${API}/api/v1/providers`, {
    data: { id: "e2efake", name: "E2E fake", baseURL: "http://127.0.0.1:9/v1", models: [{ id: "m1" }], apiKey: "e2e-key" },
  });
  expect(put.ok()).toBeTruthy();
  for (const id of seatIds) {
    const patched = await request.patch(`${API}/api/v1/seats/${id}`, { data: { model: "e2efake/m1" } });
    expect(patched.ok()).toBeTruthy();
  }
}

async function dropFakeModel(request: APIRequestContext) {
  await request.delete(`${API}/api/v1/providers/e2efake`);
}

type Msg = { id: string; channel: string; text: string; seatId?: string; system?: boolean };

test("Anyone here in #general gets a plain-text reply in #general from the fallback seat", async ({ page, request }) => {
  await resetApi(request);
  await useFakeModel(request, ["channel"]);
  const fake = await startFakeOpenCode({
    port: SYSTEM_PORT,
    providers: { e2efake: ["m1"] },
    reply: (p) => (p.text.includes("without mentioning anyone") ? "Yes, Channel here. What do you need?" : null),
  });
  try {
    await page.goto("/app");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("conversation-title")).toContainText("general");
    await page.getByTestId("composer").fill("Anyone here");
    await page.getByTestId("send-message").click();
    await expect(page.getByText("Yes, Channel here. What do you need?").first()).toBeVisible({ timeout: 20_000 });

    const general = (await (await request.get(`${API}/api/v1/channels/general/messages`)).json()) as Msg[];
    const reply = general.find((m) => m.text === "Yes, Channel here. What do you need?");
    expect(reply?.seatId).toBe("channel");
    const ship = (await (await request.get(`${API}/api/v1/channels/ship/messages`)).json()) as Msg[];
    expect(ship.some((m) => m.text === "Yes, Channel here. What do you need?")).toBeFalsy();

    expect(fake.prompts).toHaveLength(1);
    expect(fake.prompts[0].agent).toBe("channel");
    expect(fake.prompts[0].text).toContain("Roster-flow posts your text to #general");
  } finally {
    await fake.close();
    await dropFakeModel(request);
  }
});

test("a channel lead answers un-mentioned messages in its room", async ({ request }) => {
  await resetApi(request);
  await useFakeModel(request, ["build", "product"]);
  const bad = await request.patch(`${API}/api/v1/channels/ship`, { data: { leadSeatId: "maya" } });
  expect(bad.status()).toBe(400);
  const ok = await request.patch(`${API}/api/v1/channels/ship`, { data: { leadSeatId: "build" } });
  expect(ok.ok()).toBeTruthy();
  expect((await ok.json()).leadSeatId).toBe("build");
  const fake = await startFakeOpenCode({
    port: COMPANY_PORT,
    providers: { e2efake: ["m1"] },
    reply: (p) => (p.agent === "build" ? "Build here. Nothing blocked." : null),
  });
  try {
    const posted = await request.post(`${API}/api/v1/channels/ship/messages`, { data: { text: "status?" } });
    expect(posted.ok()).toBeTruthy();
    const body = await posted.json();
    expect(body.wakeResults[0]).toMatchObject({ seat: "build", started: true });
    await expect
      .poll(async () => {
        const ship = (await (await request.get(`${API}/api/v1/channels/ship/messages`)).json()) as Msg[];
        return ship.find((m) => m.text === "Build here. Nothing blocked.")?.seatId || null;
      }, { timeout: 20_000 })
      .toBe("build");
    expect(fake.prompts.map((p) => p.agent)).toEqual(["build"]);
  } finally {
    await fake.close();
    await dropFakeModel(request);
  }
});
