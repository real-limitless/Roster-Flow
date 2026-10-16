import { useEffect, useState } from "react";
import type { Channel, RespondMode, Seat, SeatRoom, Team } from "../../data";
import { api } from "../../lib/api";

export const CONDUCTOR_ID = "channel";
const DEFAULT_PER_MINUTE = 4;

const MODES: { id: RespondMode; label: string; hint: string }[] = [
  { id: "lead", label: "Lead replies", hint: "The lead answers un-mentioned messages. With no lead set, the next awake member does." },
  { id: "conductor", label: "Conductor replies", hint: "The Channel conductor answers un-mentioned messages." },
  { id: "quiet", label: "Quiet", hint: "Un-mentioned messages wake nobody. People in the room get a notification." },
];

/** Direct seats, seats of member teams, and the conductor, in roster order. */
export function roomMembers(channel: Channel, teams: Team[], roster: Seat[]): Seat[] {
  const ids = new Set<string>([CONDUCTOR_ID, ...(channel.seatIds || [])]);
  for (const tid of channel.teamIds || []) {
    for (const id of teams.find((t) => t.id === tid)?.seatIds || []) ids.add(id);
  }
  return roster.filter((s) => ids.has(s.id));
}

/** Bots that can lead a room: no MCP guests, and no system seats besides the conductor. */
export function leadChoices(channel: Channel, teams: Team[], roster: Seat[]): Seat[] {
  return roomMembers(channel, teams, roster).filter(
    (s) => s.kind === "bot" && !s.mcpGuest && (!s.system || s.id === CONDUCTOR_ID),
  );
}

export function responderLabel(channel: Channel | undefined, roster: Seat[]): string | null {
  if (!channel) return null;
  const mode = channel.respond || "lead";
  if (mode === "quiet") return "Quiet";
  if (mode === "conductor") return "Conductor replies";
  const id = channel.leadSeatId || channel.responderSeatId;
  const name = roster.find((s) => s.id === id)?.name || id;
  if (!name) return null;
  return channel.leadSeatId ? `Lead: ${name}` : `Replies: ${name}`;
}

export function RoomReplySettings({
  channel,
  roster,
  teams,
  onPatch,
}: {
  channel: Channel;
  roster: Seat[];
  teams: Team[];
  onPatch: (body: Partial<Channel>) => void;
}) {
  const mode = channel.respond || "lead";
  const choices = leadChoices(channel, teams, roster);
  const perMinute = channel.limits?.implicitPerMinute;
  const responder = roster.find((s) => s.id === channel.responderSeatId);
  return (
    <div className="room-reply-settings" data-testid="room-reply-settings">
      <h4>Replies</h4>
      <label className="kv-label">
        Un-mentioned messages
        <select
          data-testid="room-respond"
          value={mode}
          onChange={(e) => onPatch({ respond: e.target.value as RespondMode })}
        >
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="micro">{MODES.find((m) => m.id === mode)?.hint}</p>
      {mode === "lead" && (
        <label className="kv-label">
          Lead
          <select
            data-testid="room-lead"
            value={channel.leadSeatId || ""}
            onChange={(e) => onPatch({ leadSeatId: e.target.value || null })}
          >
            <option value="">No lead (next awake member)</option>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode !== "quiet" && responder && (
        <p className="micro" data-testid="room-responder">
          Answering now: {responder.name}
        </p>
      )}
      {mode !== "quiet" && (
        <label className="kv-label">
          Replies per minute
          <input
            type="number"
            min={1}
            max={1000}
            data-testid="room-rate"
            key={`${channel.id}-rate-${perMinute ?? "default"}`}
            defaultValue={perMinute ?? ""}
            placeholder={String(DEFAULT_PER_MINUTE)}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const next = raw ? Number(raw) : null;
              if ((next ?? undefined) === perMinute) return;
              if (next !== null && (!Number.isInteger(next) || next < 1)) return;
              onPatch({ limits: { implicitPerMinute: next as number } });
            }}
          />
        </label>
      )}
    </div>
  );
}

export function SeatRooms({
  seat,
  version,
  onOpenRoom,
  onLeave,
}: {
  seat: Seat;
  version: unknown;
  onOpenRoom: (id: string) => void;
  onLeave: (roomId: string) => Promise<unknown>;
}) {
  const [rooms, setRooms] = useState<SeatRoom[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void api
      .seatChannels(seat.id)
      .then((out) => live && setRooms(out))
      .catch(() => live && setRooms(null));
    return () => {
      live = false;
    };
  }, [seat.id, version, tick]);
  const canLeave = seat.id !== CONDUCTOR_ID;
  return (
    <div className="seat-rooms" data-testid="seat-rooms">
      <h4 style={{ marginTop: 16 }}>Rooms</h4>
      {rooms && rooms.length === 0 && <p className="micro">Not in any room.</p>}
      {(rooms || []).map((r) => (
        <div className="seat-room" key={r.id} data-testid={`seat-room-${r.id}`}>
          <button type="button" className="seat-room-name" onClick={() => onOpenRoom(r.id)}>
            {r.name}
          </button>
          <span className="micro">
            {r.lead ? "Lead" : r.responder ? "Answers" : ""}
            {r.viaTeams.length ? `${r.lead || r.responder ? " · " : ""}via ${r.viaTeams.map((t) => `@${t}`).join(", ")}` : ""}
          </span>
          {canLeave && r.direct && (
            <button
              type="button"
              className="pill-btn"
              data-testid={`seat-room-leave-${r.id}`}
              onClick={() => void onLeave(r.id).finally(() => setTick((n) => n + 1))}
            >
              Leave room
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
