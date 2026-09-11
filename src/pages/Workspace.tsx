import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { SearchButton } from "../components/SearchButton";
import {
  channels as seedChannels,
  enrichTeam,
  projects as seedProjects,
  seatForMessage,
  seats as seedSeats,
  seedMessages,
  slugify,
  teams as seedTeams,
  type CatalogModel,
  type Channel,
  type Msg,
  type Project,
  type Goal,
  type Approval,
  type Seat,
  type SeatKind,
  type SeatType,
  type ModelStrategy,
  type Task,
  type Team,
} from "../data";
import { OrgChart } from "../components/OrgChart";
import { SeatAvatar } from "../components/SeatAvatar";
import { HarnessTerm } from "../components/HarnessTerm";
import type { Mode } from "../components/WorkspaceMock";
import { Composer, type ComposePayload } from "../components/chat/Composer";
import { ConversationHeader } from "../components/chat/ConversationHeader";
import { FilesLinksPane } from "../components/chat/ConversationPanes";
import { SearchModal } from "../components/chat/SearchModal";
import { MessageRow } from "../components/chat/MessageRow";
import { TaskBoard } from "../components/chat/TaskBoard";
import { ArchitectDock, type ArchitectMsg } from "../components/chart/ArchitectDock";
import { ChartSplitter, loadDock, saveDock, useNarrowChart, type DockLayout } from "../components/chart/ChartSplitter";
import { previewFromPlan, type OrgPlan } from "../components/chart/planPreview";
import { COLLAPSED_KEY } from "../components/OrgChart";
import { api } from "../lib/api";
import { ChatDebugPanel, loadDebugOpen, saveDebugOpen } from "../components/chat/ChatDebugPanel";
import {
  channelIdForFocus,
  conversationMembers,
  conversationTitle,
  draftRoomForFocus,
  focusForChannelId,
  isDerivedRoom,
  type ConversationFocus,
  type RoomTab,
} from "../lib/conversation";
import type { SearchHit } from "../lib/search";

type CreateKind = "channel" | "project" | "team" | "seat";

