import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "entrypoint.sh");
const isRoot = process.getuid?.() === 0;
const NOBODY = 65534;

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), "roster-entrypoint-"));
  // The root cases drop to nobody, which must be able to traverse the sandbox.
  chmodSync(base, 0o755);
  const data = join(base, "data");
  return { base, data, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function run(data, { env = {}, cmd = ["sh", "-c", 'echo "ran uid=$(id -u) home=$HOME"'] } = {}) {
  const r = spawnSync("sh", [script, ...cmd], {
    cwd: dirname(data),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ROSTER_DATA_DIR: data,
      ROSTER_OPENCODE_DIR: join(data, "opencode"),
      HOME: join(data, "home"),
      ...env,
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const owner = (p) => `${statSync(p).uid}:${statSync(p).gid}`;
const linkOwner = (p) => `${lstatSync(p).uid}:${lstatSync(p).gid}`;

test("entrypoint creates every data subdir and runs the command when writable", { skip: isRoot && "runs unprivileged" }, () => {
  const { data, cleanup } = sandbox();
  try {
    const r = run(data);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`ran uid=${process.getuid()} home=${join(data, "home")}`));
    for (const sub of ["workspace", "system/.opencode/agents", "opencode/agents", "home"]) {
      assert.ok(existsSync(join(data, sub)), `${sub} should exist`);
    }
  } finally {
    cleanup();
  }
});

test("entrypoint without root fails clearly on an unwritable /data/opencode instead of EACCES later", { skip: isRoot && "runs unprivileged" }, () => {
  const { data, cleanup } = sandbox();
  const oc = join(data, "opencode");
  try {
    mkdirSync(join(oc, "agents"), { recursive: true });
    writeFileSync(join(oc, "opencode.json"), "{}");
    chmodSync(join(oc, "opencode.json"), 0o444);
    chmodSync(join(oc, "agents"), 0o555);
    const r = run(data);
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /ran/, "the app must not start");
    assert.match(r.stderr, /without root, so ownership under .* cannot be repaired/);
    assert.match(r.stderr, /opencode\.json \(owner \d+:\d+\)/);
    assert.match(r.stderr, /opencode\/agents \(owner \d+:\d+\)/);
    assert.match(r.stderr, /run the container as root/);
  } finally {
    chmodSync(join(oc, "agents"), 0o755);
    cleanup();
  }
});

test("entrypoint as root chowns only wrong-owned app paths, without following symlinks out of /data", { skip: !isRoot && "needs root" }, () => {
  const { base, data, cleanup } = sandbox();
  const oc = join(data, "opencode");
  const outside = join(base, "outside");
  try {
    mkdirSync(oc, { recursive: true });
    mkdirSync(join(data, "lost+found"));
    mkdirSync(outside);
    writeFileSync(join(oc, "opencode.json"), "{}");
    writeFileSync(join(data, "state.json"), "{}");
    writeFileSync(join(outside, "secret"), "x");
    symlinkSync(outside, join(oc, "escape"));
    const env = { ROSTER_APP_USER: "nobody" };
    const want = `${NOBODY}:${NOBODY}`;

    const r = run(data, { env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`ran uid=${NOBODY} `));
    assert.match(r.stderr, /fixing ownership under .*opencode/);
    for (const p of [data, oc, join(oc, "opencode.json"), join(oc, "agents"), join(data, "state.json"), join(data, "home"), join(data, "system/.opencode/agents")]) {
      assert.equal(owner(p), want, p);
    }
    assert.equal(linkOwner(join(oc, "escape")), want, "the symlink itself is chowned");
    assert.equal(owner(outside), "0:0", "symlink target outside /data is untouched");
    assert.equal(owner(join(outside, "secret")), "0:0", "symlink target outside /data is untouched");
    assert.equal(owner(join(data, "lost+found")), "0:0", "unrelated top-level dirs are untouched");

    const again = run(data, { env });
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(again.stderr, /fixing ownership/, "second start is a no-op");
  } finally {
    cleanup();
  }
});

test("entrypoint as root refuses to follow a data subdir symlinked out of /data", { skip: !isRoot && "needs root" }, () => {
  const { base, data, cleanup } = sandbox();
  const outside = join(base, "outside");
  try {
    mkdirSync(data, { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, join(data, "home"));
    const r = run(data, { env: { ROSTER_APP_USER: "nobody" } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not repairing .*home: it resolves outside/);
    assert.match(r.stderr, /ownership was repaired as root, but nobody .* still cannot write/);
    assert.equal(owner(outside), "0:0");
  } finally {
    cleanup();
  }
});
