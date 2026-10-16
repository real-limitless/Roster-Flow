#!/usr/bin/env node
/**
 * Headless owner bootstrap.
 *
 *   node scripts/create-owner.mjs --email you@example.com --name "You" [--template empty|starter]
 *     Password is read from ROSTER_OWNER_PASSWORD (never pass it as an argument).
 *     Writes to ROSTER_DATA_DIR; run it before starting CORE (or restart CORE after).
 *
 *   ROSTER_OWNER_PASSWORD=... node scripts/create-owner.mjs --hash
 *     Prints an scrypt$salt$hash value for ROSTER_OWNER_PASSWORD_HASH.
 */
import { formatPasswordHash, seedOwner } from "../server/bootstrap.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const password = process.env.ROSTER_OWNER_PASSWORD;
  if (process.argv.includes("--hash")) {
    console.log(await formatPasswordHash(password));
    return;
  }
  const email = arg("email") || process.env.ROSTER_OWNER_EMAIL;
  if (!email) throw new Error("--email (or ROSTER_OWNER_EMAIL) is required");
  const passwordHash = process.env.ROSTER_OWNER_PASSWORD_HASH;
  if (!password && !passwordHash) throw new Error("set ROSTER_OWNER_PASSWORD or ROSTER_OWNER_PASSWORD_HASH");
  const { getState, mutate } = await import("../server/store.mjs");
  const out = await seedOwner(getState(), {
    email,
    name: arg("name") || process.env.ROSTER_OWNER_NAME || email.split("@")[0],
    password,
    passwordHash,
    template: arg("template") || process.env.ROSTER_OWNER_TEMPLATE || "empty",
  });
  mutate(() => out.state);
  console.log(`owner ${out.user.email} created; setup is closed.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
