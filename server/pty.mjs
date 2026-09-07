/**
 * PTY for `opencode attach <serve> --session <id>`.
 * Prefers node-pty; otherwise Python pty-bridge.py (this host has no `make`).
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { ensure, status as harnessStatus, whichOpenCode } from "./harness.mjs";
import { getState } from "./store.mjs";
import { ensureSeatSession } from "./bus.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridge = join(root, "server", "pty-bridge.py");

function spawnAttach({ binary, url, sessionId, cols, rows, cwd, env }) {
  const args = ["attach", url, "--session", sessionId, "--dir", root];
  try {
    // Optional — not installed when node-gyp/`make` is missing.
    const pty = requireNodePty();
    if (pty) {
      const term = pty.spawn(binary, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: { ...env, TERM: "xterm-256color" },
      });
      return {
        write: (d) => term.write(d),
        resize: (c, r) => term.resize(c, r),
        onData: (fn) => term.onData(fn),
        onExit: (fn) => term.onExit(() => fn()),
        kill: () => {
          try {
            term.kill();
          } catch {
            /* ignore */
          }
        },
        kind: "node-pty",
      };
    }
  } catch {
    /* fall through */
  }

  const child = spawn("python3", [bridge, binary, ...args], {
    cwd,
    env: { ...env, TERM: "xterm-256color", PTY_COLS: String(cols), PTY_ROWS: String(rows), PTY_CTRL_FD: "3" },
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });
  for (const stream of [child.stdin, child.stdout, child.stderr, child.stdio[3]]) {
    stream?.on("error", () => undefined);
  }
  child.on("error", () => undefined);
  return {
    write: (d) => child.stdin.write(typeof d === "string" ? d : Buffer.from(d)),
    resize: (c, r) => {
      try {
        child.stdio[3]?.write(`${JSON.stringify({ type: "resize", cols: c, rows: r })}\n`);
      } catch {
        /* ignore */
      }
    },
    onData: (fn) => {
      child.stdout.on("data", (buf) => fn(buf.toString("utf8")));
      child.stderr.on("data", (buf) => fn(buf.toString("utf8")));
    },
    onExit: (fn) => child.on("exit", () => fn()),
    kill: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
    kind: "python-pty",
  };
}

function requireNodePty() {
  try {
    const resolved = import.meta.resolve("node-pty");
    if (!resolved) return null;
  } catch {
    return null;
  }
  return null;
}

export function attachPtyServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    socket.on("error", () => undefined);
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/api/v1/harness/pty") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handlePty(ws, url.searchParams.get("seat") || "", url.searchParams);
    });
  });
}

async function handlePty(ws, seatId, params) {
  const send = (obj) => {
    if (ws.readyState === 1) ws.send(typeof obj === "string" ? obj : JSON.stringify(obj));
  };
  try {
    const seat = getState().seats.find((s) => s.id === seatId);
    if (!seat) {
      send({ type: "status", status: "error", detail: "seat not found" });
      ws.close();
      return;
    }
    if (seat.kind === "human") {
      send({ type: "status", status: "error", detail: "human seat — no OpenCode loop" });
      ws.close();
      return;
    }
    send({ type: "status", status: "connecting" });
    try {
      await ensure({});
    } catch (err) {
      send({ type: "status", status: "error", detail: err.message || "ensure failed" });
      ws.close();
      return;
    }
    const h = harnessStatus();
    const binary = whichOpenCode();
    if (h.harness !== "up" || !binary || !h.port) {
      send({ type: "status", status: "error", detail: "OpenCode harness is offline" });
      ws.close();
      return;
    }
    const sessionId = await ensureSeatSession(seatId);
    if (!sessionId) {
      send({ type: "status", status: "error", detail: "could not create session" });
      ws.close();
      return;
    }
    const cols = Math.max(20, Number(params.get("cols")) || 100);
    const rows = Math.max(8, Number(params.get("rows")) || 28);
    const serveUrl = `http://127.0.0.1:${h.port}`;
    const term = spawnAttach({
      binary,
      url: serveUrl,
      sessionId,
      cols,
      rows,
      cwd: root,
      env: process.env,
    });
    send({
      type: "status",
      status: "ready",
      sessionId,
      attach: `opencode attach ${serveUrl} --session ${sessionId}`,
      pty: term.kind,
    });
    term.onData((data) => {
      if (ws.readyState === 1) ws.send(data);
    });
    term.onExit(() => {
      send({ type: "status", status: "closed" });
      ws.close();
    });
    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString();
      if (text.startsWith("{")) {
        try {
          const msg = JSON.parse(text);
          if (msg.type === "resize") {
            term.resize(Number(msg.cols) || cols, Number(msg.rows) || rows);
            return;
          }
        } catch {
          /* raw keystrokes that happen to start with { */
        }
      }
      term.write(text);
    });
    ws.on("close", () => term.kill());
    ws.on("error", () => term.kill());
  } catch (err) {
    send({ type: "status", status: "error", detail: String(err.message || err) });
    ws.close();
  }
}
