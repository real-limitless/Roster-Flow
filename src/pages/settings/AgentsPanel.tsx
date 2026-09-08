import { Link } from "react-router-dom";
import type { Seat } from "../../data";

function modeFor(seat: Seat) {
  return seat.seatType === "supervisor" ? "primary" : "all";
}

function serveFor(seat: Seat) {
  return seat.system ? "system" : "company";
}

export function AgentsPanel({ seats }: { seats: Seat[] }) {
  const bots = seats.filter((s) => s.kind === "bot");

  return (
    <section className="settings-pane" data-testid="settings-agents">
      <div className="settings-head">
        <h1>Agents</h1>
        <p className="micro">
          Seats on the Chart are the OpenCode agents. Hire and patch write <code>.opencode/agents/*.md</code>. This list
          does not edit them.
        </p>
        <Link to="/app?mode=chart" className="pill-btn primary">
          Open Chart
        </Link>
      </div>
      {bots.length === 0 && <p className="micro">No bot seats yet. Hire from the Chart.</p>}
      <div className="settings-grid">
        {bots.map((seat) => (
          <div className="card" key={seat.id} data-testid={`agent-card-${seat.id}`}>
            <h3>
              {seat.name} <span className="chip">{modeFor(seat)}</span>
            </h3>
            <p className="micro">
              {seat.id} · {seat.role}
            </p>
            <div className="kv">
              <span>Model</span>
              <b>{seat.model || "—"}</b>
            </div>
            <div className="kv">
              <span>Harness</span>
              <b>{serveFor(seat)}</b>
            </div>
            <div className="kv">
              <span>Job</span>
              <b>{seat.job || "—"}</b>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
