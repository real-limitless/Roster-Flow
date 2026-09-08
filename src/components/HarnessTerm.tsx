import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Seat } from "../data";

type Status = "connecting" | "ready" | "closed" | "error" | "human";

function harnessPtyUrl() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const env = (import.meta.env.VITE_API_URL as string | undefined) || "";
  if (env) {
    const u = new URL(env, window.location.origin);
    return `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/api/v1/harness/pty`;
  }
  if (import.meta.env.DEV) {
    return `ws://${window.location.hostname}:8787/api/v1/harness/pty`;
  }
  return `${proto}://${window.location.host}/api/v1/harness/pty`;
}

export function HarnessTerm({ seat }: { seat: Seat }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>(seat.kind === "human" ? "human" : "connecting");
  const [detail, setDetail] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [attach, setAttach] = useState<string | null>(null);

  useEffect(() => {
    if (seat.kind === "human") {
      setStatus("human");
      setDetail("Human seat — no OpenCode loop. Approvals only.");
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "IBM Plex Mono, ui-monospace, monospace",
      fontSize: 13,
      theme: { background: "#070a10", foreground: "#8b9bb0", cursor: "#7aa6ff" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* ignore */
    }
    const qs = new URLSearchParams({
      seat: seat.id,
      cols: String(term.cols || 100),
      rows: String(term.rows || 28),
    });
    const ws = new WebSocket(`${harnessPtyUrl()}?${qs}`);
    setStatus("connecting");
    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data);
      if (raw.startsWith("{")) {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === "status") {
            setStatus(msg.status);
            setDetail(msg.detail || "");
            if (msg.sessionId) setSessionId(msg.sessionId);
            if (msg.attach) setAttach(msg.attach);
            if (msg.status === "error") term.writeln(`\r\n${msg.detail || "harness error"}`);
            return;
          }
        } catch {
          /* PTY bytes */
        }
      }
      term.write(raw);
    };
    ws.onopen = () => {
      try {
        fit.fit();
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => setStatus((s) => (s === "error" ? s : "closed"));
    ws.onerror = () => setStatus("error");
    const sub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d);
    });
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {
        /* ignore */
      }
    });
    ro.observe(host);
    return () => {
      sub.dispose();
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  }, [seat.id, seat.kind]);

  return (
    <div className="tui harness-term" data-testid="harness-term" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="harness-meta" data-testid="harness-meta">
        <span className="am">
          {seat.name} · {seat.model || "default"}
        </span>
        {sessionId && <span className="dim"> · {sessionId}</span>}
        <span className="dim"> · {status}</span>
        {attach && (
          <button
            className="pill-btn"
            type="button"
            onClick={() => void navigator.clipboard?.writeText(attach)}
            title={attach}
          >
            Copy attach
          </button>
        )}
      </div>
      {seat.kind === "human" ? (
        <div className="line dim">{detail}</div>
      ) : (
        <div ref={hostRef} data-testid="harness-xterm" className="harness-xterm" />
      )}
      {status === "error" && detail && <div className="line dim">{detail}</div>}
    </div>
  );
}
