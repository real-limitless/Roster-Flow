import { PointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Tree, { type CustomNodeElementProps, type TreeLinkDatum } from "react-d3-tree";
import { type Project, type Seat, type Team } from "../data";
import { budgetPaused } from "../lib/budget";
import { SeatAvatar } from "./SeatAvatar";
import type { ChartPreview } from "./chart/planPreview";
import { buildOrgTree, toRawNodeDatum, type OrgTreeNode } from "./chart/orgTreeData";
import { ORG_NODE_SIZE, ORG_SEPARATION, orgStepPath } from "./chart/orgPath";

export const COLLAPSED_KEY = "roster-flow.chart-collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(ids: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore quota */
  }
}

function indexNodes(node: OrgTreeNode, map = new Map<string, OrgTreeNode>()) {
  map.set(node.id, node);
  for (const c of node.children) indexNodes(c, map);
  return map;
}

function cssId(id: string) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function OrgChart({
  roster,
  teams = [],
  projects = [],
  showSystem,
  liveId,
  selectedId,
  selectedTeamId = null,
  selectedProjectId = null,
  preview,
  resetLayoutKey = 0,
  onSelect,
  onSelectTeam,
  onSelectProject,
  onAttach,
  unreadBySeat = {},
}: {
  roster: Seat[];
  teams?: Team[];
  projects?: Project[];
  showSystem: boolean;
  liveId?: string;
  selectedId: string;
  selectedTeamId?: string | null;
  selectedProjectId?: string | null;
  preview?: ChartPreview;
  resetLayoutKey?: number;
  onSelect: (s: Seat) => void;
  onSelectTeam?: (t: Team) => void;
  onSelectProject?: (p: Project) => void;
  onAttach?: (s: Seat) => void;
  unreadBySeat?: Record<string, number>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fittingRef = useRef(false);
  const viewLocked = useRef(false);
  const lastFitKey = useRef(-1);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const zoomRef = useRef(0.7);
  const translateRef = useRef({ x: 400, y: 48 });
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [translate, setTranslate] = useState({ x: 400, y: 48 });
  const [zoom, setZoom] = useState(0.7);
  const [treeKey, setTreeKey] = useState(0);
  const [fitted, setFitted] = useState(false);
  const [panning, setPanning] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(loadCollapsed);
  zoomRef.current = zoom;
  translateRef.current = translate;

  function isChartControl(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("button, input, textarea, select, a, .tree-card"));
  }

  const tree = useMemo(
    () => buildOrgTree(roster, teams, projects, preview, showSystem),
    [roster, teams, projects, preview, showSystem],
  );
  const byId = useMemo(() => indexNodes(tree), [tree]);
  const data = useMemo(() => toRawNodeDatum(tree, collapsedIds), [tree, collapsedIds]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(320, r.width);
      const h = Math.max(360, r.height);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => ro?.disconnect();
  }, [treeKey]);

  const fitTree = useCallback(() => {
    if (viewLocked.current) return false;
    const wrap = wrapRef.current;
    const g = wrap?.querySelector<SVGGElement>(".rd3t-g, svg g");
    if (!wrap || !g) return false;
    let bbox: DOMRect;
    try {
      bbox = g.getBBox();
    } catch {
      return false;
    }
    if (bbox.width < 8 || bbox.height < 8) return false;
    const wr = wrap.getBoundingClientRect();
    const padX = 20;
    const padY = 16;
    const scale = Math.max(0.28, Math.min((wr.width - padX * 2) / bbox.width, (wr.height - padY * 2) / bbox.height, 0.95));
    fittingRef.current = true;
    setZoom(scale);
    setTranslate({
      x: wr.width / 2 - (bbox.x + bbox.width / 2) * scale,
      y: padY - bbox.y * scale,
    });
    setFitted(true);
    return true;
  }, []);

  useLayoutEffect(() => {
    if (viewLocked.current || lastFitKey.current === treeKey) return;
    let n = 0;
    const tryFit = () => {
      if (viewLocked.current) return;
      if (fitTree()) {
        lastFitKey.current = treeKey;
        return;
      }
      if (n > 10) return;
      n += 1;
      window.setTimeout(tryFit, 40);
    };
    const t = window.setTimeout(tryFit, 50);
    return () => window.clearTimeout(t);
  }, [treeKey, size.w, size.h, data, fitTree]);

  useEffect(() => {
    if (!resetLayoutKey) return;
    viewLocked.current = false;
    lastFitKey.current = -1;
    setCollapsedIds(new Set());
    saveCollapsed(new Set());
    setFitted(false);
    setTreeKey((n) => n + 1);
  }, [resetLayoutKey]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      viewLocked.current = true;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const z = zoomRef.current;
      const t = translateRef.current;
      const next = Math.max(0.2, Math.min(1.8, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      if (Math.abs(next - z) < 0.001) return;
      const k = next / z;
      setZoom(next);
      setTranslate({
        x: mx - (mx - t.x) * k,
        y: my - (my - t.y) * k,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const setCollapsed = useCallback((id: string, next?: boolean) => {
    setCollapsedIds((prev) => {
      const copy = new Set(prev);
      const collapse = next === undefined ? !copy.has(id) : next;
      if (collapse) copy.add(id);
      else copy.delete(id);
      saveCollapsed(copy);
      return copy;
    });
  }, []);

  const stampLinks = useCallback(() => {
    const root = wrapRef.current;
    if (!root) return;
    const svg = root.querySelector("svg");
    if (svg) {
      svg.setAttribute("data-testid", "org-connectors");
      svg.classList.add("org-connectors");
    }
    for (const path of root.querySelectorAll("path.org-line, path.rd3t-link")) {
      path.setAttribute("data-testid", "org-line");
      const cls = path.getAttribute("class") || "";
      const m = cls.match(/org-child-([^\s]+)/);
      if (m) path.setAttribute("data-child", m[1].replace(/--/g, ":").replace(/-slash-/g, "/"));
      const raw = cls.match(/org-childid-([^\s]+)/);
      if (raw) path.setAttribute("data-child", decodeURIComponent(raw[1].replace(/_/g, "%")));
    }
  }, []);

  useLayoutEffect(() => {
    stampLinks();
    const t = window.setTimeout(stampLinks, 50);
    const t2 = window.setTimeout(stampLinks, 240);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [data, size, translate, zoom, stampLinks]);

  function pathClass(link: TreeLinkDatum) {
    const id = String(link.target.data.attributes?.id || "");
    const encoded = encodeURIComponent(id).replace(/%/g, "_");
    const live = liveId && (id === liveId || String(link.source.data.attributes?.id || "") === liveId);
    return `org-line rd3t-link ${live ? "live" : ""} org-childid-${encoded}`;
  }

  function renderNode({ nodeDatum }: CustomNodeElementProps) {
    const id = String(nodeDatum.attributes?.id || "");
    const meta = byId.get(id);
    const hasChildren = Boolean(nodeDatum.attributes?.hasChildren);
    const collapsed = collapsedIds.has(id);
    if (meta?.kind === "project" && meta.project) {
      return (
        <TreeCard
          width={168}
          height={hasChildren ? 92 : 72}
          testId={`org-project-${meta.project.id}`}
        >
          <button
            type="button"
            className={`org-project-head ${selectedProjectId === meta.project.id ? "on" : ""}`}
            data-testid={`org-project-head-${meta.project.id}`}
            onClick={() => onSelectProject?.(meta.project!)}
          >
            <strong>{meta.project.name}</strong>
            {meta.project.brief && <span>{meta.project.brief}</span>}
          </button>
          {hasChildren && <CollapseHandle id={id} collapsed={collapsed} onToggle={(n) => setCollapsed(id, n)} />}
        </TreeCard>
      );
    }
    if (meta?.kind === "team" && meta.team) {
      return (
        <TreeCard width={160} height={hasChildren ? 88 : 68} testId={`org-team-${meta.team.id}`}>
          <button
            type="button"
            className={`org-team-head ${selectedTeamId === meta.team.id ? "on" : ""}`}
            data-testid={`org-team-head-${meta.team.id}`}
            onClick={() => onSelectTeam?.(meta.team!)}
          >
            <strong>{meta.team.name}</strong>
            {meta.team.job && <span>{meta.team.job}</span>}
          </button>
          {hasChildren && <CollapseHandle id={id} collapsed={collapsed} onToggle={(n) => setCollapsed(id, n)} />}
        </TreeCard>
      );
    }
    const seat = meta?.seat;
    if (!seat) {
      return (
        <TreeCard width={140} height={64}>
          <div className="seat">{nodeDatum.name}</div>
        </TreeCard>
      );
    }
    return (
      <TreeCard width={148} height={hasChildren ? 108 : 88}>
        <SeatBtn
          seat={seat}
          selectedId={selectedId}
          liveId={liveId}
          fire={Boolean(meta.fire)}
          unread={unreadBySeat[seat.id] || 0}
          onSelect={onSelect}
          onAttach={onAttach}
        />
        {hasChildren && <CollapseHandle id={id} collapsed={collapsed} onToggle={(n) => setCollapsed(id, n)} />}
      </TreeCard>
    );
  }

  function onPanStart(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || isChartControl(e.target)) return;
    viewLocked.current = true;
    panRef.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPanMove(e: PointerEvent<HTMLDivElement>) {
    const start = panRef.current;
    if (!start) return;
    setTranslate({
      x: start.tx + (e.clientX - start.x),
      y: start.ty + (e.clientY - start.y),
    });
  }

  function onPanEnd(e: PointerEvent<HTMLDivElement>) {
    if (!panRef.current) return;
    panRef.current = null;
    setPanning(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  return (
    <div
      className={`org-chart org-chart-d3 ${panning ? "is-panning" : ""}`}
      data-testid="org-chart"
      data-fitted={fitted ? "1" : "0"}
      data-zoom={zoom.toFixed(3)}
      ref={wrapRef}
      onPointerDown={onPanStart}
      onPointerMove={onPanMove}
      onPointerUp={onPanEnd}
      onPointerCancel={onPanEnd}
    >
      <Tree
        key={treeKey}
        data={data}
        orientation="vertical"
        collapsible={false}
        zoomable={false}
        draggable={false}
        zoom={zoom}
        translate={translate}
        pathFunc={orgStepPath}
        pathClassFunc={pathClass}
        nodeSize={ORG_NODE_SIZE}
        separation={ORG_SEPARATION}
        hasInteractiveNodes
        scaleExtent={{ min: 0.2, max: 1.4 }}
        renderCustomNodeElement={renderNode}
        onUpdate={(next) => {
          if (fittingRef.current) {
            fittingRef.current = false;
            window.setTimeout(stampLinks, 30);
            return;
          }
          if (panRef.current) return;
          if (typeof next.zoom === "number" && Math.abs(next.zoom - zoom) > 0.001) {
            setZoom(next.zoom);
            if (next.translate) setTranslate(next.translate);
          }
          window.setTimeout(stampLinks, 30);
        }}
      />
      <span className="sr-only">{cssId(tree.id)}</span>
    </div>
  );
}

function TreeCard({
  width,
  height,
  testId,
  children,
}: {
  width: number;
  height: number;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <foreignObject width={width} height={height} x={-width / 2} y={-12} data-testid={testId}>
      <div className="tree-card" style={{ width, height }}>
        {children}
      </div>
    </foreignObject>
  );
}

function CollapseHandle({
  id,
  collapsed,
  onToggle,
}: {
  id: string;
  collapsed: boolean;
  onToggle: (next?: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`tree-collapse ${collapsed ? "closed" : "open"}`}
      data-testid={`tree-collapse-${id}`}
      aria-label={collapsed ? "Expand" : "Collapse"}
      aria-expanded={!collapsed}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <span className="tree-collapse-grip" />
    </button>
  );
}

function SeatBtn({
  seat,
  selectedId,
  liveId,
  fire,
  unread = 0,
  onSelect,
  onAttach,
}: {
  seat: Seat;
  selectedId: string;
  liveId?: string;
  fire?: boolean;
  unread?: number;
  onSelect: (s: Seat) => void;
  onAttach?: (s: Seat) => void;
}) {
  const budget = budgetPaused(seat);
  const scheduled = !budget && seat.status !== "paused" && Number(seat.heartbeatMinutes) > 0;
  const pip = budget ? "paused budget" : seat.status === "paused" ? "paused" : liveId === seat.id ? "run" : scheduled ? "scheduled" : "on";
  return (
    <button
      type="button"
      data-seat-id={seat.id}
      data-testid={`seat-${seat.id}`}
      data-paused={seat.status === "paused" ? "1" : "0"}
      data-budget-paused={budget ? "1" : "0"}
      data-heartbeat={scheduled ? "1" : "0"}
      className={`seat ${seat.kind === "human" ? "human" : ""} ${selectedId === seat.id ? "live" : ""} ${seat.system ? "system" : ""} ${seat.preview === "hire" ? "ghost" : ""} ${fire ? "fire" : ""} ${seat.status === "paused" ? "paused" : ""} ${budget ? "budget-paused" : ""} ${scheduled ? "heartbeat" : ""}`}
      onClick={() => onSelect(seat)}
      onDoubleClick={() => onAttach?.(seat)}
    >
      <SeatAvatar seed={seat.id} kind={seat.kind} size={22} />
      <span className="seat-name-row">
        <span className={`pip ${pip}`} data-testid={`pip-${seat.id}`} />
        {seat.name}
        {unread > 0 && (
          <span className="unread-pip" data-testid={`inbox-count-${seat.id}`}>
            {unread}
          </span>
        )}
      </span>
      <div style={{ color: "var(--muted)", fontSize: 10 }}>
        {seat.role}
        {seat.kind === "human" ? " · human" : ""}
        {seat.system ? " · system" : ""}
        {seat.preview === "hire" ? " · proposed" : ""}
        {fire ? " · fire" : ""}
        {budget ? " · budget" : seat.status === "paused" ? " · paused" : scheduled ? " · beat" : ""}
      </div>
    </button>
  );
}
