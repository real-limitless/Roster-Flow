import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { GithubCard, Msg } from "../../data";

const opened = new Set<string>();

export function GitHubPrCard({ msg }: { msg: Msg }) {
  const [note, setNote] = useState("");
  const card = msg.github;

  useEffect(() => {
    if (!msg.github) return;
    if (opened.has(msg.id)) return;
    opened.add(msg.id);
    void api.githubCard(msg.id).catch(() => undefined);
  }, [msg.id, msg.github]);

  if (!card) return null;

  async function run(actionId: string) {
    setNote("");
    try {
      await api.blockAction({ messageId: msg.id, actionId, userId: "you" });
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  }

  const stateLabel = card.stale ? "stale" : card.merged || card.state === "merged" ? "merged" : card.state;
  const showMerge = card.kind !== "issue" && !card.merged && card.state !== "merged";

  return (
    <div
      className={`gh-card ${card.stale ? "stale" : ""}`}
      data-testid={`github-card-${msg.id}`}
      data-stale={card.stale ? "1" : "0"}
      data-state={card.merged ? "merged" : card.state}
      data-kind={card.kind}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="gh-card-top">
        <span className={`chip gh-state ${card.stale ? "warn" : card.merged || card.state === "merged" ? "ok" : ""}`}>
          {stateLabel}
        </span>
        <a
          className="gh-title"
          href={card.url}
          target="_blank"
          rel="noreferrer"
          data-testid={`github-link-${msg.id}`}
        >
          {card.title || `${card.owner}/${card.repo}#${card.number}`}
        </a>
      </div>
      <p className="micro gh-meta">
        {card.owner}/{card.repo}#{card.number}
        {card.branch ? ` · ${card.branch}` : ""}
        {card.base ? ` → ${card.base}` : ""}
      </p>
      <p className="micro" data-testid={`github-checks-${msg.id}`}>
        {card.stale
          ? "GitHub disconnected — historical link still opens."
          : card.checks?.summary || "No checks yet"}
      </p>
      <div className="gh-card-actions">
        <button type="button" className="rf-block-btn" data-testid="github-refresh" onClick={() => void run("github.refresh")}>
          Refresh
        </button>
        {showMerge && (
          <button
            type="button"
            className="rf-block-btn primary"
            data-testid="github-merge"
            disabled={Boolean(card.stale)}
            onClick={() => void run("github.merge")}
          >
            Merge
          </button>
        )}
      </div>
      {note && (
        <p className="micro" data-testid="github-card-note">
          {note}
        </p>
      )}
    </div>
  );
}

export function githubLabel(card: GithubCard) {
  return card.title || `${card.owner}/${card.repo}#${card.number}`;
}
