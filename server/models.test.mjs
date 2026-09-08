import assert from "node:assert/strict";
import test from "node:test";
import { modelChainForSeat, pickTeamModel } from "./models.mjs";

test("pickTeamModel default uses first allowed then default", () => {
  const team = { defaultModel: "a/one", fallbackModel: "b/two", allowedModels: ["a/one", "b/two"], modelStrategy: "default" };
  assert.equal(pickTeamModel(team, { seatType: "generic" }), "a/one");
});

test("round robin advances rrIndex", () => {
  const team = { defaultModel: "a/one", allowedModels: ["a/one", "b/two"], modelStrategy: "round_robin", rrIndex: 0 };
  assert.equal(pickTeamModel(team, { seatType: "generic" }), "a/one");
  assert.equal(pickTeamModel(team, { seatType: "generic" }), "b/two");
  assert.equal(team.rrIndex, 0);
});

test("fuse chain includes fallbacks after primary", () => {
  const team = {
    defaultModel: "a/one",
    fallbackModel: "b/two",
    allowedModels: ["a/one", "b/two", "c/three"],
    modelStrategy: "fuse",
  };
  const chain = modelChainForSeat({ seatType: "generic", model: "a/one" }, team);
  assert.equal(chain[0], "a/one");
  assert.ok(chain.includes("b/two"));
  assert.ok(chain.includes("c/three"));
});

test("specialists keep their own model chain", () => {
  const chain = modelChainForSeat({ seatType: "specialist", model: "x/spec", fallbackModel: "y/fb" }, { defaultModel: "a/one" });
  assert.deepEqual(chain, ["x/spec", "y/fb"]);
});
