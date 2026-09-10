# Competitive feature gap — Paperclip and Grok Bot

Internal product brief for `DEVELOPMENT`. This is not a clone list. Roster-flow’s wedge stays **Room · Harness · Chart as the same seats**. Steal the primitives that make Paperclip and Grok Bot feel like a company you can leave running; do not become a 167-agent agency poster, a Linear clone, or a hosted computer-use app.

**Sources (2026-09-10):** [paperclip.ing](https://paperclip.ing/), [paperclipai/paperclip](https://github.com/paperclipai/paperclip) README + docs, [docs.paperclip.ing](https://docs.paperclip.ing/start/core-concepts), [Grok Bot overview](https://docs.x.ai/grok-bot/overview), [skills & routines](https://docs.x.ai/grok-bot/skills-routines-and-automations), [FAQ](https://docs.x.ai/grok-bot/faq), [Teams / Enterprise](https://cursor.com/docs/grok-bot/teams). Roster-flow surface: `docs/ARCHITECTURE.md`, `docs/API.md`, CORE API on this branch, GitHub issues **#2–#24** and **#35**.

Campaign already names the peers (`docs/CAMPAIGN.md`): OpenCode is the harness, Slack is the room, Paperclip-style charts staff agents, Grok Bot is always-on teammates with a computer. This document says **what they ship that we do not**, maps each gap to an existing issue when one exists, and lists unmatched gaps worth filing.

---

## 1. Three products, three jobs

| | **Roster-flow** | **Paperclip** | **Grok Bot** |
|---|---|---|---|
| **Job** | Staff an org of OpenCode agents. Talk in a room, attach the real harness, run the company from the chart. | Human control plane for AI labor: goals, tickets, heartbeats, budgets, board governance. Any agent that can receive a heartbeat. | Named AI teammates on a persistent cloud computer. Message them; they finish work in real apps and only come back for approval. |
| **Unit of work** | Channel-compiled **run** + Slack-like **thread** | **Issue** (ticket) with checkout lock, goal ancestry, comment thread | **Conversation** + **routine** on a shared VM |
| **Unit of labor** | OpenCode agent (session, tools, deny list, PTY attach) | Adapter-invoked agent (Claude Code, Codex, OpenCode, Cursor, HTTP, …) | Grok Bot personality on one Firecracker microVM per *user* |
| **Who is in charge** | Human confirm on deploy/merge. Channel routes. Architect proposes org; Apply mutates. | You are the **board**. Strategy and hires wait on approval. Pause / terminate / override. | Auto Review + member approvals. Enterprise: network, SCIM, action recording. |
| **When agents work** | Mention / bus `wake: true`. Idle when you close the tab. | Scheduled **heartbeats** + assignment + @mention + manual invoke | Cloud computer keeps working with the laptop closed. Routines on cron or events. |
| **Where it runs** | Self-host: Compose or host Node. JSON state. Local OpenCode serves. | Self-host: Node + embedded Postgres. MIT. `npx paperclipai onboard`. | Hosted Cursor/xAI cloud. Desktop + iOS/Android. Not self-host. |
| **License / lock-in** | Apache-2.0. OpenCode is the loop. | MIT. Runtime-agnostic. | Closed. Cursor/SuperGrok plans. |

Paperclip’s own FAQ: it **uses** OpenClaw / Claude Code / Codex; it does not replace them. That is the same architectural rule as Roster-flow (`docs/ARCHITECTURE.md`: do not reimplement the agent loop). The difference is Paperclip already treats **any heartbeat-capable runtime** as a hire, and Grok Bot already treats **a computer** as the product.

Roster-flow already copied the *shape* of Grok Bot collaboration (bus `send_message` / `handoff` / `report` / `ask_human`, group thread = Room) and the *shape* of a Paperclip org chart (hire, fire, reparent, teams, projects). The gaps below are the control-plane and always-on pieces that make those shapes trustworthy at spend.

---

## 2. Honest Roster-flow snapshot (this branch)

Shipped on `DEVELOPMENT` (workspace + CORE API), not marketing copy:

| Surface | What exists |
|---|---|
| **Room** | Channels, membership, @seat / @team / @channel, threads, Block Kit, attachments/skill chips, bus log |
| **Harness** | `opencode serve` company + System, session bind, xterm `opencode attach`, provider write-through to `opencode.json` |
| **Chart** | Living tree, hire / fire / reparent, Architect chat → OrgPlan → Apply, seat inspector |
| **Org model** | One starter org, projects (brief + constitution), staffed teams (Supervisor + Generic), system seats (You, Channel, Architect) |
| **Bus** | `send_message`, `handoff`, `report`, `ask_human`, cycle detect, wake when harness is up |
| **Auth** | Single local owner (scrypt + bearer). Not SSO. `ROSTER_SKIP_ONBOARDING=1` demo path |
| **State** | `.roster-flow/state.json`. No Postgres, no immutable audit store |
| **Family** | Join cards + skill-flow CLI audit/install + mcp-flow ping. Live attach of sibling tools is still [#24](https://github.com/real-limitless/Roster-Flow/issues/24) |

**Not in the CORE API** (grep of `server/` + `docs/API.md`): budgets, heartbeats, tasks/claim locks, `share_memory`, `depend_on`, huddles, org YAML export, pause/kill-switch endpoints, usage/tokens, guest harness seats, `/mcp`, Slack, GitHub cards, multi-user invite.

Marketing still names several of those (`/orchestration`, `/org`, homepage **SSO ready**). Honesty bugs: [#12](https://github.com/real-limitless/Roster-Flow/issues/12)–[#16](https://github.com/real-limitless/Roster-Flow/issues/16). QA of Compose: [#35](https://github.com/real-limitless/Roster-Flow/issues/35) (harness `EACCES` on stock volume, unit tests red, Family mcp-flow false-positive).

Container install ([#2](https://github.com/real-limitless/Roster-Flow/issues/2), closed) landed; it is not a Paperclip-class onboard until harness start works without skip.

---

## 3. What we should not copy

Paperclip’s README is explicit: not a chatbot, not an agent framework, not a workflow builder, not a prompt manager, not a code-review tool. Grok Bot is explicit: no workflow builder required; Bots share **one** computer (not a security boundary).

Roster-flow’s steal-list (`artifacts/roster-flow-implementation-plan.md` §14) already says:

- From Paperclip: mixed human+agent org chart, hire-for-role, budgets, board approval. **Not** 167-agent “install a company” sprawl.
- From Grok Bot: teammates that message each other and have a computer. **Not** becoming a hosted Firecracker product (that is Everflow / cloud sandboxes).

Do **not** replace the Room with a ticket inbox as the only UI. Paperclip *looks like* a task manager; our conversion story is a sentence in `#ship`. Tickets should sit **under** the run, not instead of the channel.

Do **not** reimplement Claude Code / Cursor / Grok Bot loops. [#3](https://github.com/real-limitless/Roster-Flow/issues/3) and [#7](https://github.com/real-limitless/Roster-Flow/issues/7) are chairs and adapters, not a reseller.

---

## 4. Paperclip — feature inventory vs Roster-flow

Paperclip’s public pillars: Agentic Task Manager, Org Chart for Agents, Agent Employee Training, Agentic OS. Under the hood (README “What’s Under the Hood”): identity, work/tasks, heartbeat execution, org chart, workspaces, plugins, budget, routines, secrets, activity, company portability.

Legend: **Have** = shipped on DEVELOPMENT. **Partial** = noun exists, verb does not. **Gap** = they have it, we do not.

### 4.1 Control plane (why a founding team would pick Paperclip)

| Capability | Paperclip | Roster-flow | Issue |
|---|---|---|---|
| Org chart, titles, reporting lines | Have | **Have** (Chart, hire/fire/reparent) | — |
| Hire / fire from the chart | Have | **Have** | — |
| Architect / CEO proposes org or strategy | CEO strategy + hire requests | **Partial**: Architect OrgPlan; no board queue, no CEO heartbeat | unmatched (A) |
| Board approval of hires and strategy | First-class Approvals queue; reject / request revision | Architect Apply is immediate; no pending-approval object | unmatched (A) |
| Pause / resume / terminate an agent | Status: paused, terminated; board can stop heartbeats | Fire only. Marketing “kill switch” is copy. Architect “pause” = fire-from-plan, not a live pause | unmatched (A) |
| Per-agent monthly budget + 80% warn + 100% auto-pause | Have (company + agent caps, cents) | **Gap**. Hire copy still says “tools → budget” | [#4](https://github.com/real-limitless/Roster-Flow/issues/4) |
| Cost by agent / project / goal / issue / model | Have | **Gap** | [#10](https://github.com/real-limitless/Roster-Flow/issues/10) |
| Goal tree (why) above projects (where) above issues (what) | Nested goals; projects link to goals; issues inherit | Project `brief` + `constitution` only. No goal object, no ancestry in prompts | unmatched (B) |
| Ticket / issue as the unit of work | Lifecycle, comments, labels, attachments, work products, inbox | Runs + bus messages. No first-class task | [#8](https://github.com/real-limitless/Roster-Flow/issues/8) |
| Atomic checkout / execution lock | `POST …/issues/:id/checkout` | **Gap**. Two `@eng` specialists can redo the same webhook | [#8](https://github.com/real-limitless/Roster-Flow/issues/8) |
| Blockers / `depend_on` | First-class | Advertised on `/orchestration`, not in API | [#8](https://github.com/real-limitless/Roster-Flow/issues/8), honesty [#14](https://github.com/real-limitless/Roster-Flow/issues/14) |
| Heartbeats (schedule, assignment, @mention, manual, approval resolution) | DB-backed queue, coalescing, recovery of orphaned runs | Wake on mention / `wake: true` only | [#9](https://github.com/real-limitless/Roster-Flow/issues/9) |
| Heartbeat context pack (identity, inbox, goal ancestry, budget) | `GET /api/issues/:id/heartbeat-context`, `GET /api/agents/me` | Prompt is persona + job + this mail. No compact inbox, no goal chain | [#9](https://github.com/real-limitless/Roster-Flow/issues/9) + unmatched (B) |
| Agent inbox | `inbox-lite`, assignments | Room + bus log. No per-seat inbox UI | unmatched (C) |
| Immutable / append-only activity + actor attribution | Mutating actions, cost events, approvals as durable activity | In-memory `trace` ring + bus array in `state.json` (mutable) | unmatched (D) |
| Tool-call tracing on the ticket | Full trace on the issue | Harness TUI / OpenCode session; Room does not show tool trace on the run card | unmatched (D), related [#11](https://github.com/real-limitless/Roster-Flow/issues/11) |

### 4.2 Runtime (why Paperclip can staff mixed orgs)

| Capability | Paperclip | Roster-flow | Issue |
|---|---|---|---|
| Bring-your-own agent / adapter | Claude local, Codex, Gemini, OpenCode, Cursor, Pi, Hermes; HTTP/process/OpenClaw coming | OpenCode only | [#7](https://github.com/real-limitless/Roster-Flow/issues/7) |
| Guest harness joins the same floor | Agents talk via Paperclip API + `SKILL.md` | OpenCode plugin only. Claude Code / Cursor cannot sit in `#ship` | [#3](https://github.com/real-limitless/Roster-Flow/issues/3) |
| Dedicated outbound loops for subscription CLIs | Adapter invoke | Proposed on [#3](https://github.com/real-limitless/Roster-Flow/issues/3) comment (Python loop + skill); not shipped | [#3](https://github.com/real-limitless/Roster-Flow/issues/3) |
| Isolated execution workspaces (git worktrees, operator branches) | Have | Eng.Build job copy says “own a worktree”; CORE does not provision worktrees | unmatched (E) |
| Sandbox / remote environments (e2b, Cloudflare, Daytona, SSH, K8s) | Plugin providers + Environments | Out of scope (Everflow). Honest. | do not file as P0 |
| Runtime services (dev server, preview URL) | Have | **Gap** | unmatched (E) |
| Secrets: instance/company, per-agent, stay out of prompts unless scoped | Have | Provider keys in env / `auth.json`. No per-seat secret grants | unmatched (F) |
| Skill Studio, org-wide skills, skill policy, evals, agent reviews | Have (roadmap items marked done) | Composer skill chips + skill-flow CLI. No studio, no evals, no performance review | [#24](https://github.com/real-limitless/Roster-Flow/issues/24) + unmatched (G) |
| Runtime `SKILL.md` so agents discover the control plane | Paperclip ships agent-facing skill + API catalog | Plugin tools exist; no equivalent “how to be an employee here” skill for non-OpenCode agents | [#3](https://github.com/real-limitless/Roster-Flow/issues/3) |
| Plugins that extend the *control plane* (UI, workers, sandbox providers) | Out-of-process plugins | Flow family is the intended plugin plane — attach is still a card | [#24](https://github.com/real-limitless/Roster-Flow/issues/24) |
| MCP tool gateway (governed tools) | Have | mcp-flow is the sibling; Roster does not consume it live | [#24](https://github.com/real-limitless/Roster-Flow/issues/24) |
| Routines: cron, webhook, API trigger → tracked issue → wake agent | Have | **Gap** (heartbeat [#9](https://github.com/real-limitless/Roster-Flow/issues/9) is the wake primitive; routines are the productized schedule) | unmatched (H) |
| Watchdogs / enforced outcomes / self-healing orphaned runs | Have | **Gap** | unmatched (I) |
| Artifacts & work products on the issue | Have | File chips + attachments metadata (no blob store / work-product object) | unmatched (J) |
| Deep planning: revisioned plans, plan approvals | Have | Architect plans exist; no revision history, no board approve-before-apply | unmatched (A) |
| Company export/import (agents, skills, projects, routines, secret scrub) | `companies.sh` / portability | Advertised `multi-team.yaml`; no API | [#20](https://github.com/real-limitless/Roster-Flow/issues/20) |
| Multi-company isolation on one deployment | Unlimited companies, company-scoped entities | Single starter org in one `state.json` | unmatched (K) |
| Durable DB | Embedded Postgres | JSON file | unmatched (L) — only if heartbeats/budgets/tickets need crash-safe queues |
| Agent API keys + short-lived run JWTs | Have | Owner bearer / `roster-demo` | [#3](https://github.com/real-limitless/Roster-Flow/issues/3) (harness tokens) |
| Multiple human users, invites, memberships | Have | One owner. Seed humans are data, not logins | [#18](https://github.com/real-limitless/Roster-Flow/issues/18) |
| Mobile-ready UI | `pnpm dev:mobile`, phone monitoring | Desktop web. No mobile layout pass for `/app` | unmatched (M) |
| One-command onboard, no account | `npx paperclipai onboard --yes` | Compose + `/setup` owner. Default GitHub clone is CORE docs | [#16](https://github.com/real-limitless/Roster-Flow/issues/16), [#17](https://github.com/real-limitless/Roster-Flow/issues/17) |
| Community (Discord, Discussions) | Have | **Gap** | [#23](https://github.com/real-limitless/Roster-Flow/issues/23) |
| Opt-in OTEL / Sentry | Have | **Gap** | unmatched (D) |
| Knowledge / memory product | Roadmap (⚪ Memory / Knowledge) | Project constitution field; no indexer | [#6](https://github.com/real-limitless/Roster-Flow/issues/6) |

### 4.3 Paperclip roadmap items that are still open (do not treat as table stakes)

Paperclip itself has not shipped: MAXIMIZER MODE, work queues, self-organization, automatic org learning, CEO chat, desktop app, BYO ticket system (Asana/Linear/Jira), connected apps (Vercel). **Do not file Roster-flow issues to “catch” those.** Linear/Jira as an on-ramp is interesting later; our on-ramp is `#ship` and GitHub cards ([#11](https://github.com/real-limitless/Roster-Flow/issues/11)).

---

## 5. Grok Bot — feature inventory vs Roster-flow

Grok Bot’s pitch is the opposite of Paperclip’s: **no org chart required**. Create a Bot, message it, grant access. Coordination is group chat + shared computer, not reporting lines.

Roster-flow already implemented the collaboration verbs Grok Bot made famous (`docs/ARCHITECTURE.md` “Bot-to-bot”). The missing Grok Bot feelings are **computer**, **always-on**, **teach once / run forever**, and **approval as a product**.

| Capability | Grok Bot | Roster-flow | Issue |
|---|---|---|---|
| Named persistent teammate with role memory | Have | Seat + OpenCode session (lost if harness/session dies; no durable memory block) | unmatched (N); advertised `share_memory` is [#14](https://github.com/real-limitless/Roster-Flow/issues/14) |
| Bots message each other and hand off | Have | **Have** (bus) | — |
| Group thread where several bots coordinate | Have | **Have** (Room) | — |
| You are not the router | Chief-of-staff Bot or group chat | Channel conductor — **Have** (scripted / harness) | — |
| Persistent cloud computer (browser, FS, terminal) | Firecracker microVM per user; all Bots share it | Local OpenCode cwd. No hosted computer, no computer-use viewer | unmatched (O) — Everflow / do not clone as P0 |
| Shared logins / cookies / files across bots | Have (explicitly not a security boundary) | Separate OpenCode sessions; no shared browser | unmatched (O) |
| Computer-use for apps with no API | Have | OpenCode tools + optional webfetch. No GUI operator | unmatched (O) |
| Connectors / MCP plugins marketplace | Settings → Plugins; team connector policy | Family cards; mcp-flow not live-attached | [#24](https://github.com/real-limitless/Roster-Flow/issues/24), [#6](https://github.com/real-limitless/Roster-Flow/issues/6) |
| Delegate coding to a separate Cloud Agent computer | Have; admin can disable | Harness is local OpenCode. No spawn-to-cloud | unmatched (O) |
| Works with laptop closed / 24/7 | Cloud computer + routines | Process dies with Compose/host | [#9](https://github.com/real-limitless/Roster-Flow/issues/9) (heartbeat) is the self-host analogue |
| Skills (how) vs routines (when) | First-class; `/` skill, `@` routine | Skill chips are catalog names, not saved procedures. No routine object | unmatched (H) + [#24](https://github.com/real-limitless/Roster-Flow/issues/24) |
| Teach-by-demonstration (record up to 10 min → draft skill) | Rolling out | **Gap** | unmatched (P) — later; do not block company mechanics |
| Event-triggered routines (Slack message, GitHub notification) | Cursor account integrations | **Gap** | [#5](https://github.com/real-limitless/Roster-Flow/issues/5), [#11](https://github.com/real-limitless/Roster-Flow/issues/11), unmatched (H) |
| Auto Review (independent model on risky actions) | Have; Enterprise can enforce + team rules | Deny lists on seats; confirm-on-deploy is a social rule, not an evaluated policy engine | unmatched (A) |
| Computer takeover for 2FA / CAPTCHA / passwords | Have; masked secret request | **Gap** (N/A until computer-use) | unmatched (O) |
| Desktop app (macOS/Windows/Linux) + iOS + Android | Have | Browser only | unmatched (M) |
| Same bots on phone for approve / nudge | Have | **Gap** | unmatched (M) |
| Share a Bot template (no computer, no logins) | Public share link | Org YAML not shipped | [#20](https://github.com/real-limitless/Roster-Flow/issues/20) |
| Multi-human on one floor | Teams: each *person* has their own computer + Bots | One owner in one room | [#18](https://github.com/real-limitless/Roster-Flow/issues/18) |
| Team Rules, SCIM, SSO, network allowlist, action recording, OTEL | Enterprise | Marketing SSO; no IdP | [#13](https://github.com/real-limitless/Roster-Flow/issues/13); unmatched (Q) |
| Spend cap per Bot | **Not available** (account usage only) | We can beat Grok Bot here if [#4](https://github.com/real-limitless/Roster-Flow/issues/4)+[#10](https://github.com/real-limitless/Roster-Flow/issues/10) ship | **advantage if shipped** |
| Slack as the room people already open | Event trigger + plugins; not the home UI | Room is a second localhost app | [#5](https://github.com/real-limitless/Roster-Flow/issues/5) |
| Create a Bot and just message it (zero org ceremony) | Core UX | Setup wizard + starter company. Empty-org path exists | [#19](https://github.com/real-limitless/Roster-Flow/issues/19) |

Grok Bot FAQ: **no separate Grok Bot spend cap**. Paperclip and (if we ship it) Roster-flow win on “I can leave the org running without a surprise bill.” That is the single best commercial counter to Grok Bot for self-hosted OpenCode teams.

---

## 6. GitHub issue matching (complete)

Every open issue on `real-limitless/Roster-Flow` as of 2026-09-10, mapped to a competitor primitive. **Do not file duplicates** of the Competitive / Idea cluster.

### 6.1 Competitive issues (already the Paperclip / Grok Bot steal-list)

| Issue | Title | Paperclip | Grok Bot | Why it is beneficial |
|---|---|---|---|---|
| [#3](https://github.com/real-limitless/Roster-Flow/issues/3) | MCP room + guest harness seats (+ outbound CLI loops in comments) | BYO agent + `SKILL.md` API | Plugins / MCP; Bots as teammates | Lets Claude Code / Cursor / Codex sit in `#ship` without pasting their keys into OpenCode. Core interop. |
| [#4](https://github.com/real-limitless/Roster-Flow/issues/4) | Per-seat monthly token budgets + auto-pause | Table stakes | Grok Bot **cannot** do this | Founding teams will not staff `@eng` on live models without a hard stop. |
| [#5](https://github.com/real-limitless/Roster-Flow/issues/5) | Slack (then Teams) bridge | Why-not-Asana FAQ; Slack is a transport | Slack event → routine | Primary audience already lives in Slack. Highest-friction ask is “move the audit log.” |
| [#6](https://github.com/real-limitless/Roster-Flow/issues/6) | Company knowledge connectors | Memory still roadmap; connectors via plugins | Notion/Gmail/Drive plugins | Product bot that briefs from a persona string is a toy vs Dust/Grok. |
| [#7](https://github.com/real-limitless/Roster-Flow/issues/7) | BYO-agent adapters | “If it can receive a heartbeat, it’s hired” | N/A (closed runtime) | OpenCode-only is a wall. Adapters keep Room+Chart as the plane. |
| [#8](https://github.com/real-limitless/Roster-Flow/issues/8) | Shared task board, claim locks, blockers | Issues + checkout | Implicit in conversation | Double-work kills trust. Matches advertised `depend_on`. |
| [#9](https://github.com/real-limitless/Roster-Flow/issues/9) | Heartbeat wakes | Heartbeat protocol | Always-on cloud + routines | Org dies when the tab closes. Secondary audience will not babysit `/app`. |
| [#10](https://github.com/real-limitless/Roster-Flow/issues/10) | Seat/run spend dashboard | Cost panel | Usage page, no per-bot cap | `/pricing` already bills “hours for bots” with no meter. |
| [#11](https://github.com/real-limitless/Roster-Flow/issues/11) | GitHub PR/issue cards in `#ship` | Not their core UI | GitHub event routines | Ship-train feels real when the thread shows the PR and confirm-on-merge. |

### 6.2 Idea issues (adoption / Paperclip onboard parity)

| Issue | Title | Competitor analogue |
|---|---|---|
| [#17](https://github.com/real-limitless/Roster-Flow/issues/17) | Public seeded demo into `#ship` | Paperclip `npx … onboard --yes`; Grok “create a Bot” |
| [#18](https://github.com/real-limitless/Roster-Flow/issues/18) | Invite a second human | Paperclip multi-user; Grok Teams (different isolation model) |
| [#19](https://github.com/real-limitless/Roster-Flow/issues/19) | First ship-train tutorial | Paperclip first CEO heartbeat; Grok first handoff |
| [#20](https://github.com/real-limitless/Roster-Flow/issues/20) | Org YAML export/import | Paperclip company portability; Grok share-a-Bot (weaker) |
| [#21](https://github.com/real-limitless/Roster-Flow/issues/21) | Owner password change/recovery | Table-stakes identity; Paperclip has real auth modes |
| [#22](https://github.com/real-limitless/Roster-Flow/issues/22) | `/access` operator inbox + walkthrough | Grok/Dust demo motion |
| [#23](https://github.com/real-limitless/Roster-Flow/issues/23) | Community home | Paperclip Discord + Discussions |
| [#24](https://github.com/real-limitless/Roster-Flow/issues/24) | Live-attach Flow family | Paperclip plugins + MCP gateway; Grok plugin marketplace |

### 6.3 Honesty / install (block evaluation before any competitive feature matters)

| Issue | Title | Competitor analogue |
|---|---|---|
| [#12](https://github.com/real-limitless/Roster-Flow/issues/12) | `/access` never stores email | Paperclip has no fake waitlist; onboard is the product |
| [#13](https://github.com/real-limitless/Roster-Flow/issues/13) | Homepage “SSO ready” | Paperclip + Grok actually do identity |
| [#14](https://github.com/real-limitless/Roster-Flow/issues/14) | Marketing: huddles, `share_memory`, budgets, yaml | Paperclip ships the nouns it prints |
| [#15](https://github.com/real-limitless/Roster-Flow/issues/15) | Login “start over” bounce | Paperclip trusted-local onboard does not trap you |
| [#16](https://github.com/real-limitless/Roster-Flow/issues/16) | Default branch is CORE | Paperclip default clone runs |
| [#35](https://github.com/real-limitless/Roster-Flow/issues/35) | QA: Compose harness `EACCES`, unit fails, Family false-positive, no Sign out | Paperclip heartbeat actually starts |

[#2](https://github.com/real-limitless/Roster-Flow/issues/2) (containerization) is **closed**; treat remaining Compose harness permissions as part of [#35](https://github.com/real-limitless/Roster-Flow/issues/35), not a new competitive issue.

---

## 7. Unmatched gaps (beneficial, no issue yet)

File these as new issues only if we intend to build them. Letters match the tables above. Suggested titles are copy-paste.

### P1 — company you can leave running (Paperclip table stakes)

| ID | Suggested issue | Why | Notes |
|---|---|---|---|
| **A** | Competitive: Board governance — pause/resume, hire+strategy approval queue, kill switch | Paperclip’s “you’re in charge” is a queue, not a slogan. Grok Auto Review is the hosted version. Architect Apply currently mutates immediately. Marketing already claims kill switch. | Keep Architect as the proposer. Add `approvals[]` (hire, strategy/plan, budget override, deploy already wants human). Pause ≠ fire (inbox still readable; no wake). |
| **B** | Competitive: Goal ancestry on every wake (mission → project → task) | Paperclip’s conversion story is “manage goals, not PRs.” We have project brief/constitution but prompts do not carry why. | Do **not** build a Goals product UI first. Persist `goals[]` on the org/project and inject 10 lines into `promptBody`. Full goal tree UI can wait. |
| **C** | Competitive: Per-seat inbox (unread bus + assigned tasks) | Paperclip `inbox-lite` is what a heartbeat reads. Chart/Room have no “what does Eng.Build owe?” | Natural join of [#8](https://github.com/real-limitless/Roster-Flow/issues/8)+[#9](https://github.com/real-limitless/Roster-Flow/issues/9). Could be a pane, not a new app. |
| **H** | Competitive: Routines (cron / webhook → issue → wake) | Heartbeat [#9](https://github.com/real-limitless/Roster-Flow/issues/9) is “wake and check mail.” Grok/Paperclip routines are “this job, this schedule, this approval boundary.” QA/Scribe/Scout need this or they are demo seats. | Implement **after** [#9](https://github.com/real-limitless/Roster-Flow/issues/9)+[#8](https://github.com/real-limitless/Roster-Flow/issues/8). A routine is a row that creates a task and sets `wake`. |

### P2 — trust, audit, secrets

| ID | Suggested issue | Why | Notes |
|---|---|---|---|
| **D** | Competitive: Durable activity log (actor, cost event, tool trace pointer) | Paperclip tickets are the audit log. We say the channel is the audit log, but `state.json` is mutable and `trace` is a debug ring. Grok Enterprise streams OTEL. `/security` claims audit. | Append-only file or SQLite is enough. Do not need Paperclip’s full event fabric. Point Room run cards at OpenCode session/tool traces. |
| **F** | Competitive: Per-seat secret grants (env injection at wake) | Paperclip injects secrets into the heartbeat, not into every prompt. DevOps deploy tokens should not live in Product’s session. | Family/mcp-flow vaults remain source of truth. Roster stores **references**. |
| **I** | Competitive: Watchdog on a parked run | Paperclip task watchdog. Ship-train dies silently today if Eng.Build never `report`s. | Timer: if a claimed task has no bus activity, wake Supervisor or `ask_human`. Depends on [#8](https://github.com/real-limitless/Roster-Flow/issues/8)+[#9](https://github.com/real-limitless/Roster-Flow/issues/9). |

### P3 — runtime fidelity (without becoming Everflow)

| ID | Suggested issue | Why | Notes |
|---|---|---|---|
| **E** | Competitive: Per-seat git worktree + preview URL on the run card | Paperclip isolated workspaces. Implementation plan P0 already promised “worktree per Eng.Build.” Two specialists in one cwd is how we get smashed diffs. | Local `git worktree` only. No e2b. Pair with [#11](https://github.com/real-limitless/Roster-Flow/issues/11). |
| **G** | Idea: Seat evals / saved ship-train fixtures | Paperclip Skill Studio + evals. We will not know if Channel still compiles the canonical sentence after a prompt change. | A fixture of `#ship` messages + expected bus graph. Cheaper than a studio. |
| **J** | Competitive: Work products (PR, report file, screenshot) as first-class objects | Paperclip artifacts. Grok leaves files on the computer. We have chips with no blob store. | Store under `.roster-flow/products/` and attach to the run. |
| **N** | Competitive: `share_memory` namespaces (seat / team / project / run) | Advertised. Grok Bots keep role memory. Scribe’s job is memory and it has no store. | Bus verb + scoped files. Honesty [#14](https://github.com/real-limitless/Roster-Flow/issues/14) tracks the lie until this or copy is cut. |

### Later / do not pretend we are Grok Bot

| ID | Suggested issue | Why to wait |
|---|---|---|
| **K** | Multi-company isolation | Paperclip portfolio play. Our audience is one 8–200 person company. YAML [#20](https://github.com/real-limitless/Roster-Flow/issues/20) is the honest portability step. |
| **L** | Postgres | Only if heartbeat queue + budgets cannot be correct on JSON. Don’t migrate for fashion. |
| **M** | Mobile / desktop apps | Paperclip mobile-ready; Grok is apps-first. Responsive `/app` + Tailscale is enough until [#18](https://github.com/real-limitless/Roster-Flow/issues/18) is real. |
| **O** | Hosted computer-use VM | Grok Bot’s actual product. Roster-flow wraps OpenCode. Cloud sandboxes = Everflow. Optional later: “open computer view” = the Harness PTY we already have. |
| **P** | Teach-by-demonstration | Grok-only wedge. We can save a skill from a finished `#ship` thread first (text, not screen record). |
| **Q** | SSO / SCIM / egress / action recording | Enterprise pricing copy. Do not restore “SSO ready” until IdP login exists ([#13](https://github.com/real-limitless/Roster-Flow/issues/13)). |

### Small QA leftovers (not competitive, still unmatched as issues)

From [#35](https://github.com/real-limitless/Roster-Flow/issues/35): **Sign out button** (API exists), Chart ellipse console errors, Block Kit “Channelnow” spacing, GitHub Pages 404. File as bugs if we want them tracked separately; do not mix into Competitive.

---

## 8. Recommended build order (technical, not calendar)

Honesty and a working harness are not competitive features; they are why anyone would try the competitive features.

```
1. Honesty + install
   #12 #13 #14 #15 #16
   #35 P1.1 Compose opencode.json EACCES (otherwise Harness is a lie)
   Sign out (from #35)

2. Company you can staff without babysitting
   #4  budgets (hard stop)
   #10 spend (so budgets have a numerator)
   #9  heartbeats (wake without a human in #ship)
   #8  tasks + claim + blockers (heartbeat has something to check out)
   A   pause / approval queue (or heartbeats will run unattended with no board)
   B   goal/constitution injected on wake (cheap, unblocks “why”)

3. Mixed org (Paperclip’s hire model, our Room)
   #3  MCP room (inbound)
   #7  webhook/CLI adapters
   #3  outbound loops (comment) once inbound exists
   #24 Family attach (tools, not a second editor)

4. Room gravity
   #11 GitHub PR cards
   #5  Slack bridge
   #19 in-app ship-train tutorial
   C   per-seat inbox
   H   routines (cron) on top of #9+#8

5. Humans and portability
   #18 second human
   #20 org YAML
   #17 public demo
   D   durable activity log
   E   worktrees
   N   share_memory (or delete the marketing verb)

6. Do not start
   Hosted computer-use, SSO, multi-company, Postgres, Skill Studio,
   teach-by-demo, desktop/iOS, 167-agent templates.
```

**If we only ship three competitive issues:** **#4, #9, #8**. That is Paperclip’s heartbeat loop (budget + wake + claim) inside our Room. Grok Bot still wins on computer-use; we win on “OpenCode you can attach” and “hard spend stop they do not have.”

**If we only ship one interop issue:** **#3**. That is how subscription-locked harnesses enter `#ship` without us becoming a model reseller.

---

## 9. Scorecard (honest)

| Theme | Paperclip | Grok Bot | Roster-flow now | Path |
|---|---|---|---|---|
| Slack-like room as audit log | Tickets, not Slack | Chat, not Slack | **Lead** | Keep; add [#5](https://github.com/real-limitless/Roster-Flow/issues/5) so it is not a second room |
| Drop into the real coding harness | Adapter to OpenCode/Claude; no first-class TUI in-app | Cloud computer + optional Cloud Agent | **Lead** (PTY attach) | Fix Compose [#35](https://github.com/real-limitless/Roster-Flow/issues/35) |
| Org chart as control plane | **Lead** | Weak (flat Bots) | Partial (no pause, no budget, no board queue) | [#4](https://github.com/real-limitless/Roster-Flow/issues/4), A |
| Any runtime on one chart | **Lead** | Closed | OpenCode-only | [#7](https://github.com/real-limitless/Roster-Flow/issues/7), [#3](https://github.com/real-limitless/Roster-Flow/issues/3) |
| Tickets / claim / goals | **Lead** | Informal | Runs only | [#8](https://github.com/real-limitless/Roster-Flow/issues/8), B |
| Always-on / schedules | Heartbeats + routines | **Lead** (cloud VM) | Event-only | [#9](https://github.com/real-limitless/Roster-Flow/issues/9), H |
| Cost hard-stop | **Lead** | Missing | Missing | [#4](https://github.com/real-limitless/Roster-Flow/issues/4), [#10](https://github.com/real-limitless/Roster-Flow/issues/10) |
| Computer-use in real GUIs | Sandboxes optional | **Lead** | No | Out of wedge |
| Teach / skills / routines | Skills + routines | **Lead** (demo record) | Chips | [#24](https://github.com/real-limitless/Roster-Flow/issues/24), H, P |
| Mobile + 24/7 away from desk | Partial | **Lead** | No | M after [#9](https://github.com/real-limitless/Roster-Flow/issues/9) |
| Self-host, open source, no account | **Lead** | No | Partial (Compose, CORE default-branch trap) | [#16](https://github.com/real-limitless/Roster-Flow/issues/16), [#17](https://github.com/real-limitless/Roster-Flow/issues/17) |
| Enterprise IdP / egress | Partial | **Lead** | Copy only | [#13](https://github.com/real-limitless/Roster-Flow/issues/13) |

---

## 10. How to use this in GitHub

- Competitive work: comment on **#3–#11** with a pointer here instead of opening a twin.
- New P1 issues to file: **A, B, C, H** (section 7).
- Close or retitle marketing lies via **#14** when the verb ships or the copy dies.
- Re-audit this file when Paperclip’s ⚪ Memory/Knowledge or Grok Bot spend caps change; do not assume this snapshot stays true.

Related: `docs/CAMPAIGN.md` (positioning), `docs/ARCHITECTURE.md` (what this slice is), `docs/API.md` (shipped verbs), `artifacts/roster-flow-implementation-plan.md` §13–14 (older backlog + steal-list).
