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
    assert.match(r.stderr, /opencode\.json \(owner \d+:\d+, mode \d+\)/);
    assert.match(r.stderr, /opencode\/agents \(owner \d+:\d+, mode \d+\)/);
    assert.match(r.stderr, /run the container as root/);
  } finally {
    chmodSync(join(oc, "agents"), 0o755);
    cleanup();
  }
});

test("entrypoint without root fails clearly on an unwritable /data/home/.local", { skip: isRoot && "runs unprivileged" }, () => {
  const { data, cleanup } = sandbox();
  const local = join(data, "home", ".local");
  try {
    mkdirSync(local, { recursive: true });
    chmodSync(local, 0o555);
    const r = run(data);
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /ran/, "the app must not start");
    assert.match(r.stderr, /home\/\.local \(owner \d+:\d+, mode \d+\)/);
  } finally {
    chmodSync(local, 0o755);
    cleanup();
  }
});

test("entrypoint without root reports an unreadable subfolder instead of exiting silently", { skip: isRoot && "runs unprivileged" }, () => {
  const { data, cleanup } = sandbox();
  const locked = join(data, "workspace", "locked");
  try {
    mkdirSync(join(locked, "inner"), { recursive: true });
    chmodSync(locked, 0o000);
    const r = run(data);
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /ran/, "the app must not start");
    assert.match(r.stderr, /entrypoint: ERROR: running as .* without root/);
    assert.match(r.stderr, /workspace\/locked \(owner \d+:\d+, mode 0\)/);
  } finally {
    chmodSync(locked, 0o755);
    cleanup();
  }
});

test("entrypoint after the privilege drop reports an unreadable subfolder (e.g. NFS root_squash)", { skip: isRoot && "runs unprivileged" }, () => {
  const { data, cleanup } = sandbox();
  const locked = join(data, "workspace", "locked");
  try {
    mkdirSync(join(locked, "inner"), { recursive: true });
    chmodSync(locked, 0o000);
    const r = run(data, { env: { ROSTER_ENTRYPOINT_DROPPED: "1" } });
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /ran/, "the app must not start");
    assert.match(r.stderr, /ownership was repaired as root, but .* still cannot read or write/);
    assert.match(r.stderr, /workspace\/locked \(owner \d+:\d+, mode 0\)/);
    assert.match(r.stderr, /NFS export with root_squash/);
  } finally {
    chmodSync(locked, 0o755);
    cleanup();
  }
});

