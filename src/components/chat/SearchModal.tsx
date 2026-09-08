import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "../SearchButton";
import type { Channel, Msg, Project, Seat, Team } from "../../data";
import {
  flattenSearchHits,
  getRecentSearches,
  pushRecentSearch,
  removeRecentSearch,
  searchWorkspace,
  type SearchHit,
} from "../../lib/search";

type Row =
  | { key: string; kind: "scope" }
  | { key: string; kind: "recent"; query: string }
  | { key: string; kind: "hit"; hit: SearchHit };

export function SearchModal({
  rooms,
  roster,
  teams,
  projects,
  messages,
  currentTitle,
  currentChannel,
  roomLabel,
  onClose,
  onSelect,
}: {
  rooms: Channel[];
  roster: Seat[];
  teams: Team[];
  projects: Project[];
  messages: Msg[];
  currentTitle: string;
  currentChannel: string;
  roomLabel: (channelId: string) => string;
  onClose: () => void;
  onSelect: (hit: SearchHit) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [scoped, setScoped] = useState(false);
  const [recent, setRecent] = useState(getRecentSearches);
  const [active, setActive] = useState(0);

  const groups = useMemo(
    () =>
      searchWorkspace(query, {
        rooms,
        roster,
        teams,
        projects,
        messages,
        roomLabel,
        scopeChannel: scoped ? currentChannel : undefined,
      }),
    [query, rooms, roster, teams, projects, messages, roomLabel, scoped, currentChannel],
  );

  const rows = useMemo<Row[]>(() => {
    const q = query.trim();
    if (!q) {
      const next: Row[] = [];
      if (!scoped) next.push({ key: "scope", kind: "scope" });
      for (const item of recent) next.push({ key: `recent-${item}`, kind: "recent", query: item });
      return next;
    }
    return flattenSearchHits(groups).map((hit) => ({ key: `${hit.kind}-${hit.id}`, kind: "hit", hit }));
  }, [query, recent, groups, scoped]);

  useEffect(() => {
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => {
      restore.current?.focus();
    };
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query, scoped, recent.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        if (!rows.length) return;
        e.preventDefault();
        setActive((i) => (i + 1) % rows.length);
        return;
      }
      if (e.key === "ArrowUp") {
        if (!rows.length) return;
        e.preventDefault();
        setActive((i) => (i - 1 + rows.length) % rows.length);
        return;
      }
      if (e.key === "Enter") {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "BUTTON" && !target.classList.contains("search-result")) return;
        if (!rows.length) return;
        e.preventDefault();
        activate(rows[Math.min(active, rows.length - 1)]);
        return;
      }
      if (e.key === "Tab") {
        const root = dialog.current;
        if (!root) return;
        const focusable = [...root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )].filter((el) => !el.hasAttribute("disabled"));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, rows, onClose, query, onSelect, scoped]);

  function remember(q: string) {
    if (q.trim()) setRecent(pushRecentSearch(q));
  }

  function activate(row: Row | undefined) {
    if (!row) return;
    if (row.kind === "scope") {
      setScoped(true);
      input.current?.focus();
      return;
    }
    if (row.kind === "recent") {
      setQuery(row.query);
      return;
    }
    remember(query);
    onSelect(row.hit);
  }

  const hasQuery = Boolean(query.trim());
  const emptyResults = hasQuery && rows.length === 0;

  return (
    <div className="modal-scrim" data-testid="search-modal" onClick={onClose}>
      <div
        ref={dialog}
        className="channel-editor search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="search-dialog-title" className="sr-only">
          Search workspace
        </h2>
        <div className="search-dialog-bar">
          <span className="search-dialog-lead">
            <SearchIcon size={16} />
          </span>
          <input
            ref={input}
            data-testid="search-modal-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={scoped ? `Search in ${currentTitle}` : "Search rooms, seats, and messages"}
            aria-label="Search workspace"
            aria-controls="search-dialog-results"
          />
          {query && (
            <button type="button" className="search-dialog-icon" aria-label="Clear search" onClick={() => setQuery("")}>
              Clear
            </button>
          )}
          <button type="button" className="search-dialog-icon" aria-label="Close search" onClick={onClose}>
            Close
          </button>
        </div>
        {scoped && (
          <div className="search-dialog-chips">
            <button
              type="button"
              className="search-scope-chip"
              data-testid="search-scope-chip"
              onClick={() => setScoped(false)}
            >
              In {currentTitle} ×
            </button>
          </div>
        )}
        <div id="search-dialog-results" className="search-dialog-body" role="listbox" aria-label="Search results">
          {!hasQuery && (
            <>
              {!scoped && (
                <button
                  type="button"
                  role="option"
                  aria-selected={active === 0}
                  className={`search-result ${active === 0 ? "on" : ""}`}
                  data-testid="search-scope-current"
                  onClick={() => activate({ key: "scope", kind: "scope" })}
                  onMouseEnter={() => setActive(0)}
                >
                  <span>Search in {currentTitle}</span>
                  <small>This conversation</small>
                </button>
              )}
              {recent.length > 0 && <div className="search-section">Recent searches</div>}
              {recent.map((item, i) => {
                const index = scoped ? i : i + 1;
                return (
                  <div key={item} className={`search-recent-row ${active === index ? "on" : ""}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active === index}
                      className="search-result"
                      data-testid={`search-recent-${i}`}
                      onClick={() => activate({ key: `recent-${item}`, kind: "recent", query: item })}
                      onMouseEnter={() => setActive(index)}
                    >
                      <span>{item}</span>
                      <small>Recent</small>
                    </button>
                    <button
                      type="button"
                      className="search-recent-remove"
                      aria-label={`Remove ${item}`}
                      onClick={() => setRecent(removeRecentSearch(item))}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </>
          )}
          {hasQuery && emptyResults && <div className="search-empty">No matches.</div>}
          {hasQuery && !emptyResults && (
            <>
              <ResultGroup label="Rooms" hits={groups.rooms} rows={rows} active={active} onHover={setActive} onPick={activate} />
              <ResultGroup label="Seats" hits={groups.seats} rows={rows} active={active} onHover={setActive} onPick={activate} />
              <ResultGroup label="Teams" hits={groups.teams} rows={rows} active={active} onHover={setActive} onPick={activate} />
              <ResultGroup label="Projects" hits={groups.projects} rows={rows} active={active} onHover={setActive} onPick={activate} />
              <ResultGroup label="Messages" hits={groups.messages} rows={rows} active={active} onHover={setActive} onPick={activate} />
            </>
          )}
        </div>
        <div className="search-dialog-foot">
          <span>
            <kbd>Enter</kbd> Open <kbd>↑↓</kbd> Move
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}

function ResultGroup({
  label,
  hits,
  rows,
  active,
  onHover,
  onPick,
}: {
  label: string;
  hits: SearchHit[];
  rows: Row[];
  active: number;
  onHover: (index: number) => void;
  onPick: (row: Row) => void;
}) {
  if (!hits.length) return null;
  return (
    <>
      <div className="search-section">{label}</div>
      {hits.map((hit) => {
        const index = rows.findIndex((row) => row.kind === "hit" && row.hit.kind === hit.kind && row.hit.id === hit.id);
        return (
          <button
            key={`${hit.kind}-${hit.id}`}
            type="button"
            role="option"
            aria-selected={active === index}
            className={`search-result ${active === index ? "on" : ""}`}
            data-testid={`search-result-${hit.kind}-${hit.id}`}
            onClick={() => onPick({ key: `${hit.kind}-${hit.id}`, kind: "hit", hit })}
            onMouseEnter={() => {
              if (index >= 0) onHover(index);
            }}
          >
            <span>{hit.title}</span>
            <small>{hit.subtitle}</small>
          </button>
        );
      })}
    </>
  );
}