export function Workspace() {
  const [mode, setMode] = useState<Mode>("room");
  const [roster, setRoster] = useState<Seat[]>(seedSeats);
  const [rooms, setRooms] = useState<Channel[]>(seedChannels);
  const [focus, setFocus] = useState<ConversationFocus>({ kind: "channel", id: "ship" });
  const [messages, setMessages] = useState<Msg[]>(seedMessages);
  const [selectedId, setSelectedId] = useState("build");
  const [showSystem, setShowSystem] = useState(false);
  const [createModal, setCreateModal] = useState<CreateKind | null>(null);
  const [hireTeam, setHireTeam] = useState("");
  const [hireProject, setHireProject] = useState("");
  const [teamProject, setTeamProject] = useState("");
  const [mobilePane, setMobilePane] = useState<"none" | "nav" | "seat">("none");
  const [teamList, setTeamList] = useState<Team[]>(seedTeams);
  const [projectList, setProjectList] = useState<Project[]>(seedProjects);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [inboxUnread, setInboxUnread] = useState<Record<string, number>>({});
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [architectMsgs, setArchitectMsgs] = useState<ArchitectMsg[]>([]);
  const [architectBusy, setArchitectBusy] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<OrgPlan | null>(null);
  const [sendError, setSendError] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [roomTab, setRoomTab] = useState<RoomTab>("messages");
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(loadDebugOpen);
  const [harnessSessions, setHarnessSessions] = useState<
    Array<{ id: string; title: string; agent: string | null; harness: string; seatId: string | null; channel: string | null }>
  >([]);

  const channel = channelIdForFocus(focus);
  const selected = roster.find((s) => s.id === selectedId) || roster[0];
  const selectedTeam = focus.kind === "team" ? teamList.find((t) => t.id === focus.id) || null : null;
  const selectedProject =
    focus.kind === "project"
      ? projectList.find((p) => p.id === focus.id) || null
      : selectedTeam?.projectId
        ? projectList.find((p) => p.id === selectedTeam.projectId) || null
        : null;
  const selectedTeamId = selectedTeam?.id || null;
  const selectedProjectId = selectedProject?.id || null;
  const panelTeams = teamList.map((t) => enrichTeam(t, roster));
  const members = conversationMembers(focus, rooms, projectList, panelTeams, roster);
  const title = conversationTitle(focus, rooms, projectList, panelTeams, roster);

  function projectTeamCount(p: Project) {
    const ids = new Set([...(p.teamIds || []), ...teamList.filter((t) => t.projectId === p.id).map((t) => t.id)]);
    return ids.size;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("mode");
    if (m === "room" || m === "harness" || m === "chart") setMode(m);
    void (async () => {
      try {
        const st = await api.state();
        if (Array.isArray(st.seats)) setRoster(st.seats as Seat[]);
        if (Array.isArray(st.channels)) {
          setRooms(st.channels as Channel[]);
          const ids = new Set(st.channels.map((c) => c.id));
          setFocus((f) => {
            if (f.kind === "channel" && ids.has(f.id)) return f;
            const first = st.channels[0];
            return first ? { kind: "channel", id: first.id } : f;
          });
        }
        if (Array.isArray(st.messages)) setMessages(st.messages as Msg[]);
        if (Array.isArray(st.projects)) setProjectList(st.projects);
        if (Array.isArray(st.goals)) setGoals(st.goals);
        if (st.inboxUnread) setInboxUnread(st.inboxUnread);
        if (Array.isArray(st.approvals)) setApprovals(st.approvals);
        if (Array.isArray(st.tasks)) setTasks(st.tasks as Task[]);
        const [t, m, p] = await Promise.all([
          api.teams().catch(() => []),
          api.models().catch(() => []),
          api.projects().catch(() => []),
        ]);
        if (Array.isArray(t)) setTeamList(t);
        if (Array.isArray(m)) setModels(m);
        if (Array.isArray(p)) setProjectList(p);
      } catch {
        /* local seed */
      }
    })();
  }, []);

  useEffect(() => {
    if (!modalOpen && !createModal && !searchOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      if (createModal) {
        setCreateModal(null);
        setHireTeam("");
        setHireProject("");
        setTeamProject("");
        return;
      }
      setModalOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, createModal, searchOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing = Boolean(
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable),
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key === "/" && !typing && !searchOpen && !modalOpen && !createModal) {
        e.preventDefault();
        openSearch();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, modalOpen, createModal]);

  useEffect(() => {
    if (!scrollToMessageId) return;
    const id = scrollToMessageId;
    let tries = 0;
    let raf = 0;
    const tick = () => {
      const el = document.querySelector(`[data-testid="message-${id}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center" });
        el.classList.add("flash");
        window.setTimeout(() => el.classList.remove("flash"), 1600);
        setScrollToMessageId(null);
        return;
      }
      if (tries++ < 40) raf = requestAnimationFrame(tick);
      else setScrollToMessageId(null);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrollToMessageId, channel, messages]);

  useEffect(() => {
    const draft = draftRoomForFocus(focus, rooms, projectList, teamList, roster);
    if (!draft) return;
    setRooms((list) => (list.some((r) => r.id === draft.id) ? list : [...list, draft]));
    void api.createChannel(draft).catch(() => undefined);
  }, [focus, rooms, projectList, teamList, roster]);

  useEffect(() => {
    const tick = () => {
      void api
        .messages(channel)
        .then((m) => {
          if (Array.isArray(m)) setMessages((prev) => replaceChannel(prev, channel, m));
        })
        .catch(() => undefined);
    };
    tick();
    const t = window.setInterval(tick, 800);
    return () => window.clearInterval(t);
  }, [channel]);

  useEffect(() => {
    const tick = () => {
      void api
        .harnessSessions()
        .then((out) => {
          if (Array.isArray(out.sessions)) setHarnessSessions(out.sessions);
        })
        .catch(() => undefined);
    };
    tick();
    const t = window.setInterval(tick, 2500);
    return () => window.clearInterval(t);
  }, []);

  function toggleDebug() {
    setDebugOpen((open) => {
      const next = !open;
      saveDebugOpen(next);
      return next;
    });
  }

  function openInspector() {
    setInspectorOpen(true);
    setMobilePane("seat");
  }

  function closeInspector() {
    setInspectorOpen(false);
    setMobilePane((p) => (p === "seat" ? "none" : p));
  }

  function closeCreate() {
    setCreateModal(null);
    setHireTeam("");
    setHireProject("");
    setTeamProject("");
  }

  function applyRemoteState(st: {
    seats?: Seat[];
    channels?: Channel[];
    messages?: Msg[];
    teams?: Team[];
    projects?: Project[];
    goals?: Goal[];
    approvals?: Approval[];
    tasks?: Task[];
    inboxUnread?: Record<string, number>;
  }) {
    if (Array.isArray(st.seats) && st.seats.length) setRoster(st.seats);
    if (Array.isArray(st.channels) && st.channels.length) setRooms(st.channels);
    if (Array.isArray(st.messages) && st.messages.length) setMessages(st.messages);
    if (Array.isArray(st.teams) && st.teams.length) setTeamList(st.teams);
    if (Array.isArray(st.projects) && st.projects.length) setProjectList(st.projects);
    if (Array.isArray(st.goals)) setGoals(st.goals);
    if (st.inboxUnread) setInboxUnread(st.inboxUnread);
    if (Array.isArray(st.approvals)) setApprovals(st.approvals);
    if (Array.isArray(st.tasks)) setTasks(st.tasks);
  }

  function openSearch() {
    setModalOpen(false);
    setCreateModal(null);
    setSearchOpen(true);
    void api
      .state()
      .then((st) => applyRemoteState(st))
      .catch(() => undefined);
  }

  function openCreate(kind: CreateKind, extras: { teamId?: string; projectId?: string } = {}) {
    setModalOpen(false);
    setSearchOpen(false);
    setCreateModal(kind);
    setMobilePane("none");
    setHireTeam(kind === "seat" ? extras.teamId || "" : "");
    setHireProject(kind === "seat" ? extras.projectId || "" : "");
    setTeamProject(kind === "team" ? extras.projectId || selectedProjectId || "" : "");
  }

  function openConversation(next: ConversationFocus, opts: { mode?: Mode; inspector?: boolean } = {}) {
    setFocus(next);
    setRoomTab("messages");
    setSearchOpen(false);
    setModalOpen(false);
    setCreateModal(null);
    setMode(opts.mode ?? "room");
    if (opts.inspector || opts.mode === "chart") openInspector();
    else {
      setInspectorOpen(false);
      setMobilePane("none");
    }
  }

  function roomLabel(id: string) {
    const room = rooms.find((r) => r.id === id);
    if (room?.name) return room.name;
    return conversationTitle(focusForChannelId(id), rooms, projectList, panelTeams, roster);
  }

  function onSearchHit(hit: SearchHit) {
    if (hit.kind === "seat") {
      setSelectedId(hit.id);
      openConversation(hit.focus, { inspector: true });
      return;
    }
    if (hit.kind === "message") setScrollToMessageId(hit.id);
    openConversation(hit.focus);
  }

  function send(payload: ComposePayload) {
    const t = payload.text.trim();
    if (!t && !payload.attachments.length && !payload.skills.length && !payload.files.length) return;
    setSendError("");
    const local: Msg = {
      id: `local-${Date.now()}`,
      channel,
      who: "You",
      kind: "human",
      seatId: "you",
      text: t,
      time: now(),
      attachments: payload.attachments,
      skills: payload.skills,
      files: payload.files,
    };
    setMessages((prev) => mergeMsgs(prev, [local]));
    void api
      .postMessage(channel, t, {
        who: "You",
        seatId: "you",
        attachments: payload.attachments,
        skills: payload.skills,
        files: payload.files,
      })
      .then((msg) => {
        if (msg?.messages) setMessages((prev) => replaceChannel(prev, channel, msg.messages as Msg[]));
        else if (msg?.id) {
          const saved = msg as Msg;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === local.id
                ? {
                    ...local,
                    ...saved,
                    id: String(saved.id),
                    skills: saved.skills?.length ? saved.skills : local.skills,
                    files: saved.files?.length ? saved.files : local.files,
                    attachments: saved.attachments?.length ? saved.attachments : local.attachments,
                    seatId: saved.seatId || local.seatId,
                  }
                : m,
            ),
          );
        }
      })
      .catch((err) => {
        setSendError(err instanceof Error ? err.message : "Could not send message");
        setMessages((prev) => prev.filter((m) => m.id !== local.id));
      });
  }

  function openSeat(id: string) {
    setSelectedId(id);
    openInspector();
  }

  function attachSeat(id = selectedId) {
    setSelectedId(id);
    setMobilePane("none");
    void api
      .attach(id)
      .then((out) => {
        if (out?.paused) {
          setRoster((r) => r.map((s) => (s.id === id ? { ...s, status: "paused" } : s)));
          return;
        }
        setMode("harness");
      })
      .catch(() => setMode("harness"));
  }

  function refreshBoard() {
    void api
      .state()
      .then((st) => applyRemoteState(st))
      .catch(() => undefined);
  }

  function pauseSelected(id: string) {
    setRoster((r) => r.map((s) => (s.id === id ? { ...s, status: "paused" } : s)));
    void api
      .pauseSeat(id)
      .then((seat) => setRoster((r) => r.map((s) => (s.id === id ? (seat as Seat) : s))))
      .catch(() => undefined);
  }

  function resumeSelected(id: string) {
    setRoster((r) => r.map((s) => (s.id === id && s.status === "paused" ? { ...s, status: "idle" } : s)));
    void api
      .resumeSeat(id)
      .then((seat) => setRoster((r) => r.map((s) => (s.id === id ? (seat as Seat) : s))))
      .catch(() => undefined);
  }

  function addRoom(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const id = slugify(trimmed) || `room-${Date.now()}`;
    if (rooms.some((r) => r.id === id)) {
      closeCreate();
      openConversation({ kind: "channel", id });
      return;
    }
    const name = trimmed.startsWith("#") ? trimmed : `#${trimmed.replace(/\s+/g, "-").toLowerCase()}`;
    const next = { id, name, topic: "", teamIds: [] as string[], seatIds: ["channel", "you"] };
    setRooms((r) => [...r, next]);
    closeCreate();
    openConversation({ kind: "channel", id });
    void api.createChannel(next).catch(() => undefined);
    setMessages((m) => [
      ...m,
      {
        id: `sys-${Date.now()}`,
        channel: id,
        who: "You",
        kind: "human",
        seatId: "you",
        text: `Created ${name}.`,
        time: now(),
      },
    ]);
  }

  function hireSeat(seat: Seat) {
    setRoster((r) => [...r, seat]);
    setSelectedId(seat.id);
    closeCreate();
    setMode("chart");
    openInspector();
    void api
      .hire(seat)
      .then(() => Promise.all([api.teams(), api.projects().catch(() => [])]))
      .then(([t, p]) => {
        if (Array.isArray(t)) setTeamList(t);
        if (Array.isArray(p) && p.length) setProjectList(p);
      })
      .catch(() => undefined);
  }

  function fireSeat(id: string) {
    const seat = roster.find((s) => s.id === id);
    if (!seat || seat.id === "you" || seat.system) return;
    const fallback = seat.reportsTo && seat.reportsTo !== id ? seat.reportsTo : "you";
    setRoster((r) =>
      r.filter((s) => s.id !== id).map((s) => (s.reportsTo === id ? { ...s, reportsTo: fallback } : s)),
    );
    setSelectedId(fallback);
    void api
      .fire(id)
      .then(() => Promise.all([api.seats(), api.teams(), api.projects().catch(() => [])]))
      .then(([seats, t, p]) => {
        if (Array.isArray(seats)) setRoster(seats);
        if (Array.isArray(t)) setTeamList(t);
        if (Array.isArray(p)) setProjectList(p);
      })
      .catch(() => undefined);
  }

  function sendArchitect(text: string) {
    const user: ArchitectMsg = { id: `u-${Date.now()}`, role: "user", text };
    setArchitectMsgs((m) => [...m, user]);
    setArchitectBusy(true);
    const history = [...architectMsgs, user].map((m) => ({ role: m.role, text: m.text }));
    void api
      .architectChat(text, history)
      .then((out) => {
        const plan = out.plan as OrgPlan | null;
        if (plan) setPendingPlan(plan);
        setArchitectMsgs((m) => [
          ...m,
          {
            id: plan?.id || `a-${Date.now()}`,
            role: "architect",
            text: out.reply || plan?.summary || "No reply.",
            plan: plan ? { ...plan, source: out.source } : undefined,
            source: out.source,
          },
        ]);
      })
      .catch((err) => {
        setArchitectMsgs((m) => [
          ...m,
          {
            id: `err-${Date.now()}`,
            role: "architect",
            text: err instanceof Error ? err.message : "Could not draft a plan. Start the System harness or try a shorter ask.",
          },
        ]);
      })
      .finally(() => setArchitectBusy(false));
  }

  function applyArchitect(plan: OrgPlan) {
    setArchitectBusy(true);
    void api
      .architectApply(plan.id)
      .then((res) => {
        if (Array.isArray(res.seats)) setRoster(res.seats);
        if (Array.isArray(res.teams)) setTeamList(res.teams);
        if (Array.isArray(res.projects)) setProjectList(res.projects);
        setPendingPlan({ ...plan, status: "applied" });
        setArchitectMsgs((m) =>
          m.map((msg) => (msg.plan?.id === plan.id ? { ...msg, plan: { ...msg.plan, status: "applied" } } : msg)),
        );
        refreshBoard();
      })
      .catch(() => undefined)
      .finally(() => setArchitectBusy(false));
  }

  function approvePending(id: string) {
    void api
      .approveApproval(id)
      .then((res) => {
        if (Array.isArray(res.seats)) setRoster(res.seats);
        refreshBoard();
      })
      .catch(() => undefined);
  }

  function reparent(id: string, reportsTo: string) {
    patchLocalSeat(id, { reportsTo: reportsTo || undefined });
  }

  function patchLocalSeat(id: string, body: Partial<Seat>) {
    setRoster((r) => r.map((s) => (s.id === id ? { ...s, ...body } : s)));
    void api
      .patchSeat(id, body)
      .then(() => api.teams())
      .then((t) => {
        if (Array.isArray(t)) setTeamList(t);
      })
      .catch(() => undefined);
  }

  function patchRoom(id: string, body: Partial<Channel>) {
    setRooms((list) => list.map((c) => (c.id === id ? { ...c, ...body } : c)));
    void api.patchChannel(id, body).catch(() => undefined);
  }

  function onCreateTeam(body: {
    name: string;
    role?: string;
    description?: string;
    job?: string;
    rules?: string;
    defaultModel?: string;
    fallbackModel?: string;
    modelStrategy?: ModelStrategy;
    allowedModels?: string[];
    specialists?: Array<{ name: string; persona?: string; instructions?: string; model?: string; job?: string }>;
    projectId?: string;
  }) {
    void api
      .createTeam(body)
      .then(async (res) => {
        if (res.seats?.length) setRoster((r) => [...r, ...res.seats]);
        const [t, p] = await Promise.all([api.teams(), api.projects().catch(() => [])]);
        if (Array.isArray(t)) setTeamList(t);
        if (Array.isArray(p) && p.length) setProjectList(p);
        closeCreate();
        const id = res.team?.id;
        if (id) openConversation({ kind: "team", id }, { mode: "chart" });
        else {
          setMode("chart");
          openInspector();
        }
      })
      .catch(() => undefined);
  }

  function onCreateProject(body: { name: string; brief?: string; constitution?: string }) {
    void api
      .createProject(body)
      .then((p) => {
        setProjectList((list) => [...list.filter((x) => x.id !== p.id), p]);
        closeCreate();
        openConversation({ kind: "project", id: p.id }, { mode: "chart" });
      })
      .catch(() => undefined);
  }

  const visible = messages.filter((m) => m.channel === channel);
  const rosterList = showSystem ? roster : roster.filter((s) => !s.system);
  const listedRooms = rooms.filter((c) => !isDerivedRoom(c.id));
  const currentRoom = rooms.find((r) => r.id === channel);
  const channelName = currentRoom?.name || title;

  return (
    <div className="app-shell" data-testid="workspace-shell">
      <div className="app-top">
        <button
          className="pill-btn app-nav-toggle"
          onClick={() => setMobilePane((p) => (p === "nav" ? "none" : "nav"))}
          aria-label="Channels and roster"
        >
          Rooms
        </button>
        <Logo to="/" />
        <div className="seg">
          {(["room", "harness", "chart"] as Mode[]).map((m) => (
            <button
              key={m}
              data-testid={`mode-${m}`}
              className={mode === m ? "on" : ""}
              onClick={() => {
                setMode(m);
                setModalOpen(false);
                setSearchOpen(false);
                setCreateModal(null);
                if (m === "chart") openInspector();
                else setMobilePane("none");
              }}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <span className="mono app-meta">{title}</span>
        <div className="app-desktop-actions">
          <SearchButton className="workspace-search" testId="workspace-search" label="Search" onClick={openSearch} />
          <Link to="/app/blocks" className="pill-btn" data-testid="open-block-kit">
            Block Kit
          </Link>
          <Link to="/app/settings" className="pill-btn">
            Settings
          </Link>
          <Link to="/access" className="pill-btn primary">
            Access
          </Link>
        </div>
      </div>
      {mobilePane !== "none" && <button className="scrim" aria-label="Close panel" onClick={() => setMobilePane("none")} />}
      <div className={`app-body ${inspectorOpen ? "has-inspector" : ""}`}>
        <aside className={`rail ${mobilePane === "nav" ? "open" : ""}`}>
          <div className="rail-section-head">
            <div className="rail-label">Channels</div>
            <RailPlus testId="create-channel" label="New channel" onClick={() => openCreate("channel")} />
          </div>
          {listedRooms.map((c) => (
            <div
              key={c.id}
              data-testid={`channel-${c.id}`}
              className={`ch ${focus.kind === "channel" && focus.id === c.id ? "on" : ""}`}
              onClick={() => openConversation({ kind: "channel", id: c.id })}
            >
              {c.name}
            </div>
          ))}
          <div className="rail-section-head">
            <div className="rail-label">Projects</div>
            <div className="rail-section-actions">
              <SearchButton testId="search-projects" label="Search projects" onClick={openSearch} />
              <RailPlus testId="create-project" label="New project" onClick={() => openCreate("project")} />
            </div>
          </div>
          {projectList.map((p) => (
            <div
              key={p.id}
              data-testid={`project-${p.id}`}
              className={`ch ${focus.kind === "project" && focus.id === p.id ? "on" : ""}`}
              onClick={() => openConversation({ kind: "project", id: p.id })}
            >
              {p.name} <span className="dim">· {projectTeamCount(p)}</span>
            </div>
          ))}
          <div className="rail-section-head">
            <div className="rail-label">Teams</div>
            <div className="rail-section-actions">
              <SearchButton testId="search-teams" label="Search teams" onClick={openSearch} />
              <RailPlus testId="create-team" label="New team" onClick={() => openCreate("team")} />
            </div>
          </div>
          {panelTeams.map((t) => (
            <div
              key={t.id}
              data-testid={`team-${t.id}`}
              className={`ch ${focus.kind === "team" && focus.id === t.id ? "on" : ""}`}
              onClick={() => openConversation({ kind: "team", id: t.id })}
            >
              {t.name} <span className="dim">· {t.seatCount ?? t.seatIds.length}</span>
            </div>
          ))}
          <div className="rail-section-head">
            <div className="rail-label">Seats</div>
            <div className="rail-section-actions">
              <SearchButton testId="search-seats" label="Search seats" onClick={openSearch} />
              <RailPlus testId="hire-seat" label="Hire seat" onClick={() => openCreate("seat")} />
            </div>
          </div>
          {rosterList.map((s) => (
            <div
              key={s.id}
              data-testid={`roster-${s.id}`}
              className={`ch ${focus.kind === "dm" && focus.seatId === s.id ? "on" : ""}`}
              onClick={() => {
                setSelectedId(s.id);
                openConversation({ kind: "dm", seatId: s.id }, { inspector: true });
              }}
            >
              <SeatAvatar seed={s.id} kind={s.kind} size={16} />
              {s.name}
            </div>
          ))}
          <div className="rail-section-head">
            <div className="rail-label">Sessions</div>
          </div>
          <div data-testid="rail-sessions">
            {harnessSessions.length === 0 && <p className="micro dim">No live harness sessions.</p>}
            {harnessSessions.map((s) => (
              <div
                key={s.id}
                data-testid={`session-${s.id}`}
                className={`ch ${
                  (s.seatId && focus.kind === "dm" && focus.seatId === s.seatId) ||
                  (!s.seatId && focus.kind === "channel" && focus.id === `session-${s.id}`)
                    ? "on"
                    : ""
                }`}
                onClick={() => {
                  if (s.seatId) {
                    setSelectedId(s.seatId);
                    openConversation({ kind: "dm", seatId: s.seatId });
                    return;
                  }
                  openConversation({ kind: "channel", id: s.channel || `session-${s.id}` });
                }}
              >
                {s.seatId || s.agent || s.title} <span className="dim">· {s.harness}</span>
              </div>
            ))}
          </div>
          <Link to="/app/blocks" className="pill-btn mobile-only" style={{ marginTop: 8, width: "100%" }} data-testid="open-block-kit-mobile">
            Block Kit
          </Link>
        </aside>
        <main className="app-main">
          {mode === "room" && (
            <>
              <ConversationHeader
                title={title}
                members={members}
                tab={roomTab}
                inspectorOpen={inspectorOpen}
                debugOpen={debugOpen}
                onTab={setRoomTab}
                onOpenSearch={openSearch}
                onTitleClick={() => setModalOpen(true)}
                onOpenSeat={openSeat}
                onToggleInspector={() => (inspectorOpen ? closeInspector() : openInspector())}
                onToggleDebug={toggleDebug}
              />
              {roomTab === "messages" && (
                <div className={`room-split ${debugOpen ? "has-debug" : ""}`}>
                  <div className="room-col">
                    <div className="main thread">
                      <TaskBoard
                        tasks={tasks}
                        onClaim={(id) => {
                          void api
                            .claimTask(id, selectedId)
                            .then((row) => setTasks((cur) => cur.map((t) => (t.id === row.id ? row : t))))
                            .catch(() => undefined);
                        }}
                        onComplete={(id) => {
                          void api
                            .completeTask(id, selectedId)
                            .then((row) =>
                              setTasks((cur) =>
                                cur.map((t) => (t.id === row.id ? row : t)),
                              ),
                            )
                            .catch(() => undefined);
                        }}
                      />
                      {visible.length === 0 && <p className="micro">No messages in {title}. Say something.</p>}
                      {visible.map((m) => (
                        <MessageRow
                          key={m.id}
                          msg={m}
                          roster={roster}
                          selected={seatForMessage(m, roster)?.id === selectedId}
                          onOpenSeat={openSeat}
                          onBlockAction={(msg, action) => {
                            void api
                              .blockAction({
                                messageId: msg.id,
                                actionId: action.actionId,
                                value: action.value,
                                userId: "you",
                              })
                              .catch(() => undefined);
                          }}
                        />
                      ))}
                    </div>
                    <Composer
                      channelName={channelName}
                      onSend={send}
                      sendError={sendError}
                      mentions={[
                        { id: "channel", title: "@channel", subtitle: "Notify everyone in this room", testId: "picker-item-channel" },
                        ...panelTeams
                          .filter((t) => t.staffed !== false)
                          .map((t) => ({ id: `team-${t.id}`, title: t.name.startsWith("@") ? t.name : `@${t.id}`, subtitle: t.job || t.role || "Team", testId: `picker-item-team-${t.id}` })),
                        ...roster.map((s) => ({
                          id: s.id,
                          title: `@${s.name.replace(/\s+/g, "")}`,
                          subtitle: s.role,
                          testId: `picker-item-seat-${s.id}`,
                        })),
                      ]}
                    />
                  </div>
                  {debugOpen && <ChatDebugPanel channel={channel} />}
                </div>
              )}
              {roomTab === "files" && <FilesLinksPane messages={messages.filter((m) => m.channel === channel)} />}
            </>
          )}
          {mode === "harness" && <HarnessTerm seat={selected} />}
          {mode === "chart" && (
            <ChartPane
              roster={roster}
              showSystem={showSystem}
              onShowSystem={setShowSystem}
              liveId={selected.id}
              selected={selected}
              selectedTeamId={selectedTeamId}
              selectedProjectId={focus.kind === "project" ? focus.id : null}
              onSelect={(s) => {
                setSelectedId(s.id);
                openInspector();
              }}
              onSelectTeam={(t) => openConversation({ kind: "team", id: t.id }, { mode: "chart" })}
              onSelectProject={(p) => openConversation({ kind: "project", id: p.id }, { mode: "chart" })}
              onAttach={(s) => attachSeat(s.id)}
              teams={panelTeams}
              onStartHire={() => openCreate("seat")}
              onStartCreateProject={() => openCreate("project")}
              projects={projectList}
              preview={previewFromPlan(pendingPlan, roster)}
              architectMsgs={architectMsgs}
              architectBusy={architectBusy}
              architectDebug={debugOpen}
              onArchitectSend={sendArchitect}
              onArchitectApply={applyArchitect}
              onArchitectRevise={() => sendArchitect("Revise that plan. Keep it smaller.")}
              onToggleDebug={toggleDebug}
              unreadBySeat={inboxUnread}
              claimedSeatIds={tasks.filter((t) => t.status === "claimed" && t.claimedBy).map((t) => t.claimedBy as string)}
              pendingApprovals={approvals.filter((a) => a.status === "pending")}
              onApprovePending={approvePending}
            />
          )}
        </main>
        {inspectorOpen && (
          <Inspector
            seat={selected}
            roster={roster}
            models={models}
            open={mobilePane === "seat" || inspectorOpen}
            onClose={closeInspector}
            onAttach={() => attachSeat(selected.id)}
            onOpenRoom={() => {
              setSelectedId(selected.id);
              openConversation({ kind: "dm", seatId: selected.id }, { inspector: true });
            }}
            onReparent={(reportsTo) => reparent(selected.id, reportsTo)}
            onPatch={(body) => patchLocalSeat(selected.id, body)}
            onFire={() => fireSeat(selected.id)}
            onPause={() => pauseSelected(selected.id)}
            onResume={() => resumeSelected(selected.id)}
            onInboxChange={refreshBoard}
          />
        )}
      </div>
      {searchOpen && (
        <SearchModal
          rooms={listedRooms}
          roster={roster}
          teams={panelTeams}
          projects={projectList}
          messages={messages}
          currentTitle={title}
          currentChannel={channel}
          roomLabel={roomLabel}
          onClose={() => setSearchOpen(false)}
          onSelect={onSearchHit}
        />
      )}
      {createModal && (
        <div className="modal-scrim" data-testid="create-modal" onClick={closeCreate}>
          <div
            className="channel-editor create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            {createModal === "channel" && <CreateChannelForm onCreate={addRoom} onCancel={closeCreate} />}
            {createModal === "project" && <CreateProjectForm onCreate={onCreateProject} onCancel={closeCreate} />}
            {createModal === "team" && (
              <CreateTeamForm
                models={models}
                projects={projectList}
                defaultProject={teamProject}
                onCreate={onCreateTeam}
                onCancel={closeCreate}
              />
            )}
            {createModal === "seat" && (
              <HireForm
                roster={roster}
                teams={panelTeams}
                models={models}
                projects={projectList}
                defaultTeam={hireTeam}
                defaultProject={hireProject}
                onHire={hireSeat}
                onCancel={closeCreate}
              />
            )}
          </div>
        </div>
      )}
      {modalOpen && (
        <div className="modal-scrim" data-testid="conversation-modal" onClick={() => setModalOpen(false)}>
          <div className="channel-editor" onClick={(e) => e.stopPropagation()}>
            {focus.kind === "channel" && (
              <ChannelEditor
                embedded
                channel={currentRoom || { id: channel, name: channelName }}
                roster={roster}
                teams={panelTeams}
                onPatch={(body) => patchRoom(channel, body)}
                onClose={() => setModalOpen(false)}
              />
            )}
            {focus.kind === "team" && selectedTeam && (
              <TeamInspector
                className="inspector-modal"
                team={enrichTeam(selectedTeam, roster)}
                roster={roster}
                models={models}
                open
                onClose={() => setModalOpen(false)}
                onSelectSeat={(id) => {
                  setSelectedId(id);
                  setModalOpen(false);
                  openInspector();
                }}
                onPatchTeam={(body) => {
                  setTeamList((list) => list.map((t) => (t.id === selectedTeam.id ? { ...t, ...body } : t)));
                  void api.patchTeam(selectedTeam.id, body).then((t) => {
                    setTeamList((list) => list.map((x) => (x.id === t.id ? t : x)));
                  });
                }}
                onHireSpecialist={() => {
                  openCreate("seat", { teamId: selectedTeam.id, projectId: selectedTeam.projectId || "" });
                }}
                onPauseTeam={() => {
                  void api.pauseTeam(selectedTeam.id).then(() => refreshBoard()).catch(() => undefined);
                }}
              />
            )}
            {focus.kind === "project" && selectedProject && (
              <ProjectInspector
                className="inspector-modal"
                project={selectedProject}
                roster={roster}
                teams={panelTeams}
                goals={goals}
                open
                onClose={() => setModalOpen(false)}
                onPatchProject={(body) => {
                  setProjectList((list) => list.map((p) => (p.id === selectedProject.id ? { ...p, ...body } : p)));
                  void api.patchProject(selectedProject.id, body).then((p) => {
                    setProjectList((list) => list.map((x) => (x.id === p.id ? p : x)));
                  });
                }}
                onHireSpecialist={() => {
                  openCreate("seat", { projectId: selectedProject.id });
                }}
                onNewTeam={() => {
                  openCreate("team", { projectId: selectedProject.id });
                }}
              />
            )}
            {focus.kind === "dm" && (
              <Inspector
                className="inspector-modal"
                testId="seat-inspector-modal"
                seat={selected}
                roster={roster}
                models={models}
                open
                onClose={() => setModalOpen(false)}
                onAttach={() => attachSeat(selected.id)}
                onOpenRoom={() => setModalOpen(false)}
                onReparent={(reportsTo) => reparent(selected.id, reportsTo)}
                onPatch={(body) => patchLocalSeat(selected.id, body)}
                onFire={() => fireSeat(selected.id)}
              />
            )}
          </div>
        </div>
      )}
      <nav className="dock" aria-label="Mobile">
        <button className={mobilePane === "nav" ? "on" : ""} onClick={() => setMobilePane((p) => (p === "nav" ? "none" : "nav"))}>
          Rooms
        </button>
        <button className={mobilePane === "none" ? "on" : ""} onClick={() => setMobilePane("none")}>
          Room
        </button>
        <button
          className={inspectorOpen ? "on" : ""}
          onClick={() => (inspectorOpen ? closeInspector() : openInspector())}
        >
          Seat
        </button>
      </nav>
    </div>
  );
}

function RailPlus({ testId, label, onClick }: { testId: string; label: string; onClick: () => void }) {
  return (
    <button type="button" className="rail-plus" data-testid={testId} aria-label={label} onClick={onClick}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.25v9.5M1.25 6h9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function CreateChannelForm({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  return (
    <form
      className="hire-form"
      data-testid="create-channel-form"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        onCreate(n);
      }}
    >
      <strong id="create-dialog-title">New channel</strong>
      <p className="micro">Adds a room on the rail. Set topic and members after it exists.</p>
      <div className="hire-grid">
        <label style={{ gridColumn: "1 / -1" }}>
          Name
          <input
            data-testid="channel-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="design"
            autoFocus
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="pill-btn primary" data-testid="channel-create-submit" type="submit">
          Create channel
        </button>
        <button className="pill-btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ChartPane({
  roster,
  projects,
  preview,
  showSystem,
  onShowSystem,
  liveId,
  selected,
  selectedTeamId,
  selectedProjectId,
  onSelect,
  onSelectTeam,
  onSelectProject,
  onAttach,
  teams,
  onStartHire,
  onStartCreateProject,
  architectMsgs,
  architectBusy,
  architectDebug,
  onArchitectSend,
  onArchitectApply,
  onArchitectRevise,
  onToggleDebug,
  unreadBySeat = {},
  claimedSeatIds = [],
  pendingApprovals = [],
  onApprovePending,
}: {
  roster: Seat[];
  projects: Project[];
  preview: ReturnType<typeof previewFromPlan>;
  showSystem: boolean;
  onShowSystem: (v: boolean) => void;
  liveId?: string;
  selected: Seat;
  selectedTeamId?: string | null;
  selectedProjectId?: string | null;
  onSelect: (s: Seat) => void;
  onSelectTeam?: (t: Team) => void;
  onSelectProject?: (p: Project) => void;
  onAttach: (s: Seat) => void;
  teams: Team[];
  onStartHire: () => void;
  onStartCreateProject: () => void;
  architectMsgs: ArchitectMsg[];
  architectBusy: boolean;
  architectDebug?: boolean;
  onArchitectSend: (text: string) => void;
  onArchitectApply: (plan: OrgPlan) => void;
  onArchitectRevise: () => void;
  onToggleDebug?: () => void;
  unreadBySeat?: Record<string, number>;
  claimedSeatIds?: string[];
  pendingApprovals?: Approval[];
  onApprovePending?: (id: string) => void;
}) {
  const [layoutResetKey, setLayoutResetKey] = useState(0);
  const [dock, setDock] = useState<DockLayout>(loadDock);
  const narrow = useNarrowChart();
  return (
    <div className={`chart-workspace ${narrow ? "is-narrow" : ""} ${dock.collapsed ? "dock-collapsed" : ""}`}>
      <div className="chart-canvas" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <div className="chart-toolbar">
          <label className="check">
            <input type="checkbox" checked={showSystem} onChange={(e) => onShowSystem(e.target.checked)} />
            Show system seats
          </label>
          <button className="pill-btn" data-testid="create-project-chart" type="button" onClick={onStartCreateProject}>
            New project
          </button>
          <button className="pill-btn primary" data-testid="hire-seat-chart" type="button" onClick={onStartHire}>
            Hire seat
          </button>
          {onToggleDebug && (
            <button
              type="button"
              className={`pill-btn ${architectDebug ? "on" : ""}`}
              data-testid="toggle-debug-chart"
              onClick={onToggleDebug}
            >
              Debug
            </button>
          )}
          <button
            className="pill-btn"
            data-testid="reset-chart-layout"
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem(COLLAPSED_KEY);
              } catch {
                /* ignore */
              }
              setLayoutResetKey((n) => n + 1);
            }}
          >
            Reset layout
          </button>
        </div>
        <OrgChart
          roster={roster}
          teams={teams}
          projects={projects}
          preview={preview}
          showSystem={showSystem}
          liveId={liveId}
          selectedId={selected.id}
          selectedTeamId={selectedTeamId}
          selectedProjectId={selectedProjectId}
          onSelect={onSelect}
          onSelectTeam={onSelectTeam}
          onSelectProject={onSelectProject}
          onAttach={onAttach}
          resetLayoutKey={layoutResetKey}
          unreadBySeat={unreadBySeat}
          claimedSeatIds={claimedSeatIds}
        />
      </div>
      {!dock.collapsed && <ChartSplitter dock={dock} onChange={setDock} narrow={narrow} />}
      {dock.collapsed ? (
        <div className="architect-collapsed">
          <button
            type="button"
            className="architect-reopen"
            data-testid="architect-reopen"
            onClick={() => {
              const next = { ...dock, collapsed: false };
              saveDock(next);
              setDock(next);
            }}
          >
            Architect
          </button>
          {architectDebug && <ChatDebugPanel scope="architect" compact />}
        </div>
      ) : (
        <div className="architect-dock-wrap" style={narrow ? { height: dock.height, width: "100%" } : { width: dock.width }}>
          <ArchitectDock
            messages={architectMsgs}
            busy={architectBusy}
            onSend={onArchitectSend}
            onApply={onArchitectApply}
            onRevise={onArchitectRevise}
            showDebug={architectDebug}
            pendingApprovals={pendingApprovals}
            onApprovePending={onApprovePending}
          />
        </div>
      )}
    </div>
  );
}

function modelValue(m: CatalogModel) {
  return `${m.providerID}/${m.modelID}`;
}

function modelLabel(m: CatalogModel) {
  const id = modelValue(m);
  const name = (m.name || "").trim();
  if (name && name !== id) return name.length > 36 ? `${name.slice(0, 34)}…` : name;
  return id.length > 36 ? `${id.slice(0, 34)}…` : id;
}

function HireForm({
  roster,
  teams,
  models,
  projects,
  defaultTeam,
  defaultProject,
  onHire,
  onCancel,
}: {
  roster: Seat[];
  teams: Team[];
  models: CatalogModel[];
  projects: Project[];
  defaultTeam: string;
  defaultProject?: string;
  onHire: (s: Seat) => void;
  onCancel: () => void;
}) {
  const staffed = teams.filter((t) => t.staffed !== false);
  const [kind, setKind] = useState<SeatKind>("bot");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [team, setTeam] = useState(defaultTeam || "");
  const [projectId, setProjectId] = useState(defaultProject || staffed.find((t) => t.id === defaultTeam)?.projectId || "");
  const [reportsTo, setReportsTo] = useState("you");
  const [job, setJob] = useState("");
  const [persona, setPersona] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState(models[0] ? modelValue(models[0]) : "");
  const [fallback, setFallback] = useState("");
  const humans = roster.filter((s) => s.kind === "human");
  const managers = roster.filter((s) => !s.system);
  const picked = staffed.find((t) => t.id === team);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const id = slugify(n) || `seat-${Date.now()}`;
    if (roster.some((s) => s.id === id)) return;
    const seatType: SeatType = kind === "human" ? "human" : "specialist";
    onHire({
      id,
      name: n,
      role: role.trim() || (kind === "human" ? "Teammate" : "Specialist"),
      kind,
      seatType,
      team: team || undefined,
      projectId: projectId || picked?.projectId || undefined,
      reportsTo: reportsTo || picked?.supervisorSeatId || undefined,
      tools: kind === "human" ? ["approve"] : ["read"],
      deny: kind === "bot" ? ["deploy"] : [],
      model: kind === "bot" ? model || picked?.defaultModel || undefined : undefined,
      fallbackModel: kind === "bot" ? fallback || undefined : undefined,
      persona: kind === "bot" ? persona.trim() || undefined : undefined,
      instructions: kind === "bot" ? instructions.trim() || undefined : undefined,
      job: job.trim() || (kind === "human" ? "Human seat on the org chart." : "Specialist OpenCode agent."),
      status: "idle",
    });
  }

  return (
    <form className="hire-form" data-testid="hire-form" onSubmit={submit}>
      <strong id="create-dialog-title">Hire a seat</strong>
      <p className="micro">Supervisor and Generic are created with a team. Hire a specialist when you need a specific persona and prompt.</p>
      <div className="hire-grid">
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as SeatKind)}>
            <option value="human">Human</option>
            <option value="bot">Bot specialist</option>
          </select>
        </label>
        <label>
          Team
          <select
            value={team}
            onChange={(e) => {
              setTeam(e.target.value);
              const next = staffed.find((t) => t.id === e.target.value);
              if (next?.projectId) setProjectId(next.projectId);
            }}
            data-testid="hire-team"
          >
            <option value="">No team</option>
            {staffed.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="hire-project">
            <option value="">Org-shared</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder={kind === "human" ? "Alex" : "Eng.Mobile"} autoFocus />
        </label>
        <label>
          Role
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder={kind === "human" ? "Design lead" : "Implement"} />
        </label>
        <label>
          Reports to
          <select value={reportsTo} onChange={(e) => setReportsTo(e.target.value)}>
            <option value="">Board (no manager)</option>
            {picked?.supervisorSeatId && <option value={picked.supervisorSeatId}>Team supervisor</option>}
            {managers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.kind === "human" ? "(human)" : ""}
              </option>
            ))}
            <option value="services">Services lane</option>
          </select>
        </label>
        {kind === "bot" && (
          <>
            <label>
              Default model
              <select data-testid="hire-model" value={model} onChange={(e) => setModel(e.target.value)}>
                {models.length === 0 && <option value="">No OpenCode models configured</option>}
                {models.map((m) => (
                  <option key={modelValue(m)} value={modelValue(m)} title={modelValue(m)}>
                    {modelLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fallback model
              <select data-testid="hire-fallback" value={fallback} onChange={(e) => setFallback(e.target.value)}>
                <option value="">None</option>
                {models.map((m) => (
                  <option key={`hfb-${modelValue(m)}`} value={modelValue(m)} title={modelValue(m)}>
                    {modelLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label style={{ gridColumn: "1 / -1" }}>
          Job
          <input value={job} onChange={(e) => setJob(e.target.value)} placeholder="One line" />
        </label>
        {kind === "bot" && (
          <>
            <label style={{ gridColumn: "1 / -1" }}>
              Persona
              <input data-testid="hire-persona" value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Who this agent is" />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Instructions
              <textarea data-testid="hire-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} placeholder="How this agent works" />
            </label>
          </>
        )}
      </div>
      {kind === "human" && humans.length >= 1 && (
        <p className="micro">Humans sit on the tree. Assign them under any seat.</p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="pill-btn primary" data-testid="hire-submit" type="submit">
          Hire
        </button>
        <button className="pill-btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CreateTeamForm({
  models,
  projects,
  defaultProject,
  onCreate,
  onCancel,
}: {
  models: CatalogModel[];
  projects: Project[];
  defaultProject?: string;
  onCreate: (body: {
    name: string;
    role?: string;
    description?: string;
    job?: string;
    rules?: string;
    defaultModel?: string;
    fallbackModel?: string;
    modelStrategy?: ModelStrategy;
    allowedModels?: string[];
    specialists?: Array<{ name: string; persona?: string; instructions?: string; model?: string; job?: string }>;
    projectId?: string;
  }) => void;
  onCancel: () => void;
}) {
  const first = models[0] ? modelValue(models[0]) : "";
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(defaultProject || projects[0]?.id || "");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [job, setJob] = useState("");
  const [rules, setRules] = useState("");
  const [defaultModel, setDefaultModel] = useState(first);
  const [fallbackModel, setFallbackModel] = useState(first);
  const [modelStrategy, setModelStrategy] = useState<ModelStrategy>("default");
  const [specialistName, setSpecialistName] = useState("");
  const [specialistJob, setSpecialistJob] = useState("");
  return (
    <form
      className="hire-form"
      data-testid="create-team-form"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        const specialists = specialistName.trim()
          ? [{ name: specialistName.trim(), job: specialistJob.trim() || undefined, model: defaultModel }]
          : [];
        onCreate({
          name: n,
          role: role.trim() || undefined,
          description: description.trim() || undefined,
          job: job.trim() || undefined,
          rules: rules.trim() || undefined,
          defaultModel: defaultModel || undefined,
          fallbackModel: fallbackModel || undefined,
          modelStrategy,
          allowedModels: [defaultModel, fallbackModel].filter(Boolean),
          specialists,
          projectId: projectId || undefined,
        });
      }}
    >
      <strong id="create-dialog-title">New team</strong>
      <p className="micro">Creates a Supervisor and a Generic seat. Set the job, rules, and optional specialists now.</p>
      <div className="hire-grid">
        <label>
          Name
          <input data-testid="team-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="platform" autoFocus />
        </label>
        <label>
          Project
          <select data-testid="team-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Org-shared</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <input data-testid="team-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Platform engineering" />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Description
          <input data-testid="team-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this team exists to do" />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Job duty
          <input data-testid="team-job" value={job} onChange={(e) => setJob(e.target.value)} placeholder="Own the platform worktree" />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Special rules
          <textarea data-testid="team-rules" value={rules} onChange={(e) => setRules(e.target.value)} rows={3} placeholder="Never deploy. Supervisor routes first." />
        </label>
        <label>
          Default model
          <select data-testid="team-default-model" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
            {models.length === 0 && <option value="">No OpenCode models configured</option>}
            {models.map((m) => (
              <option key={modelValue(m)} value={modelValue(m)} title={modelValue(m)}>
                {modelLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fallback model
          <select data-testid="team-fallback-model" value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)}>
            {models.length === 0 && <option value="">No OpenCode models configured</option>}
            {models.map((m) => (
              <option key={`fb-${modelValue(m)}`} value={modelValue(m)} title={modelValue(m)}>
                {modelLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model strategy
          <select data-testid="team-strategy" value={modelStrategy} onChange={(e) => setModelStrategy(e.target.value as ModelStrategy)}>
            <option value="default">Default then fallback</option>
            <option value="random">Random from allowed</option>
            <option value="round_robin">Round robin</option>
            <option value="fuse">Fuse (try in order)</option>
          </select>
        </label>
        <label>
          First specialist
          <input data-testid="team-specialist-name" value={specialistName} onChange={(e) => setSpecialistName(e.target.value)} placeholder="Platform.API" />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Specialist job
          <input data-testid="team-specialist-job" value={specialistJob} onChange={(e) => setSpecialistJob(e.target.value)} placeholder="Own the API worktree" />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="pill-btn primary" data-testid="team-create-submit" type="submit">
          Create team
        </button>
        <button className="pill-btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CreateProjectForm({
  onCreate,
  onCancel,
}: {
  onCreate: (body: { name: string; brief?: string; constitution?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [constitution, setConstitution] = useState("");
  return (
    <form
      className="hire-form"
      data-testid="create-project-form"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        onCreate({
          name: n,
          brief: brief.trim() || undefined,
          constitution: constitution.trim() || undefined,
        });
      }}
    >
      <strong id="create-dialog-title">New project</strong>
      <p className="micro">Adds a project column on the Chart. Hire a PM or add a team after it exists.</p>
      <div className="hire-grid">
        <label>
          Name
          <input data-testid="project-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="mobile" autoFocus />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Brief
          <input data-testid="project-brief" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What this product ships" />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Constitution
          <textarea
            data-testid="project-constitution"
            value={constitution}
            onChange={(e) => setConstitution(e.target.value)}
            rows={3}
            placeholder="How this project is staffed and decided"
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="pill-btn primary" data-testid="project-create-submit" type="submit">
          Create project
        </button>
        <button className="pill-btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Inspector({
  seat,
  roster,
  models,
  open,
  onClose,
  onAttach,
  onOpenRoom,
  onReparent,
  onPatch,
  onFire,
  onPause,
  onResume,
  onInboxChange,
  testId = "seat-inspector",
  className = "",
}: {
  seat: Seat;
  roster: Seat[];
  models: CatalogModel[];
  open: boolean;
  onClose: () => void;
  onAttach: () => void;
  onOpenRoom: () => void;
  onReparent: (reportsTo: string) => void;
  onPatch: (body: Partial<Seat>) => void;
  onFire?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onInboxChange?: () => void;
  testId?: string;
  className?: string;
}) {
  const managers = roster.filter((s) => s.id !== seat.id && !wouldCycle(seat.id, s.id, roster));
  const catalog = models.some((m) => modelValue(m) === seat.model) || !seat.model
    ? models
    : [{ providerID: seat.model.split("/")[0] || "xai", modelID: seat.model.split("/").slice(1).join("/") || seat.model, name: seat.model }, ...models];
  return (
    <aside className={`inspector ${open ? "open" : ""} ${className}`.trim()} data-testid={testId}>
      <div className="inspector-head">
        <h4>Seat</h4>
        <button className="pill-btn inspector-close" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <h3 style={{ margin: "0 0 8px" }}>{seat.name}</h3>
      <div className="kv">
        <span>Kind</span>
        <b>
          {seat.kind}
          {seat.seatType ? ` · ${seat.seatType}` : ""}
          {seat.system ? " · system" : ""}
        </b>
      </div>
      <div className="kv">
        <span>Role</span>
        <b>{seat.role}</b>
      </div>
      <div className="kv">
        <span>Status</span>
        <b data-testid="seat-status">{seat.status}</b>
      </div>
      {seat.team && (
        <div className="kv">
          <span>Team</span>
          <b>@{seat.team}</b>
        </div>
      )}
      {seat.projectId && (
        <div className="kv">
          <span>Project</span>
          <b>{seat.projectId}</b>
        </div>
      )}
      <label className="kv-label">
        Reports to
        <select value={seat.reportsTo || ""} onChange={(e) => onReparent(e.target.value)} disabled={seat.id === "you"}>
          <option value="">Board</option>
          {managers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {seat.kind === "bot" && <option value="services">Services lane</option>}
        </select>
      </label>
      {seat.kind === "bot" ? (
        <>
          <label className="kv-label">
            Default model
            <select data-testid="seat-model" value={seat.model || ""} onChange={(e) => onPatch({ model: e.target.value })}>
              {catalog.length === 0 && <option value="">No OpenCode models configured</option>}
              {catalog.map((m) => (
                <option key={modelValue(m)} value={modelValue(m)} title={modelValue(m)}>
                  {modelLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="kv-label">
            Fallback model
            <select data-testid="seat-fallback-model" value={seat.fallbackModel || ""} onChange={(e) => onPatch({ fallbackModel: e.target.value })}>
              <option value="">None</option>
              {catalog.map((m) => (
                <option key={`fb-${modelValue(m)}`} value={modelValue(m)} title={modelValue(m)}>
                  {modelLabel(m)}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <div className="kv">
          <span>Model</span>
          <b>—</b>
        </div>
      )}
      <p style={{ color: "var(--muted)", fontSize: 13 }}>{seat.job}</p>
      {seat.kind === "bot" && (
        <>
          <label className="kv-label">
            Persona
            <textarea
              data-testid="seat-persona"
              rows={2}
              defaultValue={seat.persona || ""}
              key={`${seat.id}-persona`}
              onBlur={(e) => onPatch({ persona: e.target.value })}
            />
          </label>
          <label className="kv-label">
            Instructions
            <textarea
              data-testid="seat-instructions"
              rows={4}
              defaultValue={seat.instructions || ""}
              key={`${seat.id}-instructions`}
              onBlur={(e) => onPatch({ instructions: e.target.value })}
            />
          </label>
        </>
      )}
      <h4 style={{ marginTop: 16 }}>Allow</h4>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {seat.tools.map((t) => (
          <span className="chip ok" key={t}>
            {t}
          </span>
        ))}
      </div>
      <h4 style={{ marginTop: 16 }}>Deny</h4>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {seat.deny.map((t) => (
          <span className="chip no" key={t}>
            {t}
          </span>
        ))}
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
        {seat.kind === "bot" && (
          <button className="pill-btn primary" data-testid="attach-harness" onClick={onAttach}>
            Attach harness
          </button>
        )}
        {seat.kind === "bot" && seat.status !== "paused" && onPause && (
          <button className="pill-btn" data-testid="pause-seat" type="button" onClick={onPause}>
            Pause
          </button>
        )}
        {seat.kind === "bot" && seat.status === "paused" && onResume && (
          <button className="pill-btn" data-testid="resume-seat" type="button" onClick={onResume}>
            Resume
          </button>
        )}
        <button className="pill-btn" onClick={onOpenRoom}>
          Open in room
        </button>
        {onFire && seat.id !== "you" && !seat.system && (
          <button
            className="pill-btn"
            data-testid="fire-seat"
            type="button"
            onClick={() => {
              if (window.confirm(`Fire ${seat.name}? Reports will move to their manager.`)) onFire();
            }}
          >
            Fire seat
          </button>
        )}
      </div>
      <SeatInbox seatId={seat.id} onChange={onInboxChange} />
    </aside>
  );
}

function SeatInbox({ seatId, onChange }: { seatId: string; onChange?: () => void }) {
  const [box, setBox] = useState<{
    items: Array<{ id: string; from?: string; text?: string; unread?: boolean; kind?: string }>;
    unread: number;
  } | null>(null);
  useEffect(() => {
    void api
      .inbox(seatId)
      .then((out) => setBox(out))
      .catch(() => setBox(null));
  }, [seatId]);
  const unread = (box?.items || []).filter((i) => i.unread);
  return (
    <div className="seat-inbox" data-testid="seat-inbox">
      <h4 style={{ marginTop: 16 }}>Inbox</h4>
      {!box && <p className="micro">No inbox yet.</p>}
      {box && unread.length === 0 && <p className="micro">Caught up.</p>}
      {unread.slice(-8).map((item) => (
        <p key={item.id} className="micro" data-testid={`inbox-item-${item.id}`}>
          {item.from || "bus"}: {String(item.text || "").slice(0, 80)}
        </p>
      ))}
      {box && box.unread > 0 && (
        <button
          className="pill-btn"
          data-testid="inbox-mark-read"
          type="button"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => {
            const last = box.items[box.items.length - 1]?.id;
            void api
              .markInboxRead(seatId, last)
              .then(() => api.inbox(seatId))
              .then((out) => {
                setBox(out);
                onChange?.();
              })
              .catch(() => undefined);
          }}
        >
          Mark read ({box.unread})
        </button>
      )}
    </div>
  );
}

function ProjectInspector({
  project,
  roster,
  teams,
  goals = [],
  open,
  onClose,
  onPatchProject,
  onHireSpecialist,
  onNewTeam,
  className = "",
}: {
  project: Project;
  roster: Seat[];
  teams: Team[];
  goals?: Goal[];
  open: boolean;
  onClose: () => void;
  onPatchProject: (body: Partial<Project>) => void;
  onHireSpecialist: () => void;
  onNewTeam: () => void;
  className?: string;
}) {
  const projectTeams = teams.filter((t) => t.projectId === project.id || (project.teamIds || []).includes(t.id));
  const pm = roster.find((s) => s.id === project.pmSeatId);
  return (
    <aside className={`inspector ${open ? "open" : ""} ${className}`.trim()} data-testid="project-inspector">
      <div className="inspector-head">
        <h4>Project</h4>
        <button className="pill-btn inspector-close" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <h3 style={{ margin: "0 0 8px" }}>{project.name}</h3>
      <div className="kv">
        <span>Teams</span>
        <b data-testid="project-team-count">{projectTeams.length}</b>
      </div>
      {pm && (
        <div className="kv">
          <span>PM</span>
          <b>{pm.name}</b>
        </div>
      )}
      {(project.goalIds || []).length > 0 && (
        <div className="kv">
          <span>Goal</span>
          <b data-testid="project-goal">
            {goals.find((g) => g.id === project.goalIds![0])?.title || project.goalIds![0]}
          </b>
        </div>
      )}
      <label className="kv-label">
        Name
        <input data-testid="project-name-field" defaultValue={project.name} key={`${project.id}-name`} onBlur={(e) => onPatchProject({ name: e.target.value })} />
      </label>
      <label className="kv-label">
        Brief
        <textarea data-testid="project-brief-field" rows={2} defaultValue={project.brief || ""} key={`${project.id}-brief`} onBlur={(e) => onPatchProject({ brief: e.target.value })} />
      </label>
      <label className="kv-label">
        Constitution
        <textarea
          data-testid="project-constitution-field"
          rows={3}
          defaultValue={project.constitution || ""}
          key={`${project.id}-constitution`}
          onBlur={(e) => onPatchProject({ constitution: e.target.value })}
        />
      </label>
      {projectTeams.length > 0 && (
        <>
          <h4 style={{ marginTop: 16 }}>Teams</h4>
          {projectTeams.map((t) => (
            <div key={t.id} className="micro" style={{ marginTop: 6 }}>
              {t.name}
            </div>
          ))}
        </>
      )}
      <button className="pill-btn primary" data-testid="project-hire-specialist" type="button" style={{ width: "100%", marginTop: 16 }} onClick={onHireSpecialist}>
        Hire specialist
      </button>
      <button className="pill-btn" data-testid="project-new-team" type="button" style={{ width: "100%", marginTop: 8 }} onClick={onNewTeam}>
        New team
      </button>
    </aside>
  );
}

function TeamInspector({
  team,
  roster,
  models,
  open,
  onClose,
  onSelectSeat,
  onPatchTeam,
  onHireSpecialist,
  onPauseTeam,
  className = "",
}: {
  team: Team;
  roster: Seat[];
  models: CatalogModel[];
  open: boolean;
  onClose: () => void;
  onSelectSeat: (id: string) => void;
  onPatchTeam: (body: Partial<Team>) => void;
  onHireSpecialist: () => void;
  onPauseTeam?: () => void;
  className?: string;
}) {
  const members = (team.seatIds || []).map((id) => roster.find((s) => s.id === id)).filter(Boolean) as Seat[];
  const supervisor = members.find((s) => s.id === team.supervisorSeatId);
  const generic = members.find((s) => s.id === team.genericSeatId);
  const specialists = members.filter((s) => s.seatType === "specialist" || (!s.seatType && s.kind === "bot" && s.id !== team.supervisorSeatId && s.id !== team.genericSeatId));
  const humans = members.filter((s) => s.kind === "human");
  return (
    <aside className={`inspector ${open ? "open" : ""} ${className}`.trim()} data-testid="team-inspector">
      <div className="inspector-head">
        <h4>Team</h4>
        <button className="pill-btn inspector-close" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <h3 style={{ margin: "0 0 8px" }}>{team.name}</h3>
      <div className="kv">
        <span>Seats</span>
        <b data-testid="team-seat-count">{team.seatCount ?? members.length}</b>
      </div>
      <div className="kv">
        <span>Kind</span>
        <b>{team.staffed === false ? "run roster" : "staffed"}</b>
      </div>
      {team.staffed !== false && (
        <>
          <label className="kv-label">
            Role
            <input data-testid="team-role-field" defaultValue={team.role || ""} key={`${team.id}-role`} onBlur={(e) => onPatchTeam({ role: e.target.value })} />
          </label>
          <label className="kv-label">
            Description
            <textarea data-testid="team-description-field" rows={2} defaultValue={team.description || ""} key={`${team.id}-desc`} onBlur={(e) => onPatchTeam({ description: e.target.value })} />
          </label>
          <label className="kv-label">
            Job duty
            <textarea data-testid="team-job-field" rows={2} defaultValue={team.job || ""} key={`${team.id}-job`} onBlur={(e) => onPatchTeam({ job: e.target.value })} />
          </label>
          <label className="kv-label">
            Special rules
            <textarea data-testid="team-rules-field" rows={3} defaultValue={team.rules || ""} key={`${team.id}-rules`} onBlur={(e) => onPatchTeam({ rules: e.target.value })} />
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }} data-testid="team-models">
            {(team.models || []).map((m) => (
              <span className="chip" key={m}>
                {m}
              </span>
            ))}
            {(team.models || []).length === 0 && <span className="chip">no models yet</span>}
          </div>
          <label className="kv-label">
            Default model
            <select data-testid="team-model" value={team.defaultModel || ""} onChange={(e) => onPatchTeam({ defaultModel: e.target.value })}>
              {models.length === 0 && <option value="">No OpenCode models configured</option>}
              {models.map((m) => (
                <option key={modelValue(m)} value={modelValue(m)} title={modelValue(m)}>
                  {modelLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="kv-label">
            Fallback model
            <select data-testid="team-fallback" value={team.fallbackModel || ""} onChange={(e) => onPatchTeam({ fallbackModel: e.target.value })}>
              <option value="">None</option>
              {models.map((m) => (
                <option key={`tfb-${modelValue(m)}`} value={modelValue(m)} title={modelValue(m)}>
                  {modelLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="kv-label">
            Strategy
            <select data-testid="team-strategy-field" value={team.modelStrategy || "default"} onChange={(e) => onPatchTeam({ modelStrategy: e.target.value as ModelStrategy })}>
              <option value="default">Default then fallback</option>
              <option value="random">Random</option>
              <option value="round_robin">Round robin</option>
              <option value="fuse">Fuse</option>
            </select>
          </label>
        </>
      )}
      {supervisor && (
        <button className="pill-btn" type="button" style={{ width: "100%", marginTop: 8 }} onClick={() => onSelectSeat(supervisor.id)}>
          Supervisor · {supervisor.name}
        </button>
      )}
      {generic && (
        <button className="pill-btn" type="button" style={{ width: "100%", marginTop: 6 }} onClick={() => onSelectSeat(generic.id)}>
          Generic · {generic.name}
        </button>
      )}
      {humans.length > 0 && (
        <>
          <h4 style={{ marginTop: 16 }}>Humans</h4>
          {humans.map((s) => (
            <button key={s.id} className="pill-btn" type="button" style={{ width: "100%", marginTop: 6 }} onClick={() => onSelectSeat(s.id)}>
              {s.name}
            </button>
          ))}
        </>
      )}
      {specialists.length > 0 && (
        <>
          <h4 style={{ marginTop: 16 }}>Specialists</h4>
          {specialists.map((s) => (
            <button key={s.id} className="pill-btn" type="button" style={{ width: "100%", marginTop: 6 }} onClick={() => onSelectSeat(s.id)}>
              {s.name} · {s.model || "—"}
            </button>
          ))}
        </>
      )}
      {team.staffed !== false && (
        <>
          <button className="pill-btn primary" data-testid="hire-specialist" type="button" style={{ width: "100%", marginTop: 16 }} onClick={onHireSpecialist}>
            Hire specialist
          </button>
          {onPauseTeam && (
            <button className="pill-btn" data-testid="pause-team" type="button" style={{ width: "100%", marginTop: 8 }} onClick={onPauseTeam}>
              Pause team
            </button>
          )}
        </>
      )}
    </aside>
  );
}

function ChannelEditor({
  channel,
  roster,
  teams,
  onPatch,
  onClose,
  embedded = false,
}: {
  channel: Channel;
  roster: Seat[];
  teams: Team[];
  onPatch: (body: Partial<Channel>) => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const teamIds = channel.teamIds || [];
  const seatIds = channel.seatIds || [];
  const staffed = teams.filter((t) => t.staffed !== false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = (
      <div
        className={embedded ? "channel-editor-body" : "channel-editor"}
        data-testid="channel-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inspector-head">
          <strong id="channel-editor-title">Channel members</strong>
          <button className="pill-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="micro">Add or remove teams, seats, and people. @channel always includes the Channel conductor.</p>
        <label className="kv-label">
          Topic
          <input defaultValue={channel.topic || ""} key={`${channel.id}-topic`} onBlur={(e) => onPatch({ topic: e.target.value })} />
        </label>
        <h4>Teams</h4>
        <div className="member-picks">
          {staffed.map((t) => {
            const on = teamIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                className={`pill-btn ${on ? "on" : ""}`}
                data-testid={`channel-team-${t.id}`}
                onClick={() => onPatch({ teamIds: on ? teamIds.filter((id) => id !== t.id) : [...teamIds, t.id] })}
              >
                {t.name}
              </button>
            );
          })}
        </div>
        <h4>People and seats</h4>
        <div className="member-picks">
          {roster
            .filter((s) => !s.system)
            .map((s) => {
              const on = seatIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`pill-btn ${on ? "on" : ""}`}
                  data-testid={`channel-seat-${s.id}`}
                  onClick={() => onPatch({ seatIds: on ? seatIds.filter((id) => id !== s.id) : [...seatIds, s.id] })}
                >
                  {s.name}
                </button>
              );
            })}
        </div>
      </div>
  );
  if (embedded) return body;
  return (
    <div className="modal-scrim" data-testid="channel-editor-scrim" onClick={onClose}>
      {body}
    </div>
  );
}

function wouldCycle(fromId: string, toId: string, roster: Seat[]) {
  const byId = new Map(roster.map((s) => [s.id, s]));
  let p: string | undefined = toId;
  const seen = new Set<string>();
  while (p) {
    if (p === fromId) return true;
    if (seen.has(p)) return true;
    seen.add(p);
    p = byId.get(p)?.reportsTo;
  }
  return false;
}

function now() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function mergeMsgs(prev: Msg[], incoming: Msg[]) {
  const seen = new Set(prev.map((m) => m.id));
  const extra = incoming.filter((m) => !seen.has(m.id));
  return extra.length ? [...prev, ...extra] : prev;
}

function replaceChannel(prev: Msg[], channel: string, incoming: Msg[]) {
  const kept = prev.filter((m) => m.channel !== channel);
  const locals = prev.filter((m) => m.channel === channel && String(m.id).startsWith("local-"));
  const merged = incoming.map((m) => {
    const local = locals.find((l) => l.who === m.who && l.text === m.text && hasChips(l));
    if (local && !hasChips(m)) {
      return { ...m, skills: local.skills, files: local.files, attachments: local.attachments, seatId: m.seatId || local.seatId };
    }
    return m;
  });
  const unmatched = locals.filter((l) => !merged.some((m) => m.who === l.who && m.text === l.text));
  return [...kept, ...merged, ...unmatched];
}

function hasChips(m: Msg) {
  return Boolean(m.skills?.length || m.files?.length || m.attachments?.length);
}
