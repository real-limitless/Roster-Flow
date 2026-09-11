#!/usr/bin/env node
/**
 * Offline owner password recovery. Stop CORE first so it cannot overwrite state.json.
 * Rewrites the scrypt hash only — seats, runs, and rooms stay put.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resetOwnerPassword } from "../server/auth.mjs";
import { getState, save, statePath } from "../server/store.mjs";

function flagValue(name) {
  const dashed = `--${name}`;
  const idx = process.argv.indexOf(dashed);
  if (idx >= 0) return process.argv[idx + 1] || "";
  const eq = process.argv.find((a) => a.startsWith(`${dashed}=`));
  if (eq) return eq.slice(dashed.length + 1);
  return "";
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: npm run owner:reset -- [--password <new>]

Rewrites the local owner password hash in state.json and revokes every session.
Does not delete seats or runs. Stop CORE (npm run api / standup) first if it is running.

Non-interactive: --password or OWNER_RESET_PASSWORD.
`);
  process.exit(0);
}

async function readPassword() {
  const fromFlag = flagValue("password") || process.env.OWNER_RESET_PASSWORD || "";
  if (fromFlag) return fromFlag;
  if (!input.isTTY) {
    console.error("Pass --password or OWNER_RESET_PASSWORD when stdin is not a TTY.");
    process.exit(1);
  }
  const rl = createInterface({ input, output });
  const password = await rl.question("New owner password (min 8 characters): ");
  rl.close();
  return password;
}

try {
  const password = await readPassword();
  const state = getState();
  const seatsBefore = (state.seats || []).map((s) => s.id);
  const out = await resetOwnerPassword(state, { password });
  save();
  const seatsAfter = (getState().seats || []).map((s) => s.id);
  console.log(`Updated owner ${out.user.email} in ${statePath}`);
  console.log("All sessions revoked. Sign in again at /login.");
  console.log(`Seats kept (${seatsAfter.length}): ${seatsAfter.join(", ") || "(none)"}`);
  if (seatsBefore.some((id) => !seatsAfter.includes(id))) {
    console.error("warning: a seat id disappeared during migrate — file a bug");
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
