import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bootState, migrateState, starterState } from "./seed.mjs";
import { dataDir } from "./paths.mjs";

export { dataDir };
export const statePath = join(dataDir, "state.json");

function load() {
  if (!existsSync(statePath)) return migrateState(bootState());
  try {
    return migrateState({ ...starterState(), ...JSON.parse(readFileSync(statePath, "utf8")) });
  } catch {
    return migrateState(bootState());
  }
}

let state = load();
save();

export function getState() {
  return state;
}

export function save() {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function mutate(fn) {
  const next = fn(state);
  if (next) state = next;
  save();
  return state;
}

export function resetState() {
  state = migrateState(bootState());
  save();
  return state;
}

export function clock() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
