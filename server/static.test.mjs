import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveStaticFile, safeJoin, staticRoot, tryServeStatic } from "./static.mjs";

test("safeJoin rejects path traversal", () => {
  const root = "/tmp/roster-static";
  assert.equal(safeJoin(root, "../etc/passwd"), null);
  assert.ok(safeJoin(root, "/assets/app.js")?.endsWith(`${join("assets", "app.js")}`));
});

test("resolveStaticFile serves files and SPA fallback but not missing assets", () => {
  const dir = mkdtempSync(join(tmpdir(), "roster-static-"));
  writeFileSync(join(dir, "index.html"), "<html>app</html>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  assert.ok(resolveStaticFile(dir, "/").endsWith("index.html"));
  assert.ok(resolveStaticFile(dir, "/setup").endsWith("index.html"));
  assert.ok(resolveStaticFile(dir, "/assets/app.js").endsWith(join("assets", "app.js")));
  assert.equal(resolveStaticFile(dir, "/assets/missing.js"), null);
});

test("tryServeStatic is off unless ROSTER_STATIC_DIR is set", () => {
  const prev = process.env.ROSTER_STATIC_DIR;
  delete process.env.ROSTER_STATIC_DIR;
  try {
    assert.equal(staticRoot(), null);
    const headers = {};
    const res = {
      writeHead(code, h) {
        headers.code = code;
        Object.assign(headers, h);
      },
      end() {
        headers.ended = true;
      },
    };
    assert.equal(tryServeStatic({ method: "GET" }, res, "/setup"), false);
  } finally {
    if (prev === undefined) delete process.env.ROSTER_STATIC_DIR;
    else process.env.ROSTER_STATIC_DIR = prev;
  }
});

test("tryServeStatic writes SPA HTML when enabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "roster-static-"));
  writeFileSync(join(dir, "index.html"), "<html>app</html>");
  const prev = process.env.ROSTER_STATIC_DIR;
  process.env.ROSTER_STATIC_DIR = dir;
  try {
    const headRes = {
      headers: null,
      writeHead(code, headers) {
        this.code = code;
        this.headers = headers;
      },
      end() {
        this.ended = true;
      },
    };
    assert.equal(tryServeStatic({ method: "HEAD" }, headRes, "/app"), true);
    assert.equal(headRes.code, 200);
    assert.match(headRes.headers["content-type"], /text\/html/);
  } finally {
    if (prev === undefined) delete process.env.ROSTER_STATIC_DIR;
    else process.env.ROSTER_STATIC_DIR = prev;
  }
});
