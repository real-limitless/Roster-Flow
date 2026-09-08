import { PointerEvent, useEffect, useState } from "react";

export const DOCK_KEY = "roster-flow.architect-dock";

export type DockLayout = {
  width: number;
  height: number;
  collapsed: boolean;
};

const WIDTH_MIN = 240;
const WIDTH_MAX = 480;
const HEIGHT_MIN = 160;
const HEIGHT_MAX = 420;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function loadDock(): DockLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(DOCK_KEY) || "{}") as Partial<DockLayout>;
    return {
      width: clamp(Number(raw.width) || 340, WIDTH_MIN, WIDTH_MAX),
      height: clamp(Number(raw.height) || 280, HEIGHT_MIN, HEIGHT_MAX),
      collapsed: Boolean(raw.collapsed),
    };
  } catch {
    return { width: 340, height: 280, collapsed: false };
  }
}

function saveDock(next: DockLayout) {
  try {
    localStorage.setItem(DOCK_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function useNarrowChart(query = "(max-width: 860px)") {
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [query]);
  return narrow;
}

export function ChartSplitter({
  dock,
  onChange,
  narrow,
}: {
  dock: DockLayout;
  onChange: (next: DockLayout) => void;
  narrow: boolean;
}) {
  const [dragging, setDragging] = useState(false);

  function persist(next: DockLayout) {
    saveDock(next);
    onChange(next);
  }

  function move(e: PointerEvent<HTMLButtonElement>) {
    if (!dragging && e.buttons === 0) return;
    if (narrow) {
      const nextH = clamp(window.innerHeight - e.clientY, HEIGHT_MIN - 40, HEIGHT_MAX);
      if (nextH < HEIGHT_MIN) persist({ ...dock, collapsed: true, height: HEIGHT_MIN });
      else persist({ ...dock, collapsed: false, height: nextH });
      return;
    }
    const nextW = clamp(window.innerWidth - e.clientX, WIDTH_MIN - 40, WIDTH_MAX);
    if (nextW < WIDTH_MIN) persist({ ...dock, collapsed: true, width: WIDTH_MIN });
    else persist({ ...dock, collapsed: false, width: nextW });
  }

  return (
    <button
      type="button"
      className={`chart-splitter ${narrow ? "horizontal" : "vertical"} ${dragging ? "dragging" : ""}`}
      data-testid="chart-splitter"
      aria-label={narrow ? "Resize Architect dock height" : "Resize Architect dock"}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={move}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    />
  );
}

export { saveDock };
