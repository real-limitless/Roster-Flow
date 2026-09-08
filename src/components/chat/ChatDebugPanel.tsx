import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export type DebugEvent = {
  id: string;
  ts: string;
  level: string;
  scope: string;
  step: string;
  channel: string | null;
  seat: string | null;
  detail: Record<string, unknown>;
};

const DEBUG_KEY = "roster-flow.debug-panel";

export function loadDebugOpen() {
  try {
    return localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDebugOpen(open: boolean) {
  try {
    localStorage.setItem(DEBUG_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function ChatDebugPanel({
  channel,
  scope,
  compact = false,
}: {
  channel?: string;
  scope?: string;
  compact?: boolean;
}) {
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [harness, setHarness] = useState("offline");
  const [systemHarness, setSystemHarness] = useState("offline");
  const [providerKeys, setProviderKeys] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      void api
        .debugTrace({ channel, scope, limit: compact ? 8 : 60 })
        .then((out) => {
          if (cancelled) return;
          setEvents(Array.isArray(out.events) ? [...out.events].reverse() : []);
          setHarness(out.harness || "offline");
          setSystemHarness(out.systemHarness?.harness || "offline");
          setProviderKeys(Boolean(out.providerKeys));
        })
        .catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [channel, scope, compact]);

  return (
    <aside className={`chat-debug ${compact ? "compact" : ""}`} data-testid="chat-debug">
      <div className="chat-debug-head">
        <strong>{compact ? "Last steps" : "Debug"}</strong>
        <div className="chat-debug-chips">
          <span className={`chip ${harness === "up" ? "ok" : ""}`} data-testid="debug-company">
            company {harness}
          </span>
          <span className={`chip ${systemHarness === "up" ? "ok" : ""}`} data-testid="debug-system">
            system {systemHarness}
          </span>
          <span className={`chip ${providerKeys ? "ok" : ""}`} data-testid="debug-keys">
            {providerKeys ? "keys" : "no key"}
          </span>
        </div>
      </div>
      <ol className="chat-debug-list" data-testid="chat-debug-list">
        {events.length === 0 && <li className="micro">No pipeline events yet.</li>}
        {events.map((e) => (
          <li key={e.id} className={`chat-debug-item ${e.level}`} data-testid={`debug-event-${e.step}`}>
            <span className="chat-debug-step">{e.step}</span>
            <span className="dim">
              {e.seat || e.channel || e.scope}
              {detailLine(e.detail)}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function detailLine(detail: Record<string, unknown>) {
  const bits = [];
  if (detail.model) bits.push(String(detail.model));
  if (detail.kind) bits.push(String(detail.kind));
  if (detail.error) bits.push(String(detail.error));
  if (detail.message) bits.push(String(detail.message));
  return bits.length ? ` · ${bits.join(" · ")}` : "";
}
