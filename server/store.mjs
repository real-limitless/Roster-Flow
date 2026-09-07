import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyState, migrateState } from "./seed.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = join(root, ".roster-flow");
export const statePath = join(dataDir, "state.json");

function load() {
  if (!existsSync(statePath)) return emptyState();
  try {
    return migrateState({ ...emptyState(), ...JSON.parse(readFileSync(statePath, "utf8")) });
  } catch {
    return emptyState();
  }
}

let state = load();

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
  state = migrateState(emptyState());
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
