import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sh = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "entrypoint.sh"), "utf8");

test("entrypoint always chowns the OpenCode dir before setpriv", () => {
  assert.match(sh, /chown -R node:node "\$OC"/);
  const chownIdx = sh.indexOf('chown -R node:node "$OC"');
  const setprivIdx = sh.indexOf("exec setpriv");
  assert.ok(chownIdx > 0 && setprivIdx > chownIdx);
});
