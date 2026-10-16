import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { summarizeUsage } from "../../lib/budget";
import type { Seat, Team, UsageRow } from "../../data";

export function UsagePanel({
  seats,
  teams,
  harness,
  onError,
}: {
  seats: Seat[];
  teams: Team[];
  harness?: string;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [projectId, setProjectId] = useState("");
  const [teamId, setTeamId] = useState("");

  async function refresh(next = { projectId, teamId }) {
    try {
      const list = await api.usage({
        projectId: next.projectId || undefined,
        teamId: next.teamId || undefined,
      });
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load usage");
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, teamId]);

  const totals = useMemo(() => summarizeUsage(rows), [rows]);
  const leaked = rows.some((r) =>
    Object.keys(r).some((k) => ["apiKey", "token", "secret", "password", "authorization", "key"].includes(k)),
  );
  const projectIds = [...new Set(seats.map((s) => s.projectId).filter(Boolean))] as string[];
  const bySeat = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.seatId, (map.get(row.seatId) || 0) + Number(row.tokens || 0));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  function download(kind: "json" | "csv") {
    if (kind === "csv") {
      window.location.href = `/api/v1/usage?format=csv${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ""}`;
      return;
    }
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "roster-usage.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const offline = harness !== "up";

  return (
    <section className="settings-pane" data-testid="settings-usage">
      <div className="settings-head">
        <h1>Usage</h1>
        <p className="micro">
          Tokens, estimated USD, and session hours from CORE meter events. This is not a billed bot-hour product.
          API keys never appear in this log.
        </p>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="kv">
          <span>Wakes</span>
          <b data-testid="usage-wakes">{totals.wakes}</b>
        </div>
        <div className="kv">
          <span>Tokens</span>
          <b data-testid="usage-tokens">{totals.tokens}</b>
        </div>
        <div className="kv">
          <span>USD (est.)</span>
          <b data-testid="usage-usd">${totals.usd}</b>
        </div>
        <div className="kv">
          <span>Hours</span>
          <b data-testid="usage-hours">{totals.hours}</b>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <label className="kv-label">
          Project
          <select
            data-testid="usage-filter-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All</option>
            {projectIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="kv-label">
          Team
          <select data-testid="usage-filter-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">All</option>
            {teams
              .filter((t) => t.staffed !== false)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <button className="pill-btn" type="button" data-testid="usage-export-json" onClick={() => download("json")}>
          Export JSON
        </button>
        <button className="pill-btn" type="button" data-testid="usage-export-csv" onClick={() => download("csv")}>
          Export CSV
        </button>
      </div>
      {rows.length === 0 && (
        <p className="micro" data-testid="usage-empty">
          {offline
            ? "Unmetered / harness-offline. Attach a bot when OpenCode is up to record tokens."
            : "No meter events yet. A ship-train wake records Channel and specialist rows here."}
        </p>
      )}
      {leaked && (
        <p className="micro" data-testid="usage-key-leak" style={{ color: "var(--deny)" }}>
          Unexpected secret field in usage log.
        </p>
      )}
      {bySeat.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }} data-testid="usage-by-seat">
          {bySeat.map(([id, tokens]) => {
            const seat = seats.find((s) => s.id === id);
            return (
              <div className="kv" key={id} data-testid={`usage-seat-${id}`}>
                <span>{seat?.name || id}</span>
                <b>{tokens} tok</b>
              </div>
            );
          })}
        </div>
      )}
      {rows.slice(-40).reverse().map((row) => (
        <div className="card" key={row.id} data-testid={`usage-row-${row.id}`} style={{ marginBottom: 8 }}>
          <div className="kv">
            <span>{row.seatId}</span>
            <b>
              {row.tokens} tok · ${row.usdEstimate ?? 0}
            </b>
          </div>
          <p className="micro">
            {row.model || "—"} · {row.projectId || "org"} · {row.teamId ? `@${row.teamId}` : "no team"} · {row.hours || 0}h
          </p>
        </div>
      ))}
    </section>
  );
}
