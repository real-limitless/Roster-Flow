#!/usr/bin/env node
/**
 * Issue a scoped API token headlessly (writes to ROSTER_DATA_DIR; restart CORE after if it is running).
 *
 *   node scripts/create-token.mjs --name wiki-setup [--scopes read,write] [--days 90]
 *
 * Prints the token once. Only its hash is stored.
 * To register a token you already generated, set ROSTER_API_TOKEN and boot CORE instead.
 */
import { createApiToken } from "../server/tokens.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { mutate } = await import("../server/store.mjs");
  let out = null;
  mutate((s) => {
    out = createApiToken(s, {
      name: arg("name") || "cli",
      scopes: arg("scopes") || "read,write",
      expiresInDays: arg("days") ? Number(arg("days")) : undefined,
    });
  });
  console.log(out.token);
  console.error(`token ${out.record.id} (${out.record.scopes.join(",")}) created; it will not be shown again.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
