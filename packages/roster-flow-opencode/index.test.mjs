import assert from "node:assert/strict";
import test from "node:test";
import { buildTools } from "./index.js";

function fakeTool(def) {
  return def;
}
fakeTool.schema = {
  string: () => ({
    describe() {
      return this;
    },
    optional() {
      return this;
    },
  }),
};

test("plugin tools POST to CORE bus (Oh My OpenAgent shape)", async () => {
  const calls = [];
  const fetchApi = async (path, init = {}) => {
    calls.push({ path, init });
    if (path === "/api/v1/seats") {
      return [
        { id: "product", name: "Product", kind: "bot", reportsTo: "maya" },
        { id: "build", name: "Eng.Build", kind: "bot", reportsTo: "jules" },
        { id: "maya", name: "Maya", kind: "human" },
      ];
    }
    if (path === "/api/v1/teams") return [{ id: "eng" }];
    return { id: "bus-1", path };
  };
  const tools = buildTools(fakeTool, fetchApi);
  const listed = await tools.roster_list_seats.execute();
  assert.match(listed.output, /product/);

  const sent = await tools.roster_send_message.execute({ to: "build", text: "brief" }, { agent: "product" });
  assert.match(sent.title, /build/);
  const sendCall = calls.find((c) => c.path === "/api/v1/messages");
  assert.equal(JSON.parse(sendCall.init.body).wake, true);

  await tools.roster_handoff.execute({ to: "build", text: "your turn" }, { agent: "product" });
  const hand = calls.find((c) => c.path === "/api/v1/bus/send" && JSON.parse(c.init.body).kind === "handoff");
  assert.ok(hand);

  await tools.roster_ask_human.execute({ text: "approve?" }, { agent: "product" });
  const ask = calls.filter((c) => c.path === "/api/v1/bus/send").at(-1);
  assert.equal(JSON.parse(ask.init.body).to, "maya");
});
