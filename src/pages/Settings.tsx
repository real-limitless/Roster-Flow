import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { seats as seedSeats, type Seat } from "../data";
import { api } from "../lib/api";
import { AccountPanel } from "./settings/AccountPanel";
import { AgentsPanel } from "./settings/AgentsPanel";
import { FamilyPanel } from "./settings/FamilyPanel";
import { HarnessPanel } from "./settings/HarnessPanel";
import { ProvidersPanel } from "./settings/ProvidersPanel";
import { RoutinesPanel } from "./settings/RoutinesPanel";
import type { HarnessStatus, Provider, SettingsPane } from "./settings/types";

const PANES: Array<[SettingsPane, string]> = [
  ["providers", "Providers"],
  ["harness", "Harness"],
  ["agents", "Agents"],
  ["routines", "Routines"],
  ["family", "Family"],
];

export function Settings() {
  const [pane, setPane] = useState<SettingsPane>("providers");
  const [railOpen, setRailOpen] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [harness, setHarness] = useState<HarnessStatus | null>(null);
  const [seats, setSeats] = useState<Seat[]>(seedSeats);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function refresh() {
    try {
      const [p, h, s] = await Promise.all([
        api.providers(),
        api.harness().catch(() => ({ harness: "offline" as const, systemHarness: { harness: "offline" as const } })),
        api.seats().catch(() => seedSeats),
      ]);
      setProviders(p);
      setHarness(h);
      if (Array.isArray(s) && s.length) setSeats(s);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "API offline — start npm run standup");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const company = harness?.harness || "offline";
  const system = harness?.systemHarness?.harness || "offline";

  return (
    <div className="app-shell settings-shell" data-testid="settings-page">
      <div className="app-top">
        <button
          className="pill-btn app-nav-toggle"
          onClick={() => setRailOpen((v) => !v)}
          aria-label="Settings sections"
        >
          Sections
        </button>
        <Logo to="/" />
        <span className="mono app-meta">
          Settings · company {company} · system {system}
        </span>
        <div className="app-desktop-actions">
          <Link to="/app" className="pill-btn">
            Workspace
          </Link>
        </div>
      </div>
      {railOpen && <button className="scrim" aria-label="Close sections" onClick={() => setRailOpen(false)} />}
      <div className="app-body settings-body">
        <aside className={`rail ${railOpen ? "open" : ""}`}>
          <div className="rail-label">OpenCode</div>
          {PANES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`settings-nav-${id}`}
              className={`ch ${pane === id ? "on" : ""}`}
              onClick={() => {
                setPane(id);
                setRailOpen(false);
                setOk("");
              }}
            >
              {label}
            </button>
          ))}
          <div className="rail-label">You</div>
          <button
            type="button"
            data-testid="settings-nav-account"
            className={`ch ${pane === "account" ? "on" : ""}`}
            onClick={() => {
              setPane("account");
              setRailOpen(false);
              setOk("");
            }}
          >
            Account
          </button>
        </aside>
        <main className="settings-main">
          {err && (
            <p className="micro" style={{ color: "var(--deny)" }}>
              {err}
            </p>
          )}
          {ok && (
            <p className="micro" style={{ color: "var(--phosphor)" }}>
              {ok}
            </p>
          )}
          {pane === "harness" && (
            <HarnessPanel status={harness} onChanged={refresh} onError={setErr} />
          )}
          {pane === "providers" && (
            <ProvidersPanel
              providers={providers}
              onChanged={refresh}
              onError={setErr}
              onOk={setOk}
            />
          )}
          {pane === "agents" && <AgentsPanel seats={seats} />}
          {pane === "routines" && <RoutinesPanel seats={seats} onError={setErr} />}
          {pane === "family" && <FamilyPanel />}
          {pane === "account" && <AccountPanel onError={setErr} onOk={setOk} />}
        </main>
      </div>
    </div>
  );
}
