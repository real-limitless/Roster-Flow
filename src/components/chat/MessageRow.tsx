import type { ReactNode } from "react";
import { fileTestId, seatForMessage, type Msg, type Seat } from "../../data";
import { SeatAvatar } from "../SeatAvatar";
import { GitHubPrCard } from "./GitHubPrCard";
import { MessageBlocks, shouldHideFallback, type BlockAction } from "./MessageBlocks";

export function MessageRow({
  msg,
  roster,
  selected,
  extra,
  onOpenSeat,
  onBlockAction,
}: {
  msg: Msg;
  roster: Seat[];
  selected?: boolean;
  extra?: ReactNode;
  onOpenSeat: (seatId: string) => void;
  onBlockAction?: (msg: Msg, action: BlockAction) => void;
}) {
  const seat = seatForMessage(msg, roster);
  const seatId = seat?.id;

  function open() {
    if (seatId) onOpenSeat(seatId);
  }

  return (
    <article
      className={`msg ${selected ? "on" : ""} ${seatId ? "clickable" : ""} ${msg.system ? "system" : ""}`}
      data-testid={`message-${msg.id}`}
      onClick={open}
    >
      <SeatAvatar seed={seatId || msg.who} kind={msg.kind} />
      <div>
        <div>
          <button
            type="button"
            className="who"
            data-testid={`message-who-${msg.id}`}
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
          >
            {msg.who}
          </button>
          <span className="meta">{msg.time}</span>
          {threadCaption(msg) && (
            <span className="meta thread-caption" data-testid={`msg-thread-caption-${msg.id}`}>
              {threadCaption(msg)}
            </span>
          )}
        </div>
        {msg.text && !shouldHideFallback(msg) && <div className="body">{renderMentions(msg.text)}</div>}
        <GitHubPrCard msg={msg} />
        <MessageBlocks msg={msg} onAction={onBlockAction ? (action) => onBlockAction(msg, action) : undefined} />
        <MessageChips msg={msg} />
        {extra}
      </div>
    </article>
  );
}

function renderMentions(text: string) {
  const parts = text.split(/(@[A-Za-z0-9._-]+)/g);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <span key={`${part}-${i}`} className="mention">
        {part}
      </span>
    ) : (
      <span key={`${part}-${i}`}>{part}</span>
    ),
  );
}

export function threadCaption(msg: Msg): string {
  const t = msg.thread;
  if (!t || t.hop < 1) return "";
  return `↳ from @${t.from || "?"} · hop ${t.hop}/${t.maxHops}`;
}

export function threadBudgetLow(msg: Msg): boolean {
  const t = msg.thread;
  return Boolean(t && t.maxBotWakes > 0 && t.botWakes > t.maxBotWakes / 2);
}

function MessageChips({ msg }: { msg: Msg }) {
  const skills = msg.skills || [];
  const files = msg.files || [];
  const attachments = msg.attachments || [];
  const viaSlack = Boolean(msg.slack?.inbound);
  const budget = threadBudgetLow(msg);
  const delegation = msg.delegation;
  if (!skills.length && !files.length && !attachments.length && !viaSlack && !budget && !delegation) return null;
  return (
    <div className="msg-chips">
      {delegation && (
        <span className="chip" data-testid={`msg-delegation-${msg.id}`}>
          task → {delegation.childSeatId}
        </span>
      )}
      {budget && msg.thread && (
        <span className="chip warn" data-testid={`msg-thread-budget-${msg.id}`}>
          thread {msg.thread.botWakes}/{msg.thread.maxBotWakes} bot wakes
        </span>
      )}
      {viaSlack && (
        <span className="chip" data-testid={`chip-slack-${msg.id}`}>
          via Slack
        </span>
      )}
      {skills.map((s) => (
        <span className="chip ok" key={s.id} data-testid={`chip-skill-${s.id}`}>
          skill:{s.name}
        </span>
      ))}
      {files.map((f) => (
        <span className="chip" key={f.path} data-testid={`chip-file-${fileTestId(f.path)}`}>
          {f.path}
        </span>
      ))}
      {attachments.map((a) => (
        <span className="chip" key={a.id} data-testid={`chip-att-${a.id}`}>
          {a.name}
        </span>
      ))}
    </div>
  );
}
