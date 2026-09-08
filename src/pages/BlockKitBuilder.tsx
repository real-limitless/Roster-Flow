import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BLOCK_TYPES, defaultBlock, fallbackText, templates, validateBlocks, type Block } from "roster-flow-blocks";
import { Logo } from "../components/Logo";
import { MessageBlocks } from "../components/chat/MessageBlocks";
import { api } from "../lib/api";

const PALETTE = BLOCK_TYPES.map((type) => ({
  type,
  label: type[0].toUpperCase() + type.slice(1),
}));

function encode(blocks: Block[]) {
  return JSON.stringify({ blocks }, null, 2);
}

export function BlockKitBuilder() {
  const starter = templates.approval.blocks;
  const [blocks, setBlocks] = useState<Block[]>(starter);
  const [jsonText, setJsonText] = useState(encode(starter));
  const [jsonError, setJsonError] = useState("");
  const [posted, setPosted] = useState("");
  const [sendError, setSendError] = useState("");

  const preview = useMemo(() => validateBlocks(blocks), [blocks]);

  function applyBlocks(next: Block[]) {
    const v = validateBlocks(next);
    if (v.ok) {
      setBlocks(v.blocks);
      setJsonText(encode(v.blocks));
      setJsonError("");
    } else {
      setBlocks(next);
      setJsonText(encode(next));
      setJsonError(v.errors[0] || "invalid blocks");
    }
  }

  function onJsonChange(text: string) {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : parsed.blocks;
      const v = validateBlocks(arr);
      if (!v.ok) {
        setJsonError(v.errors[0] || "invalid blocks");
        return;
      }
      setBlocks(v.blocks);
      setJsonError("");
    } catch {
      setJsonError("Invalid JSON");
    }
  }

  async function sendToShip() {
    setSendError("");
    setPosted("");
    const v = validateBlocks(blocks);
    if (!v.ok) {
      setSendError(v.errors[0] || "invalid blocks");
      return;
    }
    try {
      await api.postMessage("ship", fallbackText(v.blocks), { who: "You", seatId: "you", blocks: v.blocks });
      setPosted("Posted to #ship");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not post");
    }
  }

  return (
    <div className="app-shell bk-shell" data-testid="block-kit-builder">
      <div className="app-top">
        <Logo to="/" />
        <span className="mono app-meta">Roster Block Kit</span>
        <div className="app-desktop-actions">
          <button className="pill-btn primary" type="button" data-testid="send-blocks" onClick={() => void sendToShip()}>
            Send to #ship
          </button>
          <Link to="/app" className="pill-btn">
            Workspace
          </Link>
        </div>
      </div>
      <div className="bk-body">
        <aside className="bk-palette">
          <div className="rail-label">Templates</div>
          {Object.values(templates).map((t) => (
            <button
              key={t.id}
              type="button"
              className="pill-btn"
              style={{ width: "100%", marginBottom: 6 }}
              data-testid={`template-${t.id}`}
              onClick={() => applyBlocks(t.blocks)}
            >
              {t.name}
            </button>
          ))}
          <div className="rail-label" style={{ marginTop: 16 }}>
            Add block
          </div>
          {PALETTE.map((p) => (
            <button
              key={p.type}
              type="button"
              className="pill-btn"
              style={{ width: "100%", marginBottom: 6 }}
              data-testid={`add-block-${p.type}`}
              onClick={() => applyBlocks([...blocks, defaultBlock(p.type)])}
            >
              {p.label}
            </button>
          ))}
        </aside>
        <section className="bk-preview" data-testid="block-preview">
          <div className="rail-label">Preview</div>
          {preview.ok ? (
            <article className="msg">
              <div>
                <div>
                  <span className="who">Channel</span>
                  <span className="meta">now</span>
                </div>
                <MessageBlocks msg={{ id: "preview", blocks: preview.blocks }} />
              </div>
            </article>
          ) : (
            <p className="micro" style={{ color: "var(--deny)" }}>
              {preview.errors[0]}
            </p>
          )}
          {posted && (
            <p className="micro" style={{ color: "var(--phosphor)", marginTop: 12 }}>
              {posted} · <Link to="/app">Open room</Link>
            </p>
          )}
          {sendError && (
            <p className="micro" style={{ color: "var(--deny)", marginTop: 12 }}>
              {sendError}
            </p>
          )}
        </section>
        <section className="bk-json">
          <div className="rail-label" style={{ padding: "12px 12px 0" }}>
            JSON
          </div>
          <textarea
            data-testid="block-json"
            spellCheck={false}
            value={jsonText}
            onChange={(e) => onJsonChange(e.target.value)}
            aria-label="Block Kit JSON"
          />
          {jsonError && (
            <p className="micro" style={{ color: "var(--deny)", padding: "0 12px 12px" }}>
              {jsonError}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
