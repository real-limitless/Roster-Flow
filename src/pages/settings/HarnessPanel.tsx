import { api } from "../../lib/api";
import type { HarnessKindStatus, HarnessStatus } from "./types";

function ServeCard({
  title,
  kind,
  status,
  testId,
  onChanged,
  onError,
}: {
  title: string;
  kind: "company" | "system";
  status?: HarnessKindStatus;
  testId?: string;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const up = status?.harness === "up";

  async function run(forceRestart = false) {
    try {
      await api.ensure(kind, { forceRestart });
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="card" data-testid={testId}>
      <h3>
        {title} <span className={`chip ${up ? "ok" : ""}`}>{up ? "up" : "offline"}</span>
      </h3>
      <div className="kv">
        <span>Binary</span>
        <b>{status?.binary || "not found"}</b>
      </div>
      <div className="kv">
        <span>Port</span>
        <b>{status?.port ?? "—"}</b>
      </div>
      <div className="kv">
        <span>Workspace</span>
        <b>{status?.workspace || "—"}</b>
      </div>
      <div className="kv">
        <span>Version</span>
        <b>{status?.version || "—"}</b>
      </div>
      <div className="settings-actions">
        <button
          className="pill-btn"
          type="button"
          data-testid={kind === "system" ? "ensure-system-harness" : "ensure-company-harness"}
          onClick={() => void run(false)}
        >
          Ensure
        </button>
        <button className="pill-btn" type="button" onClick={() => void run(true)}>
          Restart
        </button>
      </div>
    </div>
  );
}

export function HarnessPanel({
  status,
  onChanged,
  onError,
}: {
  status: HarnessStatus | null;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  return (
    <section className="settings-pane" data-testid="settings-harness">
      <div className="settings-head">
        <h1>Harness</h1>
        <p className="micro">
          Company serve is for product bots. System serve is Architect and Channel. Both are{" "}
          <code>opencode serve</code> — Roster-flow does not start a second loop.
        </p>
      </div>
      <div className="settings-grid">
        <ServeCard title="Company" kind="company" status={status || undefined} onChanged={onChanged} onError={onError} />
        <ServeCard
          title="System"
          kind="system"
          status={status?.systemHarness}
          onChanged={onChanged}
          onError={onError}
        />
      </div>
    </section>
  );
}
