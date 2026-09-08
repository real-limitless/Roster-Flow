import type { Block, ButtonElement, TextObject } from "roster-flow-blocks";
import { fallbackText } from "roster-flow-blocks";
import type { Msg } from "../../data";

export type BlockAction = { actionId: string; value?: string; url?: string };

export function MessageBlocks({
  msg,
  onAction,
}: {
  msg: Pick<Msg, "id" | "blocks">;
  onAction?: (action: BlockAction) => void;
}) {
  const blocks = msg.blocks || [];
  if (!blocks.length) return null;
  return (
    <div className="rf-blocks" data-testid={`blocks-${msg.id}`}>
      {blocks.map((block, i) => (
        <BlockView key={`${msg.id}-${i}-${block.type}`} block={block} msgId={msg.id} onAction={onAction} />
      ))}
    </div>
  );
}

export function shouldHideFallback(msg: Pick<Msg, "text" | "blocks">) {
  if (!msg.blocks?.length) return false;
  return !msg.text || msg.text === fallbackText(msg.blocks);
}

function BlockView({
  block,
  msgId,
  onAction,
}: {
  block: Block;
  msgId: string;
  onAction?: (action: BlockAction) => void;
}) {
  if (block.type === "divider") return <hr className="rf-block-divider" />;
  if (block.type === "header") return <div className="rf-block-header">{block.text.text}</div>;
  if (block.type === "markdown") return <div className="rf-block-md">{renderRich(block.text)}</div>;
  if (block.type === "image") {
    return (
      <figure className="rf-block-figure">
        {block.title && <figcaption>{block.title.text}</figcaption>}
        <img className="rf-block-image" src={block.image_url} alt={block.alt_text} />
      </figure>
    );
  }
  if (block.type === "context") {
    return (
      <div className="rf-block-context">
        {block.elements.map((el, i) =>
          el.type === "image" ? (
            <img key={i} className="rf-block-context-img" src={el.image_url} alt={el.alt_text} />
          ) : (
            <span key={i}>{renderRich(el.text)}</span>
          ),
        )}
      </div>
    );
  }
  if (block.type === "actions") {
    return (
      <div className="rf-block-actions">
        {block.elements.map((el, i) => (
          <BlockButton key={i} el={el} msgId={msgId} onAction={onAction} />
        ))}
      </div>
    );
  }
  if (block.type === "section") {
    return (
      <div className="rf-block-section">
        <div className="rf-block-section-main">
          {block.text && <div className="rf-block-md">{renderRich(block.text.text)}</div>}
          {block.fields && block.fields.length > 0 && (
            <div className="rf-block-fields">
              {block.fields.map((f: TextObject, i) => (
                <div key={i} className="rf-block-md">
                  {renderRich(f.text)}
                </div>
              ))}
            </div>
          )}
        </div>
        {block.accessory && <BlockButton el={block.accessory} msgId={msgId} onAction={onAction} />}
      </div>
    );
  }
  return null;
}

function BlockButton({
  el,
  msgId,
  onAction,
}: {
  el: ButtonElement;
  msgId: string;
  onAction?: (action: BlockAction) => void;
}) {
  const label = el.text?.text || "Button";
  return (
    <button
      type="button"
      className={`rf-block-btn ${el.style || ""}`}
      data-testid={`block-btn-${el.action_id || label}`}
      onClick={(e) => {
        e.stopPropagation();
        if (el.url) {
          window.open(el.url, "_blank", "noopener,noreferrer");
          return;
        }
        if (el.action_id) onAction?.({ actionId: el.action_id, value: el.value, url: el.url });
      }}
    >
      {label}
    </button>
  );
}

function renderRich(text: string) {
  const parts = String(text).split(/(`[^`]+`|\*[^*\n]+\*|https?:\/\/\S+|<[^\s|>]+\|[^>]+>)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <strong key={i}>{part.slice(1, -1)}</strong>;
    }
    if (part.startsWith("<") && part.includes("|")) {
      const inner = part.slice(1, -1);
      const [href, label] = inner.split("|");
      return (
        <a key={i} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer">
          {part}
        </a>
      );
    }
    return part.split("\n").map((line, j, arr) => (
      <span key={`${i}-${j}`}>
        {line}
        {j < arr.length - 1 && <br />}
      </span>
    ));
  });
}
