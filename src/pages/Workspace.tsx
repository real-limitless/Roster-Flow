import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import {
  channels as seedChannels,
  enrichTeam,
  runSteps,
  seatForMessage,
  seats as seedSeats,
  seedMessages,
  slugify,
  teams as seedTeams,
  type CatalogModel,
  type Channel,
  type Msg,
  type Seat,
  type SeatKind,
  type SeatType,
  type Team,
} from "../data";
import { OrgChart } from "../components/OrgChart";
import { HarnessTerm } from "../components/HarnessTerm";
import type { Mode } from "../components/WorkspaceMock";
import { Composer, type ComposePayload } from "../components/chat/Composer";
import { MessageRow } from "../components/chat/MessageRow";
import { api } from "../lib/api";

const RUN_PROMPT =
  "Talk to Product and the Eng team. When they complete, have DevOps deploy to staging and QA test everything.";

export function Workspace() {
  const [mode, setMode] = useState<Mode>("room");
  const [roster, setRoster] = useState<Seat[]>(seedSeats);
  const [rooms, setRooms] = useState<Channel[]>(seedChannels);
  const [channel, setChannel] = useState("ship");
  const [messages, setMessages] = useState<Msg[]>(seedMessages);
  const [step, setStep] = useState(-1);
  const [selectedId, setSelectedId] = useState("build");
  const [running, setRunning] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const [roomDraft, setRoomDraft] = useState("");
  const [hiring, setHiring] = useState(false);
  const [hireTeam, setHireTeam] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [mobilePane, setMobilePane] = useState<"none" | "nav" | "seat">("none");
  const [teamList, setTeamList] = useState<Team[]>(seedTeams);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const selected = roster.find((s) => s.id === selectedId) || roster[0];
  const selectedTeam = teamList.find((t) => t.id === selectedTeamId) || null;
  const panelTeams = teamList.map((t) => enrichTeam(t, roster));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("mode");
    if (m === "room" || m === "harness" || m === "chart") setMode(m);
    void (async () => {
      try {
        const st = await api.state();
        if (Array.isArray(st.seats) && st.seats.length) setRoster(st.seats as Seat[]);
        if (Array.isArray(st.channels) && st.channels.length) setRooms(st.channels as Channel[]);
        if (Array.isArray(st.messages) && st.messages.length) setMessages(st.messages as Msg[]);
        const [t, m] = await Promise.all([api.teams().catch(() => []), api.models().catch(() => [])]);
        if (Array.isArray(t) && t.length) setTeamList(t);
        if (Array.isArray(m)) setModels(m);
        const live = st.runs?.find((r) => r.status === "running");
        if (live) {
          setRunning(true);
          setStep(typeof live.step === "number" ? live.step : 0);
        }
      } catch {
        /* local seed */
      }
    })();
  }, []);

  useEffect(() => {
    const tick = () => {
      void api
        .messages(channel)
        .then((m) => {
          if (Array.isArray(m) && m.length) setMessages((prev) => replaceChannel(prev, channel, m));
        })
        .catch(() => undefined);
      void api
        .runs()
        .then((runs) => {
          const live = runs.find((r) => r.status === "running") || runs[0];
          if (!live) return;
          setStep(live.step);
          setRunning(live.status === "running");
        })
        .catch(() => undefined);
    };
    tick();
    const t = window.setInterval(tick, 800);
    return () => window.clearInterval(t);
  }, [channel]);

  function startRun(from: string) {
    setChannel("ship");
    setMode("room");
    setMobilePane("none");
    setStep(0);
    setRunning(true);
    setSelectedId("floor");
    void api
      .startRun(from)
      .then(() => api.messages("ship"))
      .then((m) => {
        if (Array.isArray(m)) setMessages((prev) => replaceChannel(prev, "ship", m));
      })
      .catch(() => setRunning(false));
  }

  function send(payload: ComposePayload) {
    const t = payload.text.trim();
    if (!t && !payload.attachments.length && !payload.skills.length && !payload.files.length) return;
    if (t && /product|eng|devops|qa/i.test(t)) {
      startRun(t);
      return;
    }
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
      .catch(() => undefined);
  }

  function openSeat(id: string) {
    setSelectedId(id);
    setSelectedTeamId(null);
    setMobilePane("seat");
  }

  function attachSeat(id = selectedId) {
    setSelectedId(id);
    setMode("harness");
    setMobilePane("none");
    void api.attach(id).catch(() => undefined);
  }

  function addRoom(e: FormEvent) {
    e.preventDefault();
    const raw = roomDraft.trim();
    if (!raw) return;
    const id = slugify(raw) || `room-${Date.now()}`;
    if (rooms.some((r) => r.id === id)) {
      setChannel(id);
      setRoomDraft("");
      setMode("room");
      setMobilePane("none");
      return;
    }
    const name = raw.startsWith("#") ? raw : `#${raw.replace(/\s+/g, "-").toLowerCase()}`;
    setRooms((r) => [...r, { id, name }]);
    setChannel(id);
    setRoomDraft("");
    setMode("room");
    setMobilePane("none");
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
    setSelectedTeamId(null);
    setHiring(false);
    setHireTeam("");
    setMode("chart");
    void api
      .hire(seat)
      .then(() => api.teams())
      .then((t) => {
        if (Array.isArray(t)) setTeamList(t);
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

  function onCreateTeam(body: { name: string; defaultModel?: string }) {
    void api
      .createTeam(body)
      .then((res) => {
        if (res.seats?.length) setRoster((r) => [...r, ...res.seats]);
        return api.teams();
      })
      .then((t) => {
        if (Array.isArray(t)) setTeamList(t);
        setCreatingTeam(false);
      })
      .catch(() => undefined);
  }

  const visible = messages.filter((m) => m.channel === channel);
  const rosterList = showSystem ? roster : roster.filter((s) => !s.system);
  const channelName = rooms.find((r) => r.id === channel)?.name ?? "";

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
              onClick={() => { setMode(m); setMobilePane("none"); }}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <span className="mono app-meta">
          {channelName} · {running ? "run live" : "idle"}
        </span>
        <div className="app-desktop-actions">
          <button className="pill-btn" data-testid="run-ship-train" onClick={() => startRun(RUN_PROMPT)} disabled={running}>
            Run ship train
          </button>
          <Link to="/app/settings" className="pill-btn">
            Settings
          </Link>
          <Link to="/access" className="pill-btn primary">
            Access
          </Link>
        </div>
      </div>
      {mobilePane !== "none" && <button className="scrim" aria-label="Close panel" onClick={() => setMobilePane("none")} />}
      <div className="app-body">
        <aside className={`rail ${mobilePane === "nav" ? "open" : ""}`}>
          <div className="rail-label">Channels</div>
          {rooms.map((c) => (
            <div
              key={c.id}
              data-testid={`channel-${c.id}`}
              className={`ch ${channel === c.id ? "on" : ""}`}
              onClick={() => {
                setChannel(c.id);
                setMode("room");
                setMobilePane("none");
              }}
            >
              {c.name}
            </div>
          ))}
          <form className="add-inline" onSubmit={addRoom}>
            <input
              value={roomDraft}
              onChange={(e) => setRoomDraft(e.target.value)}
              placeholder="New room"
              aria-label="New room name"
            />
            <button className="pill-btn" type="submit">
              Add
            </button>
          </form>
          <div className="rail-label" style={{ marginTop: 14 }}>
            Teams
          </div>
          {panelTeams.map((t) => (
            <div
              key={t.id}
              data-testid={`team-${t.id}`}
              className={`ch ${selectedTeamId === t.id ? "on" : ""}`}
              onClick={() => {
                setSelectedTeamId(t.id);
                setMobilePane("seat");
              }}
            >
              <div>
                {t.name} <span className="dim">· {t.seatCount ?? t.seatIds.length}</span>
              </div>
              <div className="team-models">
                {(t.models || []).length === 0 && <span className="chip">no models</span>}
                {(t.models || []).map((m) => (
                  <span className="chip" key={m}>
                    {m}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <button
            className="pill-btn"
            style={{ marginTop: 8, width: "100%" }}
            data-testid="create-team"
            onClick={() => {
              setCreatingTeam(true);
              setMode("chart");
              setMobilePane("none");
            }}
          >
            New team
          </button>
          <div className="rail-label" style={{ marginTop: 14 }}>
            Roster
          </div>
          {rosterList.map((s) => (
            <div
              key={s.id}
              className={`ch ${selected.id === s.id && !selectedTeamId ? "on" : ""}`}
              onClick={() => {
                setSelectedTeamId(null);
                setSelectedId(s.id);
                setMobilePane("seat");
              }}
            >
              {s.kind === "human" ? "● " : "◌ "}
              {s.name}
            </div>
          ))}
          <button
            className="pill-btn"
            style={{ marginTop: 10, width: "100%" }}
            onClick={() => {
              setHiring(true);
              setHireTeam("");
              setMode("chart");
              setMobilePane("none");
            }}
          >
            Hire seat
          </button>
          <button className="pill-btn mobile-only" style={{ marginTop: 8, width: "100%" }} onClick={() => startRun(RUN_PROMPT)} disabled={running}>
            Run ship train
          </button>
        </aside>
        <main className="app-main">
          {mode === "room" && (
            <>
              <div className="channel-chip">
                <span className="mono">{channelName}</span>
                <span className="dim"> · {selected.name}</span>
              </div>
              <div className="main thread">
                {visible.length === 0 && <p className="micro">No messages in {channelName}. Say something.</p>}
                {visible.map((m) => (
                  <MessageRow
                    key={m.id}
                    msg={m}
                    roster={roster}
                    selected={seatForMessage(m, roster)?.id === selectedId}
                    extra={m.run ? <LiveRun step={step} /> : null}
                    onOpenSeat={openSeat}
                  />
                ))}
              </div>
              <Composer channelName={channelName} onSend={send} />
            </>
          )}
          {mode === "harness" && <HarnessTerm seat={selected} />}
          {mode === "chart" && (
            <ChartPane
              roster={roster}
              showSystem={showSystem}
              onShowSystem={setShowSystem}
              liveId={running ? runSteps[Math.min(Math.max(step, 0), runSteps.length - 1)]?.id : selected.id}
              selected={selected}
              onSelect={(s) => {
                setSelectedTeamId(null);
                setSelectedId(s.id);
                setMobilePane("seat");
              }}
              onAttach={(s) => attachSeat(s.id)}
              hiring={hiring}
              creatingTeam={creatingTeam}
              teams={panelTeams}
              models={models}
              hireTeam={hireTeam}
              onHire={hireSeat}
              onCancelHire={() => setHiring(false)}
              onStartHire={() => setHiring(true)}
              onCreateTeam={onCreateTeam}
              onCancelTeam={() => setCreatingTeam(false)}
            />
          )}
        </main>
        {selectedTeam ? (
          <TeamInspector
            team={enrichTeam(selectedTeam, roster)}
            roster={roster}
            models={models}
            open={mobilePane === "seat"}
            onClose={() => setMobilePane("none")}
            onSelectSeat={(id) => {
              setSelectedTeamId(null);
              setSelectedId(id);
            }}
            onDefaultModel={(defaultModel) => {
              setTeamList((list) => list.map((t) => (t.id === selectedTeam.id ? { ...t, defaultModel } : t)));
              void api.patchTeam(selectedTeam.id, { defaultModel }).then((t) => {
                setTeamList((list) => list.map((x) => (x.id === t.id ? t : x)));
              });
            }}
            onHireSpecialist={() => {
              setHireTeam(selectedTeam.id);
              setHiring(true);
              setCreatingTeam(false);
              setMode("chart");
              setMobilePane("none");
            }}
          />
        ) : (
          <Inspector
            seat={selected}
            roster={roster}
            models={models}
            open={mobilePane === "seat"}
            onClose={() => setMobilePane("none")}
            onAttach={() => attachSeat(selected.id)}
            onOpenRoom={() => {
              setMode("room");
              setMobilePane("none");
            }}
            onReparent={(reportsTo) => reparent(selected.id, reportsTo)}
            onPatch={(body) => patchLocalSeat(selected.id, body)}
          />
        )}
      </div>
      <nav className="dock" aria-label="Mobile">
        <button className={mobilePane === "nav" ? "on" : ""} onClick={() => setMobilePane((p) => (p === "nav" ? "none" : "nav"))}>
          Rooms
        </button>
        <button className={mobilePane === "none" ? "on" : ""} onClick={() => setMobilePane("none")}>
          Floor
        </button>
        <button className={mobilePane === "seat" ? "on" : ""} onClick={() => setMobilePane((p) => (p === "seat" ? "none" : "seat"))}>
          Seat
        </button>
      </nav>
    </div>
  );
}

function LiveRun({ step }: { step: number }) {
  return (
    <div className="run-card">
      <div className="title">Pipeline ship-billing</div>
      <div className="steps">
        {runSteps.map((s, i) => (
          <span key={s.id} className={`step ${i < step ? "done" : i === step ? "live" : ""}`}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChartPane({
  roster,
  showSystem,
  onShowSystem,
  liveId,
  selected,
  onSelect,
  onAttach,
  hiring,
  creatingTeam,
  teams,
  models,
  hireTeam,
  onHire,
  onCancelHire,
  onStartHire,
  onCreateTeam,
  onCancelTeam,
}: {
  roster: Seat[];
  showSystem: boolean;
  onShowSystem: (v: boolean) => void;
  liveId?: string;
  selected: Seat;
  onSelect: (s: Seat) => void;
  onAttach: (s: Seat) => void;
  hiring: boolean;
  creatingTeam: boolean;
  teams: Team[];
  models: CatalogModel[];
  hireTeam: string;
  onHire: (s: Seat) => void;
  onCancelHire: () => void;
  onStartHire: () => void;
  onCreateTeam: (body: { name: string; defaultModel?: string }) => void;
  onCancelTeam: () => void;
}) {
  return (
    <div className="chart-canvas" style={{ flex: 1, overflow: "auto" }}>
      <div className="chart-toolbar">
        <label className="check">
          <input type="checkbox" checked={showSystem} onChange={(e) => onShowSystem(e.target.checked)} />
          Show system seats
        </label>
        <button className="pill-btn primary" onClick={onStartHire}>
          Hire seat
        </button>
      </div>
      {creatingTeam && <CreateTeamForm models={models} onCreate={onCreateTeam} onCancel={onCancelTeam} />}
      {hiring && (
        <HireForm roster={roster} teams={teams} models={models} defaultTeam={hireTeam} onHire={onHire} onCancel={onCancelHire} />
      )}
      <OrgChart
        roster={roster}
        showSystem={showSystem}
        liveId={liveId}
        selectedId={selected.id}
        onSelect={onSelect}
        onAttach={onAttach}
      />
    </div>
  );
}

function modelValue(m: CatalogModel) {
  return `${m.providerID}/${m.modelID}`;
}

function HireForm({
  roster,
  teams,
  models,
  defaultTeam,
  onHire,
  onCancel,
}: {
  roster: Seat[];
  teams: Team[];
  models: CatalogModel[];
  defaultTeam: string;
  onHire: (s: Seat) => void;
  onCancel: () => void;
}) {
  const staffed = teams.filter((t) => t.staffed !== false);
  const [kind, setKind] = useState<SeatKind>("bot");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [team, setTeam] = useState(defaultTeam || "");
  const [reportsTo, setReportsTo] = useState("you");
  const [job, setJob] = useState("");
  const [persona, setPersona] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState(models[0] ? modelValue(models[0]) : "xai/grok-4");
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
      reportsTo: reportsTo || picked?.supervisorSeatId || undefined,
      tools: kind === "human" ? ["approve"] : ["read"],
      deny: kind === "bot" ? ["deploy"] : [],
      model: kind === "bot" ? model || picked?.defaultModel || "xai/grok-4" : undefined,
      persona: kind === "bot" ? persona.trim() || undefined : undefined,
      instructions: kind === "bot" ? instructions.trim() || undefined : undefined,
      job: job.trim() || (kind === "human" ? "Human seat on the org chart." : "Specialist OpenCode agent."),
      status: "idle",
    });
  }

  return (
    <form className="hire-form" data-testid="hire-form" onSubmit={submit}>
      <strong>Hire a seat</strong>
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
          <select value={team} onChange={(e) => setTeam(e.target.value)} data-testid="hire-team">
            <option value="">No team</option>
            {staffed.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder={kind === "human" ? "Alex" : "Eng.Mobile"} />
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
          <label>
            Model
            <select data-testid="hire-model" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={modelValue(m)} value={modelValue(m)}>
                  {m.name} ({modelValue(m)})
                </option>
              ))}
            </select>
          </label>
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
  onCreate,
  onCancel,
}: {
  models: CatalogModel[];
  onCreate: (body: { name: string; defaultModel?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [defaultModel, setDefaultModel] = useState(models[0] ? modelValue(models[0]) : "xai/grok-4");
  return (
    <form
      className="hire-form"
      data-testid="create-team-form"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        onCreate({ name: n, defaultModel });
      }}
    >
      <strong>New team</strong>
      <p className="micro">Creates a Supervisor and a Generic seat. Add specialists later for custom personas.</p>
      <div className="hire-grid">
        <label>
          Name
          <input data-testid="team-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="platform" />
        </label>
        <label>
          Default model
          <select data-testid="team-default-model" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
            {models.map((m) => (
              <option key={modelValue(m)} value={modelValue(m)}>
                {m.name} ({modelValue(m)})
              </option>
            ))}
          </select>
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
}) {
  const managers = roster.filter((s) => s.id !== seat.id && !wouldCycle(seat.id, s.id, roster));
  const catalog = models.some((m) => modelValue(m) === seat.model) || !seat.model
    ? models
    : [{ providerID: seat.model.split("/")[0] || "xai", modelID: seat.model.split("/").slice(1).join("/") || seat.model, name: seat.model }, ...models];
  return (
    <aside className={`inspector ${open ? "open" : ""}`} data-testid="seat-inspector">
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
      {seat.team && (
        <div className="kv">
          <span>Team</span>
          <b>@{seat.team}</b>
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
        <label className="kv-label">
          Model
          <select data-testid="seat-model" value={seat.model || ""} onChange={(e) => onPatch({ model: e.target.value })}>
            {catalog.map((m) => (
              <option key={modelValue(m)} value={modelValue(m)}>
                {m.name} ({modelValue(m)})
              </option>
            ))}
          </select>
        </label>
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
        <button className="pill-btn" onClick={onOpenRoom}>
          Open in room
        </button>
      </div>
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
  onDefaultModel,
  onHireSpecialist,
}: {
  team: Team;
  roster: Seat[];
  models: CatalogModel[];
  open: boolean;
  onClose: () => void;
  onSelectSeat: (id: string) => void;
  onDefaultModel: (model: string) => void;
  onHireSpecialist: () => void;
}) {
  const members = (team.seatIds || []).map((id) => roster.find((s) => s.id === id)).filter(Boolean) as Seat[];
  const supervisor = members.find((s) => s.id === team.supervisorSeatId);
  const generic = members.find((s) => s.id === team.genericSeatId);
  const specialists = members.filter((s) => s.seatType === "specialist" || (!s.seatType && s.kind === "bot" && s.id !== team.supervisorSeatId && s.id !== team.genericSeatId));
  const humans = members.filter((s) => s.kind === "human");
  return (
    <aside className={`inspector ${open ? "open" : ""}`} data-testid="team-inspector">
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
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }} data-testid="team-models">
        {(team.models || []).map((m) => (
          <span className="chip" key={m}>
            {m}
          </span>
        ))}
        {(team.models || []).length === 0 && <span className="chip">no models yet</span>}
      </div>
      {team.staffed !== false && (
        <label className="kv-label">
          Default model
          <select
            data-testid="team-model"
            value={team.defaultModel || ""}
            onChange={(e) => onDefaultModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={modelValue(m)} value={modelValue(m)}>
                {m.name} ({modelValue(m)})
              </option>
            ))}
          </select>
        </label>
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
        <button className="pill-btn primary" data-testid="hire-specialist" type="button" style={{ width: "100%", marginTop: 16 }} onClick={onHireSpecialist}>
          Hire specialist
        </button>
      )}
    </aside>
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
