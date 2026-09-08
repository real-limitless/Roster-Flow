import { FormEvent, useState } from "react";
import type { OrgPlan } from "./planPreview";
import { ChatDebugPanel } from "../chat/ChatDebugPanel";

export type ArchitectMsg = {
  id: string;
  role: "user" | "architect";
  text: string;
  plan?: OrgPlan;
  source?: string;
};

const CHIPS = [
  { id: "project", label: "Staff a project", text: "We’re starting a mobile app. Create a project and staff a team around it." },
  { id: "org", label: "Build a full org", text: "Create a full startup org for a billing SaaS." },
  { id: "layoff", label: "Suggest layoffs", text: "Who can we lay off if we pause Docs and Scout?" },
];

export function ArchitectDock({
  messages,
  busy,
  onSend,
  onApply,
  onRevise,
  showDebug = false,
}: {
  messages: ArchitectMsg[];
  busy: boolean;
  onSend: (text: string) => void;
  onApply: (plan: OrgPlan) => void;
  onRevise: () => void;
  showDebug?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const t = draft.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  }

  return (
    <aside className="architect-dock" data-testid="architect-dock">
      <div className="architect-head">
        <strong>Architect</strong>
        <span className="dim">{busy ? "System harness thinking…" : "System harness · propose · apply"}</span>
      </div>
      <div className="architect-chips">
        {CHIPS.map((c) => (
          <button key={c.id} type="button" className="pill-btn" data-testid={`architect-chip-${c.id}`} disabled={busy} onClick={() => onSend(c.text)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="architect-thread" data-testid="architect-thread">
        {messages.length === 0 && <p className="micro">Staff a project, reshape the org, or ask who to cut. Nothing lands until you Apply.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`architect-msg ${m.role}`} data-testid={`architect-msg-${m.role}`}>
            <b>{m.role === "user" ? "You" : "Architect"}</b>
            {m.source && !m.plan && (
              <span className={`chip ${m.source === "live" ? "ok" : ""}`} data-testid="architect-source">
                {m.source}
              </span>
            )}
            <p>{m.text}</p>
            {m.plan && (
              <PlanCard
                plan={m.plan}
                source={m.plan.source || m.source}
                busy={busy}
                onApply={() => onApply(m.plan!)}
                onRevise={onRevise}
              />
            )}
          </div>
        ))}
      </div>
      <form className="architect-compose" onSubmit={submit}>
        <input
          data-testid="architect-composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Staff mobile. Cut Scout."
          aria-label="Message Architect"
          disabled={busy}
        />
        <button className="pill-btn primary" data-testid="architect-send" type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
      {showDebug && <ChatDebugPanel scope="architect" compact />}
    </aside>
  );
}

function PlanCard({
  plan,
  source,
  busy,
  onApply,
  onRevise,
}: {
  plan: OrgPlan;
  source?: string;
  busy: boolean;
  onApply: () => void;
  onRevise: () => void;
}) {
  const replacing = plan.ops.some((o) => o.op === "replace_org");
  const hires = plan.ops.filter((o) => o.op === "hire" || o.op === "create_team" || o.op === "create_project");
  const fires = plan.ops.filter((o) => o.op === "fire");
  return (
    <div className="plan-card" data-testid="architect-plan">
      <div className="plan-card-head">
        <strong>{plan.summary}</strong>
        {source && (
          <span className={`chip ${source === "live" ? "ok" : ""}`} data-testid="architect-source">
            {source === "live" ? "live" : source}
          </span>
        )}
      </div>
      {plan.rationale?.length > 0 && (
        <ul>
          {plan.rationale.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="micro">
        {replacing ? "replace org · " : ""}
        {hires.length ? `${hires.length} add` : ""}
        {hires.length && fires.length ? " · " : ""}
        {fires.length ? `${fires.length} fire` : ""}
      </p>
      <div className="plan-actions">
        <button className="pill-btn primary" data-testid="architect-apply" type="button" disabled={busy || plan.status === "applied"} onClick={onApply}>
          {plan.status === "applied" ? "Applied" : "Apply"}
        </button>
        <button className="pill-btn" data-testid="architect-revise" type="button" disabled={busy} onClick={onRevise}>
          Revise
        </button>
      </div>
    </div>
  );
}
