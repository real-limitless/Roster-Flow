import type { Task } from "../../data";

export function TaskBoard({
  tasks,
  onClaim,
  onComplete,
}: {
  tasks: Task[];
  onClaim: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  if (!tasks.length) return null;
  return (
    <div className="task-board" data-testid="task-board">
      <div className="micro" style={{ marginBottom: 8 }}>
        Run card · claim locks · depend_on
      </div>
      {tasks.map((t) => (
        <div key={t.id} className="task-row" data-testid={`task-row-${t.id}`} data-status={t.status}>
          <div>
            <b>{t.title}</b>
            <p className="micro">
              {t.status}
              {t.claimedBy ? ` · @${t.claimedBy}` : t.ownerSeatId ? ` · ${t.ownerSeatId}` : ""}
              {t.status === "pending" && (t.dependOn || []).length ? ` · blocked by ${(t.dependOn || []).join(", ")}` : ""}
            </p>
          </div>
          <div className="settings-actions">
            {t.status === "pending" && (
              <button type="button" className="pill-btn" data-testid={`task-claim-${t.id}`} onClick={() => onClaim(t.id)}>
                Claim
              </button>
            )}
            {t.status === "claimed" && (
              <button type="button" className="pill-btn" data-testid={`task-complete-${t.id}`} onClick={() => onComplete(t.id)}>
                Complete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
