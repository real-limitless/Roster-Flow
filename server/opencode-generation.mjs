/**
 * Which OpenCode serve contract to speak.
 *
 * The image installs OpenCode with `https://opencode.ai/install`, and that
 * script refuses 2.x (it installs the latest `opencode-ai` 1.x). OpenCode 2
 * is a different installer (`https://opencode.ai/v2/install`) and a different
 * HTTP API. CORE reads `opencode --version` and keeps the 1.x routes unless
 * the binary reports major 2 or newer.
 *
 * `ROSTER_OPENCODE_GENERATION=1` or `=2` overrides detection.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

let probed = null;

export function parseOpenCodeMajor(text) {
  const match = String(text || "").match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  return match ? Number(match[1]) : null;
}

export function resolveOpenCodeBin(env = process.env) {
  const envBin = env.OPENCODE_BIN;
  if (envBin) return existsSync(envBin) ? envBin : null;
  const path = env.PATH || "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const cand = join(dir, "opencode");
    if (existsSync(cand)) return cand;
  }
  return null;
}

function probeMajor(bin, env) {
  if (probed && probed.bin === bin) return probed.major;
  let major = 1;
  try {
    const out = spawnSync(bin, ["--version"], {
      encoding: "utf8",
      timeout: 4000,
      env: { ...process.env, ...env },
    });
    const parsed = parseOpenCodeMajor(`${out.stdout || ""}\n${out.stderr || ""}`);
    if (parsed) major = parsed;
  } catch {
    major = 1;
  }
  probed = { bin, major };
  return major;
}

/** 1 for OpenCode 1.x (the Docker installer). 2 when the binary is OpenCode 2. */
export function openCodeGeneration(env = process.env) {
  const forced = String(env.ROSTER_OPENCODE_GENERATION || "").trim().toLowerCase();
  if (forced === "1" || forced === "v1") return 1;
  if (forced === "2" || forced === "v2") return 2;
  const bin = resolveOpenCodeBin(env);
  if (!bin) return 1;
  return probeMajor(bin, env);
}

export function openCodeIsV2(env = process.env) {
  return openCodeGeneration(env) >= 2;
}
