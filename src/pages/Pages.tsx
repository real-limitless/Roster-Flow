import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { changelog, seats } from "../data";
import { WorkspaceMock } from "../components/WorkspaceMock";

function PageHero({ kicker, title, sub }: { kicker: string; title: string; sub: string }) {
  return (
    <div className="wrap page-hero">
      <div className="eyebrow">{kicker}</div>
      <h1 className="display">{title}</h1>
      <p className="lede">{sub}</p>
    </div>
  );
}

export function Product() {
  return (
    <>
      <PageHero kicker="Product" title="The room, the org, the harness." sub="Channels for people. Computers for bots. A chart that actually runs the company." />
      <section className="wrap section" style={{ paddingTop: 0 }}>
        <div className="grid-3">
          <div className="card">
            <h3>Room</h3>
            <p>Slack muscle memory. Threads, huddles, run cards. @eng fans out through Channel, not a broadcast storm.</p>
          </div>
          <div className="card">
            <h3>Org chart</h3>
            <p>Structure plus work overlay. Click a seat to join the thread or attach OpenCode.</p>
            <p>
              <Link to="/org">Open /org →</Link>
            </p>
          </div>
          <div className="card">
            <h3>Harness</h3>
            <p>The loop is OpenCode. Room drives serve. Power users attach.</p>
            <p>
              <Link to="/harness">Open /harness →</Link>
            </p>
          </div>
        </div>
        <div style={{ marginTop: 28 }}>
          <WorkspaceMock />
        </div>
      </section>
    </>
  );
}

