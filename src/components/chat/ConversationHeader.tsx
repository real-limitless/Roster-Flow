import { SearchButton } from "../SearchButton";
import { SeatAvatar } from "../SeatAvatar";
import type { Seat } from "../../data";
import type { RoomTab } from "../../lib/conversation";

const TABS: { id: RoomTab; label: string }[] = [
  { id: "messages", label: "Messages" },
  { id: "files", label: "Files & links" },
];

export function ConversationHeader({
  title,
  members,
  tab,
  inspectorOpen,
  debugOpen,
  onTab,
  onOpenSearch,
  onTitleClick,
  onOpenSeat,
  onToggleInspector,
  onToggleDebug,
}: {
  title: string;
  members: Seat[];
  tab: RoomTab;
  inspectorOpen: boolean;
  debugOpen?: boolean;
  onTab: (tab: RoomTab) => void;
  onOpenSearch: () => void;
  onTitleClick: () => void;
  onOpenSeat: (id: string) => void;
  onToggleInspector: () => void;
  onToggleDebug?: () => void;
}) {
  const shown = members.slice(0, 4);
  const extra = Math.max(0, members.length - shown.length);

  return (
    <header className="conversation-header" data-testid="conversation-header">
      <div className="conversation-header-row">
        <button type="button" className="conversation-title" data-testid="conversation-title" onClick={onTitleClick}>
          {title}
        </button>
        <div className="conversation-header-tools">
          <div className="conversation-members" data-testid="conversation-members">
            {shown.map((s) => (
              <button
                key={s.id}
                type="button"
                className="conversation-member"
                data-testid={`conversation-member-${s.id}`}
                title={s.name}
                onClick={() => onOpenSeat(s.id)}
              >
                <SeatAvatar seed={s.id} kind={s.kind} size={22} />
              </button>
            ))}
            {extra > 0 && (
              <button type="button" className="conversation-member-more" onClick={onTitleClick} title="View members">
                +{extra}
              </button>
            )}
          </div>
          <SearchButton className="conversation-search" testId="conversation-search" label="Search" onClick={onOpenSearch} />
          <button
            type="button"
            className={`pill-btn ${inspectorOpen ? "on" : ""}`}
            data-testid="toggle-inspector"
            onClick={onToggleInspector}
          >
            Seat
          </button>
          {onToggleDebug && (
            <button
              type="button"
              className={`pill-btn ${debugOpen ? "on" : ""}`}
              data-testid="toggle-debug"
              onClick={onToggleDebug}
            >
              Debug
            </button>
          )}
        </div>
      </div>
      <div className="conversation-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "on" : ""}
            data-testid={`room-tab-${t.id}`}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </header>
  );
}
