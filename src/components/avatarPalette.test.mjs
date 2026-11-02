import assert from "node:assert/strict";
import test from "node:test";
import { seats } from "../../server/seed.mjs";
import { avatarPalette } from "./avatarPalette.ts";

test("seed seat avatars keep ellipse radii positive", () => {
  const ids = seats.map((seat) => seat.id);
  assert.ok(ids.includes("sec"));
  for (const id of ids) {
    const p = avatarPalette(id);
    assert.ok(p.rx >= 1 && p.ry >= 1, `${id} rx=${p.rx} ry=${p.ry}`);
    assert.ok(p.x >= 0 && p.y >= 0, `${id} x=${p.x} y=${p.y}`);
  }
});

test("the sec seed no longer paints ry=-1", () => {
  // High bit set on this FNV mix. The old arithmetic shift produced ry=-1.
  const p = avatarPalette("sec");
  assert.deepEqual({ x: p.x, y: p.y, rx: p.rx, ry: p.ry }, { x: 16, y: 16, rx: 7, ry: 10 });
});

test("avatar radii stay inside the blob for mixed seeds", () => {
  const seeds = ["", "seat", "you", "build", "wiki-editor", "wiki-supervisor"];
  for (let i = 0; i < 5000; i++) seeds.push(`seat-${i}`);
  for (const seed of seeds) {
    const p = avatarPalette(seed);
    assert.ok(p.rx >= 6 && p.rx <= 12, seed);
    assert.ok(p.ry >= 5 && p.ry <= 11, seed);
    assert.ok(p.x >= 10 && p.x <= 21, seed);
    assert.ok(p.y >= 9 && p.y <= 20, seed);
  }
});