test("entrypoint as root chowns every wrong-owned entry under /data, without following symlinks out of it", { skip: !isRoot && "needs root" }, () => {
  const { base, data, cleanup } = sandbox();
  const oc = join(data, "opencode");
  const outside = join(base, "outside");
  try {
    mkdirSync(oc, { recursive: true });
    mkdirSync(join(data, "lost+found"));
    mkdirSync(join(data, "workspace", "repo", ".git"), { recursive: true });
    mkdirSync(join(data, "workspace", "locked"), { recursive: true });
    writeFileSync(join(data, "workspace", "locked", "notes"), "x");
    chmodSync(join(data, "workspace", "locked"), 0o700);
    mkdirSync(outside);
    writeFileSync(join(oc, "opencode.json"), "{}");
    writeFileSync(join(data, "state.json"), "{}");
    writeFileSync(join(data, "workspace", "repo", ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(outside, "secret"), "x");
    symlinkSync(outside, join(oc, "escape"));
    const env = { ROSTER_APP_USER: "nobody" };
    const want = `${NOBODY}:${NOBODY}`;

    const r = run(data, { env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`ran uid=${NOBODY} `));
    assert.match(r.stderr, /fixing ownership under /);
    for (const p of [
      data,
      oc,
      join(oc, "opencode.json"),
      join(oc, "agents"),
      join(data, "state.json"),
      join(data, "home"),
      join(data, "system"),
      join(data, "system/.opencode/agents"),
      join(data, "workspace/repo/.git/HEAD"),
      join(data, "workspace/locked"),
      join(data, "workspace/locked/notes"),
      join(data, "lost+found"),
    ]) {
      assert.equal(owner(p), want, p);
    }
    assert.equal(linkOwner(join(oc, "escape")), want, "the symlink itself is chowned");
    assert.equal(owner(outside), "0:0", "symlink target outside /data is untouched");
    assert.equal(owner(join(outside, "secret")), "0:0", "symlink target outside /data is untouched");

    const again = run(data, { env });
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(again.stderr, /fixing ownership/, "second start is a no-op");
  } finally {
    cleanup();
  }
});

test("entrypoint as root repairs root-owned /data/home/.local so opencode can create its XDG dirs", { skip: !isRoot && "needs root" }, () => {
  const { data, cleanup } = sandbox();
  const home = join(data, "home");
  try {
    mkdirSync(join(home, ".local", "share", "opencode", "storage"), { recursive: true });
    writeFileSync(join(home, ".local", "share", "opencode", "storage", "session.json"), "{}");
    mkdirSync(join(data, "system"), { recursive: true });
    const env = { ROSTER_APP_USER: "nobody" };
    const want = `${NOBODY}:${NOBODY}`;
    const opencodeLike = [
      "sh",
      "-c",
      'mkdir -p "$HOME/.local/state/opencode" "$HOME/.local/share/opencode/log" "$HOME/.config/opencode" "$HOME/.cache/opencode" ' +
        '&& echo "{}" > "$HOME/.local/share/opencode/storage/session.json" && echo opencode-ok',
    ];

    const r = run(data, { env, cmd: opencodeLike });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /opencode-ok/);
    for (const p of [
      home,
      join(home, ".local"),
      join(home, ".local/share/opencode/storage/session.json"),
      join(home, ".local/state/opencode"),
      join(data, "system"),
      join(data, "workspace"),
      join(data, "opencode"),
    ]) {
      assert.equal(owner(p), want, p);
    }
  } finally {
    cleanup();
  }
});

test("entrypoint as root does not walk other mounts inside /data but still repairs app dirs mounted separately", { skip: !isRoot && "needs root" }, (t) => {
  const { base, data, cleanup } = sandbox();
  const foreign = join(base, "foreign");
  const workspaceVol = join(base, "workspace-vol");
  const mounted = [];
  try {
    mkdirSync(join(data, "mnt"), { recursive: true });
    mkdirSync(join(data, "workspace"), { recursive: true });
    mkdirSync(join(foreign, "sub"), { recursive: true });
    writeFileSync(join(foreign, "sub", "file"), "x");
    mkdirSync(join(workspaceVol, "repo"), { recursive: true });
    writeFileSync(join(workspaceVol, "repo", "file"), "x");
    for (const [src, dest] of [[foreign, join(data, "mnt")], [workspaceVol, join(data, "workspace")]]) {
      if (spawnSync("mount", ["--bind", src, dest]).status !== 0) {
        t.skip("bind mounts are not permitted here");
        return;
      }
      mounted.unshift(dest);
    }
    const want = `${NOBODY}:${NOBODY}`;

    const r = run(data, { env: { ROSTER_APP_USER: "nobody" } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(owner(foreign), "0:0", "another mount inside /data is not chowned, not even its mount point");
    assert.equal(owner(join(foreign, "sub")), "0:0", "another mount inside /data is not walked");
    assert.equal(owner(join(foreign, "sub", "file")), "0:0");
    assert.equal(owner(join(workspaceVol, "repo", "file")), want, "a separately mounted app dir is still repaired");
  } finally {
    for (const dest of mounted) spawnSync("umount", [dest]);
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
    assert.match(r.stderr, /not creating or repairing .*home: it resolves outside/);
    assert.match(r.stderr, /ownership was repaired as root, but nobody .* still cannot read or write/);
    assert.equal(owner(outside), "0:0");
  } finally {
    cleanup();
  }
});
