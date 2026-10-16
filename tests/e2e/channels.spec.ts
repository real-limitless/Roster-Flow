import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
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

async function closeModal(page: Page) {
  const modal = page.getByTestId("conversation-modal");
  if (await modal.count()) await modal.click({ position: { x: 5, y: 5 } });
  await expect(modal).toHaveCount(0);
}

type Room = { id: string; leadSeatId: string | null; respond: string; responderSeatId: string | null; seatIds: string[]; limits?: Record<string, number> };

test("room settings set the lead and mode, and a quiet room only notifies people", async ({ page, request }) => {
  await resetApi(request);
  await page.goto("/app");
  await page.getByTestId("channel-ship").click();
  await expect(page.getByTestId("conversation-responder")).toHaveText("Replies: Product");
  await page.getByTestId("conversation-title").click();
  await expect(page.getByTestId("room-reply-settings")).toBeVisible();
  await page.getByTestId("room-lead").selectOption("build");
  await expect(page.getByTestId("room-responder")).toContainText("Eng.Build");
  await page.getByTestId("room-rate").fill("2");
  await page.getByTestId("room-rate").blur();
  await expect
    .poll(async () => ((await (await request.get(`${API}/api/v1/channels/ship`)).json()) as Room).limits?.implicitPerMinute)
    .toBe(2);
  await page.getByTestId("room-respond").selectOption("quiet");
  await expect(page.getByTestId("room-lead")).toHaveCount(0);
  await closeModal(page);
  await expect(page.getByTestId("conversation-responder")).toHaveText("Quiet");

  const ship = (await (await request.get(`${API}/api/v1/channels/ship`)).json()) as Room;
  expect(ship).toMatchObject({ leadSeatId: "build", respond: "quiet", responderSeatId: null });

  await page.getByTestId("composer").fill("fyi, deploy at five");
  await page.getByTestId("send-message").click();
  await expect(page.getByText("This room is quiet: un-mentioned messages wake nobody.").first()).toBeVisible({ timeout: 10_000 });
  const inbox = (await (await request.get(`${API}/api/v1/seats/maya/inbox`)).json()) as { items: Array<{ text?: string }> };
  expect(inbox.items.some((i) => i.text === "fyi, deploy at five")).toBeTruthy();
});

test("teams get a home room led by the supervisor, and seats list and leave their rooms", async ({ page, request }) => {
  await resetApi(request);
  const home = (await (await request.get(`${API}/api/v1/channels/team-eng`)).json()) as Room;
  expect(home).toMatchObject({ leadSeatId: "eng-supervisor", respond: "lead", responderSeatId: "eng-supervisor" });
  const rooms = (await (await request.get(`${API}/api/v1/seats/build/channels`)).json()) as Array<{ id: string; viaTeams: string[] }>;
  expect(rooms.map((r) => r.id).sort()).toEqual(["eng-agents", "incidents", "ship", "team-eng"]);
  expect(rooms.find((r) => r.id === "team-eng")?.viaTeams).toEqual(["eng"]);

  await page.goto("/app");
  await page.getByTestId("team-eng").click();
  await expect(page.getByTestId("conversation-responder")).toHaveText("Lead: Eng Supervisor");
  await page.getByTestId("conversation-title").click();
  await expect(page.getByTestId("team-home-room")).toContainText("Lead: Eng Supervisor");
  await expect(page.getByTestId("team-room-eng-agents")).toBeVisible();
  await closeModal(page);

  await page.getByTestId("channel-ship").click();
  await page.getByTestId("conversation-member-product").click();
  const inspector = page.getByTestId("seat-inspector");
  await expect(inspector.getByTestId("seat-room-ship")).toContainText("Answers");
  await inspector.getByTestId("seat-room-leave-ship").click();
  await expect(inspector.getByTestId("seat-room-ship")).toHaveCount(0);
  const ship = (await (await request.get(`${API}/api/v1/channels/ship`)).json()) as Room;
  expect(ship.seatIds).not.toContain("product");
  expect(ship.responderSeatId).toBe("devops");
});

test("a seat keeps one session per room, gets the room's new messages, and replies land in that room", async ({ request }) => {
  await resetApi(request);
  await useFakeModel(request, ["build"]);
  const fake = await startFakeOpenCode({
    port: COMPANY_PORT,
    providers: { e2efake: ["m1"] },
    reply: (p) => (p.agent === "build" ? `Build in ${p.title.split(":")[2] || "dm"}: ${fakeCount(p.title)}` : null),
  });
  const counts = new Map<string, number>();
  function fakeCount(title: string) {
    const n = (counts.get(title) || 0) + 1;
    counts.set(title, n);
    return n;
  }
  const replyIn = (room: string, text: string) =>
    expect
      .poll(async () => {
        const msgs = (await (await request.get(`${API}/api/v1/channels/${room}/messages`)).json()) as Msg[];
        return msgs.find((m) => m.text === text)?.seatId || null;
      }, { timeout: 20_000 })
      .toBe("build");
  try {
    expect((await request.patch(`${API}/api/v1/channels/ship`, { data: { respond: "quiet" } })).ok()).toBeTruthy();
    const say = (text: string) =>
      request.post(`${API}/api/v1/channels/ship/messages`, { data: { text, who: "Maya", seatId: "maya" } });
    expect((await say("webhook retries twice")).ok()).toBeTruthy();
    expect((await request.post(`${API}/api/v1/channels/ship/messages`, { data: { text: "@build can you fix the retries?" } })).ok()).toBeTruthy();
    await replyIn("ship", "Build in ship: 1");
    expect((await say("the logs show a 502 too")).ok()).toBeTruthy();
    expect((await request.post(`${API}/api/v1/channels/incidents/messages`, { data: { text: "@build is prod ok?" } })).ok()).toBeTruthy();
    await replyIn("incidents", "Build in incidents: 1");
    expect((await request.post(`${API}/api/v1/channels/ship/messages`, { data: { text: "@build any news?" } })).ok()).toBeTruthy();
    await replyIn("ship", "Build in ship: 2");

    const titles = [...fake.sessions.values()].map((s) => s.title).sort();
    expect(titles).toEqual(["roster:build:incidents", "roster:build:ship"]);
    const shipPrompts = fake.prompts.filter((p) => p.title === "roster:build:ship");
    expect(shipPrompts).toHaveLength(2);
    expect(shipPrompts[1].sessionId).toBe(shipPrompts[0].sessionId);
    expect(shipPrompts[0].text).toContain("Maya: webhook retries twice");
    expect(shipPrompts[1].text).toContain("since your last turn there");
    expect(shipPrompts[1].text).toContain("Maya: the logs show a 502 too");
    expect(shipPrompts[1].text).not.toContain("webhook retries twice");
    expect(shipPrompts[1].text).not.toContain("can you fix the retries");
    expect(shipPrompts[1].text).not.toContain("Build in ship: 1");

    const incidents = (await (await request.get(`${API}/api/v1/channels/incidents/messages`)).json()) as Msg[];
    expect(incidents.some((m) => m.text.startsWith("Build in ship"))).toBeFalsy();

    const room = await request.get(`${API}/api/v1/sessions/${shipPrompts[0].sessionId}/room`);
    expect(await room.json()).toMatchObject({ seatId: "build", channelId: "ship", kind: "room" });
    expect((await request.get(`${API}/api/v1/sessions/ses-unknown/room`)).status()).toBe(404);
  } finally {
    await fake.close();
    await dropFakeModel(request);
  }
});
