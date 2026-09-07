import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import {
  channels as seedChannels,
  runSteps,
  seats as seedSeats,
  seedMessages,
  slugify,
  type Channel,
  type Msg,
  type Seat,
  type SeatKind,
} from "../data";
import { OrgChart } from "../components/OrgChart";
import type { Mode } from "../components/WorkspaceMock";
import { api } from "../lib/api";

const RUN_PROMPT =
  "Talk to Product and the Eng team. When they complete, have DevOps deploy to staging and QA test everything.";

export function Workspace() {
  const [mode, setMode] = useState<Mode>("room");
  const [roster, setRoster] = useState<Seat[]>(seedSeats);
  const [rooms, setRooms] = useState<Channel[]>(seedChannels);
  const [channel, setChannel] = useState("ship");
  const [messages, setMessages] = useState<Msg[]>(seedMessages);
  const [text, setText] = useState("");
  const [step, setStep] = useState(-1);
  const [selectedId, setSelectedId] = useState("build");
  const [running, setRunning] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const [roomDraft, setRoomDraft] = useState("");
  const [hiring, setHiring] = useState(false);
  const [mobilePane, setMobilePane] = useState<"none" | "nav" | "seat">("none");
  const [remoteRun, setRemoteRun] = useState(false);

  const selected = roster.find((s) => s.id === selectedId) || roster[0];

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
    if (!running) return;
    const t = window.setInterval(() => {
      void api
        .runs()
        .then((runs) => {
          const live = runs[0];
          if (!live) return;
          setStep(live.step);
          if (live.status !== "running") setRunning(false);
        })
        .catch(() => undefined);
      void api
        .messages(channel)
        .then((m) => {
          if (m.length) setMessages((prev) => mergeMsgs(prev, m));
        })
        .catch(() => undefined);
    }, 800);
    return () => window.clearInterval(t);
  }, [running, channel]);

  useEffect(() => {
    if (!running || step < 0 || remoteRun) return;
    if (step >= runSteps.length) {
      setRunning(false);
      return;
    }
    const id = window.setTimeout(() => {
      const s = runSteps[step];
      const bot = roster.find((x) => x.id === s.id);
      setMessages((m) => [
        ...m,
        {
          id: `auto-${Date.now()}-${step}`,
          channel: "ship",
          who: bot?.name || s.label,
          kind: s.id === "you" ? "human" : "bot",
          text:
            s.id === "product"
              ? "Acceptance written. Webhook must be idempotent. Tests in billing/webhook.test.ts."
              : s.id === "build"
                ? "PR #482 opened on worktree billing-fix. Tests green."
                : s.id === "review"
                  ? "Gate open. No secret leak. Asking You to confirm deploy."
                  : s.id === "you"
                    ? "Confirmed. Staging only."
                    : s.id === "devops"
                      ? "Staging deploy complete. Waiting on QA."
                      : "14/14 passing. Report posted. Run ship-billing done.",
          time: now(),
        },
      ]);
      if (bot) setSelectedId(bot.id);
      setStep((n) => n + 1);
    }, 900);
    return () => window.clearTimeout(id);
  }, [running, step, roster]);

  function startRun(from: string) {
    setChannel("ship");
    setMode("room");
    setMobilePane("none");
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, channel: "ship", who: "You", kind: "human", text: from, time: now() },
      {
        id: `f-${Date.now()}`,
        channel: "ship",
        who: "Floor",
        kind: "bot",
        text: "Compiled run ship-billing. Product → @eng → confirm → DevOps → QA.",
        time: now(),
        run: true,
      },
    ]);
    setStep(0);
    setRunning(true);
    setSelectedId("floor");
    void api
      .startRun(from)
      .then(() => setRemoteRun(true))
      .catch(() => setRemoteRun(false));
  }

  function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    if (/product|eng|devops|qa/i.test(t)) startRun(t);
    else {
      setMessages((m) => [
        ...m,
        { id: `u-${Date.now()}`, channel, who: "You", kind: "human", text: t, time: now() },
      ]);
      void api.postMessage(channel, t).catch(() => undefined);
    }
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
        text: `Created ${name}.`,
        time: now(),
      },
    ]);
  }

  function hireSeat(seat: Seat) {
    setRoster((r) => [...r, seat]);
    setSelectedId(seat.id);
    setHiring(false);
    setMode("chart");
    void api.hire(seat).catch(() => undefined);
  }

  function reparent(id: string, reportsTo: string) {
    setRoster((r) => r.map((s) => (s.id === id ? { ...s, reportsTo: reportsTo || undefined } : s)));
    void api.patchSeat(id, { reportsTo: reportsTo || undefined }).catch(() => undefined);
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
            Roster
          </div>
          {rosterList.map((s) => (
            <div
              key={s.id}
              className={`ch ${selected.id === s.id ? "on" : ""}`}
              onClick={() => {
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
                  <div className="msg" key={m.id}>
                    <div className={`av ${m.kind}`}>{m.who.slice(0, 2)}</div>
                    <div>
                      <div>
                        <span className="who">{m.who}</span>
                        <span className="meta">{m.time}</span>
                      </div>
                      <div className="body">{m.text}</div>
                      {m.run && <LiveRun step={step} />}
                    </div>
                  </div>
                ))}
              </div>
              <form
                className="compose"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <input
                  data-testid="composer"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={`Message ${channelName}`}
                />
                <button className="pill-btn primary" data-testid="send-message" type="submit">
                  Send
                </button>
              </form>
            </>
          )}
          {mode === "harness" && <HarnessPane seat={selected} step={step} />}
          {mode === "chart" && (
            <ChartPane
              roster={roster}
              showSystem={showSystem}
              onShowSystem={setShowSystem}
              liveId={running ? runSteps[Math.min(Math.max(step, 0), runSteps.length - 1)]?.id : selected.id}
              selected={selected}
              onSelect={(s) => {
                setSelectedId(s.id);
                setMobilePane("seat");
              }}
              onAttach={() => {
                setMode("harness");
                setMobilePane("none");
              }}
              hiring={hiring}
              onHire={hireSeat}
              onCancelHire={() => setHiring(false)}
              onStartHire={() => setHiring(true)}
            />
          )}
        </main>
        <Inspector
          seat={selected}
          roster={roster}
          open={mobilePane === "seat"}
          onClose={() => setMobilePane("none")}
          onAttach={() => {
            setMode("harness");
            setMobilePane("none");
          }}
          onOpenRoom={() => {
            setMode("room");
            setMobilePane("none");
          }}
          onReparent={(reportsTo) => reparent(selected.id, reportsTo)}
        />
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

function HarnessPane({ seat, step }: { seat: Seat; step: number }) {
  const lines = useMemo(() => {
    const log = [
      `opencode attach ${seat.id}  ·  session ses_${seat.id.slice(0, 3)}`,
      `agent  ${seat.name}  model  ${seat.model || (seat.kind === "human" ? "—" : "grok-4")}`,
      `tools  allow ${seat.tools.join(",")}  deny ${seat.deny.join(",") || "—"}`,
    ];
    if (seat.kind === "human") log.push("note   human seat — no OpenCode loop. Approvals only.");
    if (step >= 0) log.push("run    ship-billing  attached");
    if (seat.id === "build") {
      log.push("tool   edit   billing/webhook.ts");
      log.push("tool   bash   npm test -- billing/webhook.test.ts");
      log.push("ok     14/14 passing");
    }
    if (seat.id === "devops") log.push("skill  deploy staging  waiting confirm");
    log.push("▌");
    return log;
  }, [seat, step]);
  return (
    <div className="tui" style={{ flex: 1 }}>
      {lines.map((l, i) => (
        <div key={i} className={`line ${l.startsWith("ok") ? "gn" : l.startsWith("tool") || l.startsWith("skill") ? "bl" : l.startsWith("agent") ? "am" : "dim"}`}>
          {l}
        </div>
      ))}
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
  onHire,
  onCancelHire,
  onStartHire,
}: {
  roster: Seat[];
  showSystem: boolean;
  onShowSystem: (v: boolean) => void;
  liveId?: string;
  selected: Seat;
  onSelect: (s: Seat) => void;
  onAttach: () => void;
  hiring: boolean;
  onHire: (s: Seat) => void;
  onCancelHire: () => void;
  onStartHire: () => void;
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
      {hiring && <HireForm roster={roster} onHire={onHire} onCancel={onCancelHire} />}
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

function HireForm({
  roster,
  onHire,
  onCancel,
}: {
  roster: Seat[];
  onHire: (s: Seat) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<SeatKind>("bot");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [reportsTo, setReportsTo] = useState("you");
  const [job, setJob] = useState("");
  const humans = roster.filter((s) => s.kind === "human");
  const managers = roster.filter((s) => !s.system);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const id = slugify(n) || `seat-${Date.now()}`;
    if (roster.some((s) => s.id === id)) return;
    onHire({
      id,
      name: n,
      role: role.trim() || (kind === "human" ? "Teammate" : "Specialist"),
      kind,
      reportsTo: reportsTo || undefined,
      tools: kind === "human" ? ["approve"] : ["read"],
      deny: kind === "bot" ? ["deploy"] : [],
      model: kind === "bot" ? "grok-4" : undefined,
      job: job.trim() || (kind === "human" ? "Human seat on the org chart." : "New OpenCode agent."),
      status: "idle",
    });
  }

  return (
    <form className="hire-form" onSubmit={submit}>
      <strong>Hire a seat</strong>
      <div className="hire-grid">
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as SeatKind)}>
            <option value="human">Human</option>
            <option value="bot">Bot (OpenCode)</option>
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
            {managers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.kind === "human" ? "(human)" : ""}
              </option>
            ))}
            <option value="services">Services lane</option>
          </select>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Job
          <input value={job} onChange={(e) => setJob(e.target.value)} placeholder="One line" />
        </label>
      </div>
      {kind === "human" && humans.length >= 1 && (
        <p className="micro">Humans sit on the tree. Assign them under any seat.</p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="pill-btn primary" type="submit">
          Hire
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
  open,
  onClose,
  onAttach,
  onOpenRoom,
  onReparent,
}: {
  seat: Seat;
  roster: Seat[];
  open: boolean;
  onClose: () => void;
  onAttach: () => void;
  onOpenRoom: () => void;
  onReparent: (reportsTo: string) => void;
}) {
  const managers = roster.filter((s) => s.id !== seat.id && !wouldCycle(seat.id, s.id, roster));
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
          {seat.system ? " · system" : ""}
        </b>
      </div>
      <div className="kv">
        <span>Role</span>
        <b>{seat.role}</b>
      </div>
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
      <div className="kv">
        <span>Model</span>
        <b>{seat.model || "—"}</b>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>{seat.job}</p>
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
