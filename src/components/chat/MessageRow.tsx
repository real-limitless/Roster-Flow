import type { ReactNode } from "react";
import { fileTestId, seatForMessage, type Msg, type Seat } from "../../data";

export function MessageRow({
  msg,
  roster,
  selected,
  extra,
  onOpenSeat,
}: {
  msg: Msg;
  roster: Seat[];
  selected?: boolean;
  extra?: ReactNode;
  onOpenSeat: (seatId: string) => void;
}) {
  const seat = seatForMessage(msg, roster);
  const seatId = seat?.id;

  function open() {
    if (seatId) onOpenSeat(seatId);
  }

  return (
    <article
      className={`msg ${selected ? "on" : ""} ${seatId ? "clickable" : ""}`}
      data-testid={`message-${msg.id}`}
      onClick={open}
    >
      <div className={`av ${msg.kind}`}>{msg.who.slice(0, 2)}</div>
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
        </div>
        {msg.text && <div className="body">{msg.text}</div>}
        <MessageChips msg={msg} />
        {extra}
      </div>
    </article>
  );
}

function MessageChips({ msg }: { msg: Msg }) {
  const skills = msg.skills || [];
  const files = msg.files || [];
  const attachments = msg.attachments || [];
  if (!skills.length && !files.length && !attachments.length) return null;
  return (
    <div className="msg-chips">
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
