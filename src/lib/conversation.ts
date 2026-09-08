import type { Channel, Project, Seat, Team } from "../data";

export type ConversationFocus =
  | { kind: "channel"; id: string }
  | { kind: "project"; id: string }
  | { kind: "team"; id: string }
  | { kind: "dm"; seatId: string };

export type RoomTab = "messages" | "files";

export function channelIdForFocus(focus: ConversationFocus): string {
  if (focus.kind === "channel") return focus.id;
  if (focus.kind === "project") return `project-${focus.id}`;
  if (focus.kind === "team") return `team-${focus.id}`;
  return `dm-${focus.seatId}`;
}

export function focusForChannelId(channelId: string): ConversationFocus {
  if (channelId.startsWith("project-")) return { kind: "project", id: channelId.slice("project-".length) };
  if (channelId.startsWith("team-")) return { kind: "team", id: channelId.slice("team-".length) };
  if (channelId.startsWith("dm-")) return { kind: "dm", seatId: channelId.slice("dm-".length) };
  return { kind: "channel", id: channelId };
}

export function isDerivedRoom(id: string) {
  return /^(project|team|dm|session)-/.test(id);
}

export function conversationTitle(
  focus: ConversationFocus,
  rooms: Channel[],
  projects: Project[],
  teams: Team[],
  roster: Seat[],
): string {
  if (focus.kind === "channel") return rooms.find((r) => r.id === focus.id)?.name || `#${focus.id}`;
  if (focus.kind === "project") return projects.find((p) => p.id === focus.id)?.name || focus.id;
  if (focus.kind === "team") return teams.find((t) => t.id === focus.id)?.name || focus.id;
  return roster.find((s) => s.id === focus.seatId)?.name || focus.seatId;
}

export function conversationMembers(
  focus: ConversationFocus,
  rooms: Channel[],
  projects: Project[],
  teams: Team[],
  roster: Seat[],
): Seat[] {
  const byId = new Map(roster.map((s) => [s.id, s]));
  const ids = new Set<string>();

  function addSeat(id?: string) {
    if (id) ids.add(id);
  }
  function addTeam(team?: Team) {
    if (!team) return;
    for (const id of team.seatIds || []) addSeat(id);
  }

  if (focus.kind === "channel") {
    const room = rooms.find((r) => r.id === focus.id);
    for (const id of room?.seatIds || []) addSeat(id);
    for (const tid of room?.teamIds || []) addTeam(teams.find((t) => t.id === tid));
  } else if (focus.kind === "project") {
    const project = projects.find((p) => p.id === focus.id);
    addSeat(project?.pmSeatId);
    addSeat("you");
    for (const tid of project?.teamIds || []) addTeam(teams.find((t) => t.id === tid));
    for (const t of teams.filter((x) => x.projectId === focus.id)) addTeam(t);
    for (const s of roster.filter((x) => x.projectId === focus.id)) addSeat(s.id);
  } else if (focus.kind === "team") {
    addSeat("you");
    addTeam(teams.find((t) => t.id === focus.id));
  } else {
    addSeat("you");
    addSeat(focus.seatId);
  }

  return [...ids].map((id) => byId.get(id)).filter(Boolean) as Seat[];
}

export function draftRoomForFocus(
  focus: ConversationFocus,
  rooms: Channel[],
  projects: Project[],
  teams: Team[],
  roster: Seat[],
): Channel | null {
  const id = channelIdForFocus(focus);
  if (rooms.some((r) => r.id === id)) return null;
  const members = conversationMembers(focus, rooms, projects, teams, roster);
  const seatIds = [...new Set(["you", ...members.map((s) => s.id)])];
  if (focus.kind === "channel") {
    return { id, name: `#${id}`, topic: "", teamIds: [], seatIds };
  }
  if (focus.kind === "project") {
    const project = projects.find((p) => p.id === focus.id);
    const teamIds = [
      ...new Set([...(project?.teamIds || []), ...teams.filter((t) => t.projectId === focus.id).map((t) => t.id)]),
    ];
    return { id, name: project?.name || id, topic: project?.brief || "", teamIds, seatIds };
  }
  if (focus.kind === "team") {
    const team = teams.find((t) => t.id === focus.id);
    return { id, name: team?.name || id, topic: team?.job || team?.role || "", teamIds: [focus.id], seatIds };
  }
  const seat = roster.find((s) => s.id === focus.seatId);
  return { id, name: seat?.name || id, topic: seat?.role || "", teamIds: [], seatIds };
}
