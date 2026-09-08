import { useState } from "react";
import { OrgChart } from "./OrgChart";
import { HarnessTerm } from "./HarnessTerm";
import { seats, seedMessages, teams, projects } from "../data";
import { ComposerPreview } from "./chat/Composer";
import { MessageRow } from "./chat/MessageRow";

export type Mode = "room" | "harness" | "chart";

export function WorkspaceMock({ compact = false, initialMode = "room" }: { compact?: boolean; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);

  return (
    <div className={compact ? "frame compact" : "frame"} aria-label="Roster-flow workspace">
      <div className="frame-bar">
        <div className="seg" role="tablist">
          {(["room", "harness", "chart"] as Mode[]).map((m) => (
            <button key={m} data-testid={`mock-mode-${m}`} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <span className="mono" style={{ color: "var(--muted)", fontSize: 11, marginLeft: "auto" }}>
          #ship · Block Kit · ses_8f2
        </span>
      </div>
      {mode === "room" && <RoomPreview />}
      {mode === "harness" && <HarnessPreview />}
      {mode === "chart" && <ChartPreview liveId="build" onSeat={() => setMode("harness")} />}
    </div>
  );
}

function RoomPreview() {
  const msgs = seedMessages.filter((m) => m.channel === "ship");
  return (
    <div className="frame-body room">
      <div className="rail">
        <div className="ch"># general</div>
        <div className="ch on"># ship</div>
        <div className="ch"># incidents</div>
        <div className="ch"># eng-agents</div>
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>TEAMS</div>
        <div className="ch">@eng</div>
        <div className="ch">@qa</div>
      </div>
      <div className="main room-preview-main">
        {msgs.map((m) => (
          <MessageRow key={m.id} msg={m} roster={seats} onOpenSeat={() => undefined} />
        ))}
        <ComposerPreview channelName="#ship" />
      </div>
      <div className="side">
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>ROSTER</div>
        {seats.slice(0, 7).map((s) => (
          <div key={s.id} className="ch">
            <span className={`pip ${s.kind === "bot" ? "on" : ""}`} style={{ display: "inline-block", width: 6, height: 6, borderRadius: 99, background: s.kind === "bot" ? "var(--green)" : "var(--muted)", marginRight: 6 }} />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function HarnessPreview() {
  const bots = seats.filter((s) => s.kind === "bot" && !s.system);
  const [seatId, setSeatId] = useState("build");
  const seat = seats.find((s) => s.id === seatId) || bots[0];
  return (
    <div className="frame-body harness">
      <div className="rail">
        {bots.slice(0, 8).map((s) => (
          <div
            key={s.id}
            className={`ch ${s.id === seat.id ? "on" : ""}`}
            data-testid={`mock-harness-seat-${s.id}`}
            onClick={() => setSeatId(s.id)}
          >
            {s.name}
          </div>
        ))}
      </div>
      <HarnessTerm seat={seat} />
    </div>
  );
}

function ChartPreview({ liveId, onSeat }: { liveId?: string; onSeat: () => void }) {
  const [showSystem, setShowSystem] = useState(false);
  return (
    <div className="frame-body chart">
      <div className="chart-canvas">
        <label className="check">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
          Show system seats
        </label>
        <OrgChart
          roster={seats}
          teams={teams}
          projects={projects}
          showSystem={showSystem}
          liveId={liveId}
          selectedId={liveId || "build"}
          onSelect={() => onSeat()}
          onAttach={onSeat}
        />
      </div>
      <div className="side">
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>SEAT</div>
        <div className="seat live">Eng.Build</div>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          Reports to Jules
          <br />
          Tools: read edit bash lsp
          <br />
          Deny: deploy
        </p>
        <button className="pill-btn primary" onClick={onSeat}>
          Attach harness
        </button>
      </div>
    </div>
  );
}
