import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { displayParentId, isServiceSeat, type Seat } from "../data";

type Line = { x1: number; y1: number; x2: number; y2: number; live: boolean; childId: string };

export function OrgChart({
  roster,
  showSystem,
  liveId,
  selectedId,
  onSelect,
  onAttach,
}: {
  roster: Seat[];
  showSystem: boolean;
  liveId?: string;
  selectedId: string;
  onSelect: (s: Seat) => void;
  onAttach?: (s: Seat) => void;
}) {
  const treeSeats = roster.filter((s) => (showSystem || !s.system) && !isServiceSeat(s));
  const services = roster.filter((s) => isServiceSeat(s) && (showSystem || !s.system));
  const roots = treeSeats.filter((s) => {
    const p = displayParentId(s, roster, showSystem);
    return !p || !treeSeats.some((x) => x.id === p);
  });

  function kids(id: string) {
    return treeSeats.filter((s) => displayParentId(s, roster, showSystem) === id);
  }

  const canvasRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [box, setBox] = useState({ w: 800, h: 600 });

  const measure = useCallback(() => {
    const root = canvasRef.current;
    if (!root) return;
    const crate = root.getBoundingClientRect();
    const visible = roster.filter((s) => (showSystem || !s.system) && !isServiceSeat(s));
    const ids = new Set(visible.map((s) => s.id));
    const next: Line[] = [];
    for (const seat of visible) {
      const parentId = displayParentId(seat, roster, showSystem);
      if (!parentId || !ids.has(parentId)) continue;
      const a = root.querySelector<HTMLElement>(`[data-seat-id="${parentId}"]`);
      const b = root.querySelector<HTMLElement>(`[data-seat-id="${seat.id}"]`);
      if (!a || !b) continue;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      next.push({
        x1: ar.left + ar.width / 2 - crate.left + root.scrollLeft,
        y1: ar.bottom - crate.top + root.scrollTop,
        x2: br.left + br.width / 2 - crate.left + root.scrollLeft,
        y2: br.top - crate.top + root.scrollTop,
        live: liveId === seat.id || liveId === parentId,
        childId: seat.id,
      });
    }
    setLines((prev) => (sameLines(prev, next) ? prev : next));
    const nextBox = { w: Math.max(root.scrollWidth, crate.width), h: Math.max(root.scrollHeight, crate.height) };
    setBox((prev) => (Math.abs(prev.w - nextBox.w) < 1 && Math.abs(prev.h - nextBox.h) < 1 ? prev : nextBox));
  }, [roster, showSystem, liveId]);

  useLayoutEffect(() => {
    measure();
    const root = canvasRef.current;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    if (root && ro) ro.observe(root);
    window.addEventListener("resize", measure);
    const t = window.setTimeout(measure, 50);
    const t2 = window.setTimeout(measure, 200);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [measure]);

  function Node({ seat }: { seat: Seat }) {
    const children = kids(seat.id);
    return (
      <div className="org-node">
        <SeatBtn seat={seat} selectedId={selectedId} liveId={liveId} onSelect={onSelect} onAttach={onAttach} />
        {children.length > 0 && (
          <div className="org-children">
            {children.map((c) => (
              <Node key={c.id} seat={c} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="org-chart" data-testid="org-chart" ref={canvasRef}>
      <svg className="org-connectors" data-testid="org-connectors" width={box.w} height={box.h} aria-hidden>
        {lines.map((ln) => {
          const midY = (ln.y1 + ln.y2) / 2;
          const d = `M ${ln.x1} ${ln.y1} V ${midY} H ${ln.x2} V ${ln.y2}`;
          return (
            <path
              key={`${ln.childId}-${ln.x1}-${ln.y2}`}
              d={d}
              className={ln.live ? "org-line live" : "org-line"}
              data-testid="org-line"
              data-child={ln.childId}
            />
          );
        })}
      </svg>
      <div className="org-tree">
        {roots.map((r) => (
          <Node key={r.id} seat={r} />
        ))}
      </div>
      {services.length > 0 && (
        <>
          <div className="services-label">Services lane</div>
          <div className="services">
            {services.map((s) => (
              <SeatBtn key={s.id} seat={s} selectedId={selectedId} liveId={liveId} onSelect={onSelect} onAttach={onAttach} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function sameLines(a: Line[], b: Line[]) {
  if (a.length !== b.length) return false;
  return a.every((ln, i) => {
    const o = b[i];
    return (
      Math.abs(ln.x1 - o.x1) < 0.5 &&
      Math.abs(ln.y1 - o.y1) < 0.5 &&
      Math.abs(ln.x2 - o.x2) < 0.5 &&
      Math.abs(ln.y2 - o.y2) < 0.5 &&
      ln.live === o.live &&
      ln.childId === o.childId
    );
  });
}

function SeatBtn({
  seat,
  selectedId,
  liveId,
  onSelect,
  onAttach,
}: {
  seat: Seat;
  selectedId: string;
  liveId?: string;
  onSelect: (s: Seat) => void;
  onAttach?: (s: Seat) => void;
}) {
  return (
    <button
      type="button"
      data-seat-id={seat.id}
      data-testid={`seat-${seat.id}`}
      className={`seat ${seat.kind === "human" ? "human" : ""} ${selectedId === seat.id ? "live" : ""} ${seat.system ? "system" : ""}`}
      onClick={() => onSelect(seat)}
      onDoubleClick={() => onAttach?.(seat)}
    >
      <span className={`pip ${liveId === seat.id ? "run" : "on"}`} />
      {seat.name}
      <div style={{ color: "var(--muted)", fontSize: 10 }}>
        {seat.role}
        {seat.kind === "human" ? " · human" : ""}
        {seat.system ? " · system" : ""}
      </div>
    </button>
  );
}
