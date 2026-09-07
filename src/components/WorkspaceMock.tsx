import { useMemo, useState } from "react";
import { OrgChart } from "./OrgChart";
import { seats, seedMessages, runSteps } from "../data";
import { ComposerPreview } from "./chat/Composer";
import { MessageRow } from "./chat/MessageRow";

export type Mode = "room" | "harness" | "chart";

export function WorkspaceMock({ compact = false, initialMode = "room" }: { compact?: boolean; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState(2);
  const liveId = runSteps[Math.min(step, runSteps.length - 1)]?.id;

  return (
    <div className="frame" aria-label="Roster-flow workspace">
      <div className="frame-bar">
        <div className="seg" role="tablist">
          {(["room", "harness", "chart"] as Mode[]).map((m) => (
            <button key={m} data-testid={`mock-mode-${m}`} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <span className="mono" style={{ color: "var(--muted)", fontSize: 11, marginLeft: "auto" }}>
          #ship · run ship-billing · ses_8f2
        </span>
      </div>
      {mode === "room" && <RoomPreview step={step} />}
      {mode === "harness" && <HarnessPreview />}
      {mode === "chart" && <ChartPreview liveId={liveId} onSeat={() => setMode("harness")} />}
      {!compact && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--hair)", display: "flex", gap: 8 }}>
          <button className="pill-btn" onClick={() => setStep((s) => Math.min(s + 1, runSteps.length - 1))}>
            Advance run
          </button>
          <button className="pill-btn" onClick={() => setStep(0)}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

function RoomPreview({ step }: { step: number }) {
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
          <MessageRow
            key={m.id}
            msg={m}
            roster={seats}
            extra={m.run ? <RunCard step={step} /> : null}
            onOpenSeat={() => undefined}
          />
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

function RunCard({ step }: { step: number }) {
  return (
    <div className="run-card">
      <div className="title">Pipeline ship-billing · Floor compiled</div>
      <div className="steps">
        {runSteps.map((s, i) => (
          <span key={s.id} className={`step ${i < step ? "done" : i === step ? "live" : ""}`}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function HarnessPreview() {
  const lines = useMemo(
    () => [
      { c: "dim", t: "opencode attach eng.build  ·  session ses_8f2  ·  worktree billing-fix" },
      { c: "am", t: "agent  Eng.Build  model  anthropic/claude-sonnet" },
      { c: "bl", t: "tool  read   billing/webhook.ts" },
      { c: "bl", t: "tool  edit   billing/webhook.ts  +idempotency key on Stripe event" },
      { c: "bl", t: "tool  bash   npm test -- billing/webhook.test.ts" },
      { c: "gn", t: "ok    14/14 passing" },
      { c: "am", t: "handoff → Eng.Review  PR #482" },
      { c: "dim", t: "▌" },
    ],
    []
  );
  return (
    <div className="frame-body harness">
      <div className="rail">
        <div className="ch on">ses_8f2 eng.build</div>
        <div className="ch">ses_8e1 product</div>
        <div className="ch">ses_7c0 devops</div>
      </div>
      <div className="tui">
        {lines.map((l, i) => (
          <div key={i} className={`line ${l.c}`}>
            {l.t}
          </div>
        ))}
      </div>
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

