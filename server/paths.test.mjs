import assert from "node:assert/strict";
import { accessSync, constants } from "node:fs";
import test from "node:test";
import { authPath, companyWorkspace, dataDir, isDataWritable, opencodeDir, root, systemWorkspace } from "./paths.mjs";

test("default data paths stay under the repo .roster-flow dir", () => {
  assert.equal(dataDir.endsWith(".roster-flow") || dataDir.includes(".roster-flow"), true);
  assert.ok(authPath.startsWith(dataDir));
  assert.ok(companyWorkspace.startsWith(dataDir) || Boolean(process.env.ROSTER_WORKSPACE));
  assert.ok(systemWorkspace.startsWith(dataDir));
  assert.ok(opencodeDir.startsWith(root));
});

test("data dir reports writable when the process can write it", () => {
  assert.equal(isDataWritable(), true);
  accessSync(dataDir, constants.W_OK);
});
