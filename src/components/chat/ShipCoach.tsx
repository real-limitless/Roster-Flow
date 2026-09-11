import { SHIP_SENTENCE } from "../../lib/shipCoach";

export function ShipCoach({
  emptyOrg,
  onInsert,
  onSend,
  onOpenChart,
  onDismiss,
}: {
  emptyOrg: boolean;
  onInsert: () => void;
  onSend: () => void;
  onOpenChart: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside className="ship-coach" data-testid="ship-coach">
      <div className="ship-coach-copy">
        <strong>{emptyOrg ? "Staff the chart" : "First ship-train"}</strong>
        <p className="micro">
          {emptyOrg
            ? "Hire Product and Eng.Build, then send a sentence in #ship. You can stay harness-offline."
            : "Paste this sentence. Channel compiles it. Confirm deploy when asked. Works without OpenCode."}
        </p>
        {!emptyOrg && (
          <p className="micro" data-testid="ship-coach-sentence">
            {SHIP_SENTENCE}
          </p>
        )}
      </div>
      <div className="ship-coach-actions">
        {emptyOrg ? (
          <button type="button" className="pill-btn primary" data-testid="ship-coach-chart" onClick={onOpenChart}>
            Open Chart
          </button>
        ) : (
          <>
            <button type="button" className="pill-btn" data-testid="ship-coach-insert" onClick={onInsert}>
              Use this sentence
            </button>
            <button type="button" className="pill-btn primary" data-testid="ship-coach-send" onClick={onSend}>
              Send it
            </button>
          </>
        )}
        <button type="button" className="pill-btn" data-testid="ship-coach-dismiss" onClick={onDismiss}>
          Don’t show again
        </button>
      </div>
    </aside>
  );
}
