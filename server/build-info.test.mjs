import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bootCore } from "./test-helpers.mjs";
import {
  UNKNOWN_BUILD,
  buildInfo,
  gitSha,
  resetBuildInfoCache,
  resolveBuildInfo,
  stampIndexHtml,
} from "./build-info.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "0123456789abcdef0123456789abcdef01234567";

test("env SHA and build time win over git", () => {
  const info = resolveBuildInfo(
    { ROSTER_BUILD_SHA: SHA.toUpperCase(), ROSTER_BUILT_AT: "2026-11-14T10:23:09Z" },
    {
      git() {
        throw new Error("git should not run");
      },
      readPackage: () => JSON.stringify({ version: "0.1.0" }),
    },
  );
  assert.deepEqual(info, {
    sha: SHA,
    builtAt: "2026-11-14T10:23:09.000Z",
    version: "0.1.0",
  });
});

test("empty env falls back to git for the SHA only", () => {
  const info = resolveBuildInfo(
    { ROSTER_BUILD_SHA: "  ", ROSTER_BUILT_AT: "" },
    {
      git: () => SHA,
      readPackage: () => JSON.stringify({ version: "1.2.3-rc.1" }),
    },
  );
  assert.equal(info.sha, SHA);
  assert.equal(info.builtAt, UNKNOWN_BUILD);
  assert.equal(info.version, "1.2.3-rc.1");
});

test("missing git and package.json resolve to unknown and do not echo the env", () => {
  const leaked = "super-secret-value";
  const info = resolveBuildInfo(
    { ROSTER_BUILD_SHA: `not a sha ${leaked}`, ROSTER_BUILT_AT: "yesterday", ROSTER_OWNER_PASSWORD: leaked },
    {
      git() {
        return "";
      },
      readPackage() {
        throw new Error("missing");
      },
    },
  );
  assert.deepEqual(info, { sha: UNKNOWN_BUILD, builtAt: UNKNOWN_BUILD, version: UNKNOWN_BUILD });
  assert.equal(JSON.stringify(info).includes(leaked), false);
  assert.deepEqual(Object.keys(info).sort(), ["builtAt", "sha", "version"]);
});

test("gitSha ignores a parent repository", () => {
  const calls = [];
  const sha = gitSha("/app", (cmd, args) => {
    calls.push([cmd, args]);
    if (args.includes("--show-toplevel")) return "/elsewhere\n";
    return `${SHA}\n`;
  });
  assert.equal(sha, "");
  assert.equal(calls.length, 1);
});

test("gitSha reads HEAD only when this directory is the work tree", () => {
  const sha = gitSha("/app", (cmd, args) => {
    assert.equal(cmd, "git");
    if (args.includes("--show-toplevel")) return "/app\n";
    assert.deepEqual(args.slice(-2), ["rev-parse", "HEAD"]);
    return `${SHA}\n`;
  });
  assert.equal(sha, SHA);
});

test("this checkout's git fallback is a full SHA when the env is unset", () => {
  const prevSha = process.env.ROSTER_BUILD_SHA;
  const prevAt = process.env.ROSTER_BUILT_AT;
  delete process.env.ROSTER_BUILD_SHA;
  delete process.env.ROSTER_BUILT_AT;
  resetBuildInfoCache();
  try {
    const info = resolveBuildInfo({ ...process.env, ROSTER_BUILD_SHA: "", ROSTER_BUILT_AT: "" });
    assert.match(info.sha, /^[0-9a-f]{40}$/);
    assert.equal(info.builtAt, UNKNOWN_BUILD);
    assert.match(info.version, /^\d+\.\d+\.\d+/);
    resetBuildInfoCache();
    const cached = buildInfo();
    assert.equal(cached.sha, info.sha);
  } finally {
    if (prevSha === undefined) delete process.env.ROSTER_BUILD_SHA;
    else process.env.ROSTER_BUILD_SHA = prevSha;
    if (prevAt === undefined) delete process.env.ROSTER_BUILT_AT;
    else process.env.ROSTER_BUILT_AT = prevAt;
    resetBuildInfoCache();
  }
});

test("stampIndexHtml replaces the roster-build meta tag", () => {
  const html = '<head>\n    <meta name="roster-build" content="unknown" />\n  </head>';
  const stamped = stampIndexHtml(html, SHA);
  assert.match(stamped, new RegExp(`content="${SHA}"`));
  assert.equal(stamped.includes("unknown"), false);
  const escaped = stampIndexHtml("<head></head>", 'ab"c<d');
  assert.match(escaped, /content="unknown"/);
});

test("Dockerfile and compose pass the build identity args", () => {
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  const stages = dockerfile.split(/^FROM /m).slice(1);
  assert.equal(stages.length, 2);
  for (const stage of stages) {
    assert.match(stage, /^ARG ROSTER_BUILD_SHA=$/m);
    assert.match(stage, /^ARG ROSTER_BUILT_AT=$/m);
  }
  assert.match(dockerfile, /ROSTER_BUILD_SHA=\$\{ROSTER_BUILD_SHA\}/);
  assert.match(dockerfile, /ROSTER_BUILT_AT=\$\{ROSTER_BUILT_AT\}/);
  assert.match(dockerfile, /ROSTER_BUILD_SHA="\$ROSTER_BUILD_SHA" ROSTER_BUILT_AT="\$ROSTER_BUILT_AT" npm run build/);
  assert.match(dockerfile, /COPY server\/build-info\.mjs \.\/server\/build-info\.mjs/);
  for (const file of ["docker-compose.yml", "docker-compose.dokploy.yml"]) {
    const text = readFileSync(join(root, file), "utf8");
    assert.match(text, /ROSTER_BUILD_SHA: \$\{ROSTER_BUILD_SHA:-\}/);
    assert.match(text, /ROSTER_BUILT_AT: \$\{ROSTER_BUILT_AT:-\}/);
  }
  const index = readFileSync(join(root, "index.html"), "utf8");
  assert.match(index, /<meta name="roster-build" content="unknown" \/>/);
  const vite = readFileSync(join(root, "vite.config.ts"), "utf8");
  assert.match(vite, /stampIndexHtml/);
});

test("GET /api/version needs no session and returns only the build identity", async () => {
  const core = await bootCore({
    ROSTER_BUILD_SHA: SHA,
    ROSTER_BUILT_AT: "2026-11-14T10:23:09Z",
    ROSTER_OWNER_PASSWORD: "do-not-leak",
  });
  try {
    const res = await fetch(`${core.base}/api/version`, {
      headers: { authorization: "Bearer not-a-token" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.deepEqual(body, {
      sha: SHA,
      builtAt: "2026-11-14T10:23:09.000Z",
      version: pkg.version,
    });
    const post = await fetch(`${core.base}/api/version`, { method: "POST" });
    assert.equal(post.status, 401);
  } finally {
    await core.stop();
  }
});
