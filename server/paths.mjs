import { accessSync, constants, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function resolveDir(value, fallback) {
  if (!value) return fallback;
  return isAbsolute(value) ? value : join(root, value);
}

export const dataDir = resolveDir(process.env.ROSTER_DATA_DIR, join(root, ".roster-flow"));
export const opencodeDir = resolveDir(process.env.ROSTER_OPENCODE_DIR, join(root, ".opencode"));
export const companyWorkspace = resolveDir(process.env.ROSTER_WORKSPACE, join(dataDir, "workspace"));
export const systemWorkspace = join(dataDir, "system");
export const authPath = join(dataDir, "auth.json");

export function isDataWritable() {
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
