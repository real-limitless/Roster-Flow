/**
 * Deploy identity for GET /api/version and the web bundle.
 * SHA and build time come from ROSTER_BUILD_SHA / ROSTER_BUILT_AT (Docker build
 * args copied into the image env). A local checkout with those unset uses
 * `git rev-parse HEAD` for the SHA. Anything else is "unknown".
 * The payload is only sha, builtAt, and the package version.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const UNKNOWN_BUILD = "unknown";

const SHA_RE = /^[0-9a-f]{7,40}$/;
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/;

function gitEnv() {
  return { PATH: process.env.PATH || "", GIT_TERMINAL_PROMPT: "0" };
}

function runGit(args, cwd, execFile) {
  return String(
    execFile("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
      env: gitEnv(),
      windowsHide: true,
    }),
  ).trim();
}

/** Commit SHA when `cwd` itself is a git work tree. A parent repo does not count. */
export function gitSha(cwd = root, execFile = execFileSync) {
  try {
    const top = runGit(["rev-parse", "--show-toplevel"], cwd, execFile);
    if (!top || resolve(top) !== resolve(cwd)) return "";
    return runGit(["rev-parse", "HEAD"], cwd, execFile);
  } catch {
    return "";
  }
}

export function normalizeSha(value) {
  const sha = String(value ?? "").trim().toLowerCase();
  return SHA_RE.test(sha) ? sha : "";
}

export function normalizeBuiltAt(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.toLowerCase() === UNKNOWN_BUILD || raw.length > 40) return "";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

function readPackageVersion(readPackage) {
  try {
    const raw = readPackage ? readPackage() : readFileSync(join(root, "package.json"), "utf8");
    const version = String(JSON.parse(raw).version || "").trim();
    if (VERSION_RE.test(version)) return version;
  } catch {
    /* setup or partial copies may omit package.json */
  }
  return UNKNOWN_BUILD;
}

export function resolveBuildInfo(env = process.env, deps = {}) {
  const cwd = deps.cwd || root;
  const readGit = deps.git || (() => gitSha(cwd, deps.execFileSync || execFileSync));
  let sha = normalizeSha(env.ROSTER_BUILD_SHA);
  if (!sha) {
    try {
      sha = normalizeSha(readGit());
    } catch {
      sha = "";
    }
  }
  return {
    sha: sha || UNKNOWN_BUILD,
    builtAt: normalizeBuiltAt(env.ROSTER_BUILT_AT) || UNKNOWN_BUILD,
    version: readPackageVersion(deps.readPackage),
  };
}

let cached = null;

export function buildInfo() {
  if (!cached) cached = resolveBuildInfo();
  return { ...cached };
}

export function resetBuildInfoCache() {
  cached = null;
}

export function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const META_RE = /<meta\s+name="roster-build"\s+content="[^"]*"\s*\/?>/i;

/** Put the build SHA in index.html. Only a hex SHA or "unknown" is written. */
export function stampIndexHtml(html, sha) {
  const raw = String(sha ?? "").trim().toLowerCase();
  const safe = normalizeSha(raw) || UNKNOWN_BUILD;
  const tag = `<meta name="roster-build" content="${escapeAttr(safe)}" />`;
  if (META_RE.test(html)) return html.replace(META_RE, tag);
  return String(html).replace("</head>", `    ${tag}\n  </head>`);
}
