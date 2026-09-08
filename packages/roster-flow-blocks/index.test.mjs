import assert from "node:assert/strict";
import test from "node:test";
import { Blocks, Elements, examplePayload, fallbackText, validateBlocks } from "./index.js";

test("builders produce valid Block Kit", () => {
  const blocks = [
    Blocks.header("New request"),
    Blocks.section({
      text: "*Type:* Paid Time Off",
      accessory: Elements.button({ text: "Approve", actionId: "approve", value: "req_1" }),
    }),
    Blocks.divider(),
    Blocks.context(["Due Aug 13"]),
  ];
  const v = validateBlocks(blocks);
  assert.equal(v.ok, true);
  assert.equal(v.blocks.length, 4);
  assert.match(fallbackText(v.blocks), /New request/);
});

test("validateBlocks rejects unknown types and empty arrays", () => {
  assert.equal(validateBlocks([]).ok, false);
  assert.equal(validateBlocks([{ type: "modal" }]).ok, false);
  assert.equal(validateBlocks({ type: "section" }).ok, false);
  assert.match(validateBlocks([{ type: "section" }]).errors[0], /text or fields/);
});

test("example payload is valid", () => {
  const payload = examplePayload();
  const v = validateBlocks(payload.blocks);
  assert.equal(v.ok, true);
  assert.equal(payload.text, fallbackText(v.blocks));
});
