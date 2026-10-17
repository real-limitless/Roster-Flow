import { useEffect, useState } from "react";
import type { Channel, RespondMode, RoomLimits, Seat, SeatRoom, Team } from "../../data";
import { api } from "../../lib/api";

export const CONDUCTOR_ID = "channel";
const LIMIT_DEFAULTS: Record<keyof RoomLimits, number | null> = {
  implicitPerMinute: 4,
  fanout: 3,
  maxHops: 4,
  maxBotWakesPerThread: 8,
  tokensPerDay: null,
};
const LIMIT_MAX: Partial<Record<keyof RoomLimits, number>> = { fanout: 10, tokensPerDay: 1_000_000_000 };

const MODES: { id: RespondMode; label: string; hint: string }[] = [
  { id: "lead", label: "Lead replies", hint: "The lead answers un-mentioned messages. With no lead set, the next awake member does." },
  {
    id: "team",
    label: "Team replies",
    hint: "Up to the fan-out number of awake members are asked, lead first. Members with nothing to add reply PASS, which is not posted.",
  },
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
  if (channel.budget?.over) return "Quiet (budget)";
  if (mode === "quiet") return "Quiet";
  if (mode === "conductor") return "Conductor replies";
  if (mode === "team") return "Team replies";
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
      {(mode === "lead" || mode === "team") && (
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
        <LimitInput
          channel={channel}
          name="implicitPerMinute"
          label="Replies per minute"
          testId="room-rate"
          onPatch={onPatch}
        />
      )}
      {mode === "team" && (
        <LimitInput channel={channel} name="fanout" label="Members asked per message" testId="room-fanout" onPatch={onPatch} />
      )}
      <LimitInput channel={channel} name="maxHops" label="Bot hops per thread" testId="room-max-hops" onPatch={onPatch} />
      <LimitInput
        channel={channel}
        name="maxBotWakesPerThread"
        label="Bot wakes per thread"
        testId="room-max-bot-wakes"
        onPatch={onPatch}
      />
      <LimitInput
        channel={channel}
        name="tokensPerDay"
        label="Daily token budget"
        testId="room-tokens-per-day"
        placeholder="No limit"
        onPatch={onPatch}
      />
      {channel.budget && (
        <p className={`micro room-budget-line ${channel.budget.over ? "warn" : ""}`} data-testid="room-budget">
          Today: {channel.budget.spentToday.toLocaleString()} of {channel.budget.tokensPerDay.toLocaleString()} tokens
          {channel.budget.over ? ". Over budget: un-mentioned messages wake nobody until 00:00 UTC." : "."}
        </p>
      )}
    </div>
  );
}

/** Blank means the CORE default; the field saves on blur and ignores invalid input. */
function LimitInput({
  channel,
  name,
  label,
  testId,
  placeholder,
  onPatch,
}: {
  channel: Channel;
  name: keyof RoomLimits;
  label: string;
  testId: string;
  placeholder?: string;
  onPatch: (body: Partial<Channel>) => void;
}) {
  const current = channel.limits?.[name];
  const max = LIMIT_MAX[name] ?? 1000;
  return (
    <label className="kv-label">
      {label}
      <input
        type="number"
        min={1}
        max={max}
        data-testid={testId}
        key={`${channel.id}-${name}-${current ?? "default"}`}
        defaultValue={current ?? ""}
        placeholder={placeholder ?? String(LIMIT_DEFAULTS[name])}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const next = raw ? Number(raw) : null;
          if ((next ?? undefined) === current) return;
          if (next !== null && (!Number.isInteger(next) || next < 1 || next > max)) return;
          onPatch({ limits: { [name]: next as number } });
        }}
      />
    </label>
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