export function Bots() {
  return (
    <>
      <PageHero kicker="Bots" title="Every bot is an OpenCode agent you chose to run." sub="Spec file, session, tools, memory, bus. Deny by default. One job." />
      <section className="wrap section" style={{ paddingTop: 0 }}>
        <div className="grid-2">
          {seats
            .filter((s) => s.kind === "bot" && !s.system)
            .map((s) => (
              <div className="card" key={s.id}>
                <h3>
                  {s.name} <span className="chip">{s.model}</span>
                </h3>
                <p>{s.job}</p>
                <p style={{ marginTop: 8 }}>Reports to {s.reportsTo || "board"}.</p>
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
      </section>
    </>
  );
}

export function Orchestration() {
  return (
    <>
      <PageHero kicker="Orchestration" title="Bots talk to bots. You still own the run." sub="send_message, handoff, share_memory, depend_on, ask_human, report. Channel owns the graph." />
      <section className="wrap section" style={{ paddingTop: 0 }}>
        <blockquote className="card" style={{ fontSize: 20, letterSpacing: "-0.02em" }}>
          Talk to Product and the Eng team. When they complete, have DevOps deploy to staging and QA test everything.
        </blockquote>
        <div className="timeline" style={{ marginTop: 20 }}>
          {["You speak", "Channel compiles", "Product briefs", "@eng ships", "You confirm", "DevOps + QA"].map((t, i) => (
            <div className="tl" key={t}>
              <div className="n">0{i + 1}</div>
              <h3>{t}</h3>
              <p>Audited. Rate-limited. Cycle-detected.</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function HarnessPage() {
  return (
    <>
      <PageHero kicker="Harness" title="Room when you’re talking. Terminal when you’re working." sub="Roster-flow does not reimplement the agent loop. OpenCode is the harness. Same session both sides." />
      <section className="wrap section" style={{ paddingTop: 0 }}>
        <WorkspaceMock initialMode="harness" />
        <div className="grid-3" style={{ marginTop: 24 }}>
          <div className="card">
            <h3>Attach</h3>
            <p>opencode attach to a Roster-flow session. Tab to switch agents. Tool prompts are real.</p>
          </div>
          <div className="card">
            <h3>Headless</h3>
            <p>Room can drive opencode serve. You never have to open the TUI.</p>
          </div>
          <div className="card">
            <h3>⌘.</h3>
            <p>Cycles Room → Harness → Chart. Kill switch lives on the seat.</p>
          </div>
        </div>
      </section>
    </>
  );
}

export function OrgPage() {
  return (
    <>
      <PageHero kicker="Org chart" title="The org chart is the control plane." sub="Hire a bot like you hire a person. Drag a reporting line. Watch the work move." />
      <section className="wrap section" style={{ paddingTop: 0 }}>
        <WorkspaceMock initialMode="chart" />
        <div className="grid-3" style={{ marginTop: 24 }}>
          <div className="card">
            <h3>Hire</h3>
            <p data-testid="org-hire-copy">Template → name → team → tools → tokenBudget → OpenCode session boots.</p>
          </div>
          <div className="card">
            <h3>Escalation</h3>
            <p>ask_human walks reports_to. It never dumps into #general.</p>
          </div>
          <div className="card">
            <h3>Export</h3>
            <p>multi-team.yaml, git-versioned, OpenCode-shaped.</p>
          </div>
        </div>
        <p style={{ marginTop: 16 }}>
          <Link to="/app" className="pill-btn primary">
            Open the live chart
          </Link>
        </p>
      </section>
    </>
  );
}

export function Security() {
  const rows = [
    ["Training on workspace data", "Off. Never."],
    ["Tool permissions", "Deny by default. OpenCode frontmatter is source of truth."],
    ["Deploy / merge / delete", "Confirm (human or dual-control)."],
    ["Bus", "Authenticated, audited, rate-limited, cycle-detected."],
    ["Memory", "Scoped seat / team / project / org."],
    ["Kill switch", "Per bot, per team, per run."],
  ];
  return (
    <>
      <PageHero kicker="Security" title="Permissions first. Then the loop." sub="Amber is for action, not body text. Deny by default. Confirm on deploy." />
      <section className="wrap section" style={{ paddingTop: 0 }}>
        <div className="card">
          {rows.map(([k, v]) => (
            <div className="kv" key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function Pricing() {
  const tiers = [
    ["Starter", "1 project, small roster", "Shared bot-hours", "Room + Harness + Chart"],
    ["Team", "Orgs + teams + bus", "Pool + harness attach", "Parallel runs"],
    ["Enterprise", "SSO, VPC placement", "Dedicated hours + SLA", "Policy engine, audit export"],
  ];
  return (
    <>
      <PageHero kicker="Pricing" title="Seats for humans. Hours for bots." sub="Invite-only. We’ll place you. Bot-hours are OpenCode session time." />
      <section className="wrap section" style={{ paddingTop: 0 }}>
        <div className="grid-3">
          {tiers.map((t) => (
            <div className="card" key={t[0]}>
              <h3>{t[0]}</h3>
              {t.slice(1).map((x) => (
                <p key={x}>{x}</p>
              ))}
              <p style={{ marginTop: 16 }}>
                <Link to="/access" className="pill-btn primary">
                  {t[0] === "Enterprise" ? "Talk to us" : "Request access"}
                </Link>
              </p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function Changelog() {
  return (
    <>
      <PageHero kicker="Changelog" title="Ship log." sub="Short, dated, specific." />
      <section className="wrap section" style={{ paddingTop: 0 }}>
        {changelog.map((c) => (
          <div className="card" key={c.date} style={{ marginBottom: 12 }}>
            <div className="kicker">{c.date}</div>
            <h3>{c.title}</h3>
            <ul>
              {c.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}

export function Access() {
  const [ok, setOk] = useState(false);
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setOk(true);
  }
  return (
    <>
      <PageHero kicker="Access" title="Tell us what Roster-flow should replace first." sub="Work email only. We’ll reply within one business day — usually with a walkthrough of Room and Harness on the same bot." />
      <section className="wrap section" style={{ paddingTop: 0 }}>
        {ok ? (
          <div className="success">
            <h3 style={{ marginTop: 0 }}>You’re on the list.</h3>
            <p>We’ll reply within one business day. No demo theater — we’ll show a real channel.</p>
            <Link to="/app">Meanwhile, open the workspace →</Link>
          </div>
        ) : (
          <form className="form" data-testid="access-form" onSubmit={onSubmit}>
            <label>
              Name
              <input required name="name" />
            </label>
            <label>
              Work email
              <input required type="email" name="email" />
            </label>
            <label>
              Company
              <input required name="company" />
            </label>
            <label>
              Role
              <input name="role" />
            </label>
            <label>
              Team size
              <select name="size" defaultValue="11-50">
                <option>2–10</option>
                <option>11-50</option>
                <option>51–200</option>
                <option>200+</option>
              </select>
            </label>
            <label>
              Replace first
              <select name="replace" defaultValue="Slack + plugins">
                <option>Slack + plugins</option>
                <option>Living in OpenCode alone</option>
                <option>Cursor chat</option>
                <option>ChatGPT</option>
                <option>Other</option>
              </select>
            </label>
            <label>
              Anything we should know?
              <textarea name="note" rows={4} />
            </label>
            <button className="pill-btn primary" type="submit">
              Request access
            </button>
            <p className="micro">We don’t train on your workspace. We won’t sell this list.</p>
          </form>
        )}
      </section>
    </>
  );
}
