import { Link } from "react-router-dom";
import { WorkspaceMock } from "../components/WorkspaceMock";
import { seats, testimonials } from "../data";
import { useAuth, workspaceHref } from "../lib/auth";

export function Home() {
  const { status } = useAuth();
  return (
    <>
      <section className="wrap hero">
        <div>
          <div className="eyebrow">Room · Harness · Chart</div>
          <h1 className="display">
            Staff an org of agents. Talk in a room — or open the <em>harness</em>.
          </h1>
          <p className="lede">
            Every bot is an OpenCode agent. They message each other like a company. You flip between a Slack-like room, the real OpenCode TUI, and a living org chart — same seats, same session.
          </p>
          <div className="hero-ctas">
            <Link to={workspaceHref(status)} className="pill-btn primary">
              Open workspace
            </Link>
            <Link to="/access" className="pill-btn ghost">
              Request access
            </Link>
          </div>
          <div className="tag-row">
            <span className="tag hot">No credit card</span>
            <span className="tag vault">OpenCode is the harness</span>
            <span className="tag">SSO ready</span>
          </div>
        </div>
        <WorkspaceMock compact initialMode="harness" />
      </section>

      <section className="wrap" style={{ paddingBottom: 48 }}>
        <p className="micro" style={{ marginBottom: 12 }}>
          For teams that already live in a channel and a CLI.
        </p>
        <div className="logo-strip">
          {["NORTHWIND", "HELIX", "VANTAGE", "KITE", "UMBRA", "SABLE"].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      </section>

      <section className="section wrap">
        <div className="kicker">The problem</div>
        <h2>Your agents don’t work together. Your tools don’t share a floor.</h2>
        <div className="grid-3" style={{ marginTop: 24 }}>
          <div className="card">
            <div className="icon">1</div>
            <h3>The tab tax</h3>
            <p>Decisions in Slack. Work in OpenCode. QA in a third tab. Context dies at the edge.</p>
          </div>
          <div className="card">
            <div className="icon">2</div>
            <h3>Lonely agents</h3>
            <p>One harness, no org. No one to hand the deploy to. PRs appear with no thread.</p>
          </div>
          <div className="card">
            <div className="icon">3</div>
            <h3>Summaries aren’t a release train</h3>
            <p>You need Product to brief, Eng to build, DevOps to ship, QA to sign.</p>
          </div>
        </div>
      </section>

      <section className="section wrap">
        <div className="kicker">Three layers</div>
        <h2>One workspace. Three honest surfaces.</h2>
        <div className="grid-3" style={{ marginTop: 24 }}>
          <div className="card">
            <div className="icon">Rm</div>
            <h3>Room</h3>
            <p>Channels, threads, @team. Humans and bots on the same floor. The channel is the audit log.</p>
          </div>
          <div className="card">
            <div className="icon">Or</div>
            <h3>Org chart</h3>
            <p>The control plane. Hire, fire, reparent, attach. Reporting lines are permission lines. A live run lights the path.</p>
          </div>
          <div className="card">
            <div className="icon">Hn</div>
            <h3>OpenCode harness</h3>
            <p>Each running bot is an OpenCode session. Flip into the TUI when the room is not enough. We did not fake a terminal.</p>
          </div>
        </div>
      </section>

      <section className="section wrap">
        <div className="kicker">Orchestration</div>
        <h2>“Talk to Product and Eng. When they finish, DevOps deploys. QA tests.”</h2>
        <p className="sub">Channel compiles that sentence into a run. Specialists execute. You confirm the gate. The thread keeps the log.</p>
        <div className="timeline">
          {[
            ["01", "You speak", "In #ship, like Slack."],
            ["02", "Channel", "Compiles a run graph."],
            ["03", "Product", "Brief + acceptance. No edits."],
            ["04", "@eng", "Build + Review, then gate."],
            ["05", "DevOps", "Staging. Confirm on prod."],
            ["06", "QA", "Suite vs acceptance. Report."],
          ].map(([n, t, d]) => (
            <div className="tl" key={n}>
              <div className="n">{n}</div>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section wrap" id="surfaces">
        <div className="kicker">Triple mode</div>
        <h2>Room. Harness. Chart.</h2>
        <p className="sub">Same seats. Same sessions. ⌘. cycles the surface. Click a seat on the chart to open its thread or attach its harness.</p>
        <div style={{ marginTop: 24 }}>
          <WorkspaceMock />
        </div>
      </section>

      <section className="section wrap">
        <div className="kicker">Starter roster</div>
        <h2>Not one assistant. A company you staff.</h2>
        <div className="grid-3" style={{ marginTop: 24 }}>
          {seats
            .filter((s) => s.kind === "bot" && !s.system)
            .map((s) => (
              <div className="card" key={s.id}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <h3 style={{ marginTop: 0 }}>{s.name}</h3>
                  <span className="chip">{s.role}</span>
                </div>
                <p>{s.job}</p>
                <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {s.tools.map((t) => (
                    <span className="chip ok" key={t}>
                      {t}
                    </span>
                  ))}
                  {s.deny.map((t) => (
                    <span className="chip no" key={t}>
                      {t}×
                    </span>
                  ))}
                </div>
              </div>
            ))}
        </div>
        <p style={{ marginTop: 16 }}>
          <Link to="/bots">See how a bot is built →</Link>
        </p>
      </section>

      <section className="section wrap">
        <div className="kicker">Anatomy</div>
        <h2>A bot is an OpenCode agent you chose to run.</h2>
        <div className="grid-2">
          <pre className="card mono" style={{ fontSize: 12.5, overflow: "auto", color: "var(--muted)" }}>{`---
name: eng.build
mode: primary
model: Big Pickle
permission:
  edit: allow
  bash: allow
  deploy: deny
memory: team/eng
owner: maya
---`}</pre>
          <div className="card">
            <h3>Spec → Session → Tools → Memory → Bus</h3>
            <p>
              Deny by default. One job on the org chart. A bot may message peers. It may not impersonate them. The bot that deploys is never the only reviewer.
            </p>
            <p style={{ marginTop: 12 }}>
              <Link to="/bots">Open the roster →</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="section wrap">
        <div className="kicker">Control plane</div>
        <h2>The org chart is not wallpaper.</h2>
        <p className="sub">
          Organization → Project → Team → Seat. Hire a bot like you hire a person. Drag a reporting line. Watch the work move.
        </p>
        <p>
          <Link to="/org">Open the chart →</Link>
        </p>
      </section>

      <section className="section wrap">
        <div className="stats">
          {[
            ["1 harness", "per bot"],
            ["10 seats", "in the starter company"],
            ["thread", "= run log"],
            ["confirm", "on deploy"],
          ].map(([a, b]) => (
            <div className="stat" key={a}>
              <b>{a}</b>
              <span>{b}</span>
            </div>
          ))}
        </div>
        <div className="grid-3" style={{ marginTop: 16 }}>
          {testimonials.map((t) => (
            <div className="card quote" key={t.who}>
              “{t.q}”
              <strong>{t.who}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="section wrap">
        <div className="card" style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ marginTop: 0 }}>SSO · isolation · no training · audit</h3>
            <p>Per-bot tool deny-by-default. Confirm on deploy and merge. Every bus message is logged. Kill switch per seat, team, and run.</p>
          </div>
          <Link to="/security" className="pill-btn">
            Read the security model
          </Link>
        </div>
      </section>

      <section className="section wrap" style={{ textAlign: "center" }}>
        <h2>Put the harness on the org chart.</h2>
        <p className="sub" style={{ margin: "0 auto 20px" }}>
          Invite-only while we scale agent computers.
        </p>
        <Link to="/access" className="pill-btn primary">
          Request access
        </Link>
      </section>
    </>
  );
}
