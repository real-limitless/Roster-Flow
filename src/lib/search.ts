import type { Channel, Msg, Project, Seat, Team } from "../data";
import { focusForChannelId, isDerivedRoom, type ConversationFocus } from "./conversation";

const RECENT_KEY = "roster-flow-recent-searches";
const RECENT_MAX = 8;
const ENTITY_LIMIT = 8;
const MESSAGE_LIMIT = 20;

export type SearchHitKind = "room" | "seat" | "team" | "project" | "message";

export type SearchHit = {
  kind: SearchHitKind;
  id: string;
  title: string;
  subtitle: string;
  focus: ConversationFocus;
};

export type SearchGroups = {
  rooms: SearchHit[];
  seats: SearchHit[];
  teams: SearchHit[];
  projects: SearchHit[];
  messages: SearchHit[];
};

export function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

function haystack(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function matchesSearch(msg: Msg, query: string) {
  const q = normalizeQuery(query);
  if (!q) return true;
  const files = (msg.files || []).map((f) => `${f.name} ${f.path}`).join(" ");
  const atts = (msg.attachments || []).map((a) => a.name).join(" ");
  return haystack(msg.who, msg.text, files, atts).includes(q);
}

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function pushRecentSearch(query: string): string[] {
  const q = query.trim();
  if (!q) return getRecentSearches();
  const next = [q, ...getRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export function removeRecentSearch(query: string): string[] {
  const next = getRecentSearches().filter((x) => x !== query);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export function searchWorkspace(
  query: string,
  data: {
    rooms: Channel[];
    roster: Seat[];
    teams: Team[];
    projects: Project[];
    messages: Msg[];
    roomLabel: (channelId: string) => string;
    scopeChannel?: string;
  },
): SearchGroups {
  const q = normalizeQuery(query);
  const empty: SearchGroups = { rooms: [], seats: [], teams: [], projects: [], messages: [] };
  if (!q) return empty;

  const messages = data.messages
    .filter((m) => (!data.scopeChannel || m.channel === data.scopeChannel) && matchesSearch(m, q))
    .slice(0, MESSAGE_LIMIT)
    .map((m) => ({
      kind: "message" as const,
      id: m.id,
      title: m.text.trim() || "(empty message)",
      subtitle: `${data.roomLabel(m.channel)} · ${m.who}`,
      focus: focusForChannelId(m.channel),
    }));

  if (data.scopeChannel) {
    return { ...empty, messages };
  }

  return {
    rooms: data.rooms
      .filter((r) => !isDerivedRoom(r.id) && haystack(r.id, r.name, r.topic).includes(q))
      .slice(0, ENTITY_LIMIT)
      .map((r) => ({
        kind: "room" as const,
        id: r.id,
        title: r.name,
        subtitle: r.topic || "Channel",
        focus: { kind: "channel" as const, id: r.id },
      })),
    seats: data.roster
      .filter((s) => haystack(s.id, s.name, s.role, s.job).includes(q))
      .slice(0, ENTITY_LIMIT)
      .map((s) => ({
        kind: "seat" as const,
        id: s.id,
        title: s.name,
        subtitle: s.role || s.job || "Seat",
        focus: { kind: "dm" as const, seatId: s.id },
      })),
    teams: data.teams
      .filter((t) => haystack(t.id, t.name, t.role, t.job, t.description).includes(q))
      .slice(0, ENTITY_LIMIT)
      .map((t) => ({
        kind: "team" as const,
        id: t.id,
        title: t.name,
        subtitle: t.job || t.role || "Team",
        focus: { kind: "team" as const, id: t.id },
      })),
    projects: data.projects
      .filter((p) => haystack(p.id, p.name, p.brief).includes(q))
      .slice(0, ENTITY_LIMIT)
      .map((p) => ({
        kind: "project" as const,
        id: p.id,
        title: p.name,
        subtitle: p.brief || "Project",
        focus: { kind: "project" as const, id: p.id },
      })),
    messages,
  };
}

export function flattenSearchHits(groups: SearchGroups): SearchHit[] {
  return [...groups.rooms, ...groups.seats, ...groups.teams, ...groups.projects, ...groups.messages];
}
