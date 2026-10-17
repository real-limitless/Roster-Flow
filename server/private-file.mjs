import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Owner-only. state.json and auth.json hold secrets. */
export const PRIVATE_FILE_MODE = 0o600;

export function protectPrivateFile(path) {
  if (path && existsSync(path)) chmodSync(path, PRIVATE_FILE_MODE);
}

export function writePrivateFile(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode: PRIVATE_FILE_MODE });
  protectPrivateFile(path);
}
