# Roster-flow

**Staff an org of OpenCode agents. Talk in a room, open the harness, or run the company from the org chart.**

This is the **CORE** branch: concept, methodology, and orientation. It is **documentation only** — not the application source tree.

The **runnable software** lives on the product branch:

→ **[`DEVELOPMENT`](https://github.com/real-limitless/roster-flow/tree/DEVELOPMENT)**

| | |
|---|---|
| **License** | [Apache-2.0](LICENSE) |
| **Install / code** | [DEVELOPMENT](https://github.com/real-limitless/roster-flow/tree/DEVELOPMENT) |
| **Stand up** | [INSTALLATION.md](INSTALLATION.md) |
| **Branches** | [BRANCHES.md](BRANCHES.md) |
| **Species** | [SPECIES.md](SPECIES.md) |
| **Voice** | [VOICE.md](VOICE.md) |

Every bot is an OpenCode agent. Roster-flow does **not** reimplement the agent loop — it wraps `opencode serve` (the Everflow pattern), maps org-chart seats onto those sessions, and gives humans a Slack-like room plus a living chart.

![Hero: staff an org of agents — talk in a room or open the harness](docs/images/campaign-hero.png)

---

## Visual tour

| | |
| :---: | :---: |
| **Why it exists** | **Room** |
| ![Why: agents and tools do not share a floor](docs/images/campaign-why.png) | ![Room: humans and bots in #ship](docs/images/chat-room.png) |
| **Harness** | **Chart** |
| ![Harness: OpenCode session on Eng.Build](docs/images/chat-harness.png) | ![Chart: reporting lines are the control plane](docs/images/chat-chart.png) |
| **Setup** | **Login** |
| ![Setup: installation, owner, harness, welcome](docs/images/setup-welcome.png) | ![Login: local owner](docs/images/login.png) |

---

## Why this exists

Slack proved work happens in conversation. OpenCode proved the unit of AI labor is a harnessed agent. Those still live in different tabs.

![Channel compiles a sentence into a run you still own](docs/images/campaign-orchestration.png)

**You need this when:**

- The channel should be the audit log — Product briefs, Eng ships, you confirm, DevOps deploys, QA signs
- Every bot is an OpenCode agent you chose to run, not a skin on a chatbot
- Room, harness, and chart are the same seats

---

## Core ideas

1. **OpenCode is the harness** — session, tools, permissions, attach. Roster-flow does not invent a second agent runtime.
2. **Same seats, three surfaces** — Room, Harness, and Chart are views of one org, not three products.
3. **Reporting lines are permission lines** — the org chart is the control plane, not wallpaper.
4. **Channel conducts, specialists execute** — a human sentence becomes a run graph; humans still confirm deploy and merge.
5. **The thread is the audit log** — inter-bot mail, handoffs, and human gates are visible in the room.

### Typical flow

```text
Human in #ship
    → Channel compiles a run
    → Product writes acceptance
    → Eng seats work (each = an OpenCode session)
    → You confirm
    → DevOps deploys
    → QA reports
    → Any seat opens in Harness on the same session
```

---

## Surfaces

| Surface | Feels like | Unit |
|---------|------------|------|
| **Room** | Slack-like channels | Message, thread, run card |
| **Harness** | OpenCode TUI / CLI | Session, tool trace, attach |
| **Chart** | Living org tree | Seat, reporting line, run path |

A **bot** is an OpenCode agent with a Roster-flow identity: name, reports-to, allow/deny tools, model, owner. A **team** is a named roster you can @mention (`@eng`, `@qa`). **Channel** is the conductor: it compiles a human sentence into a run graph and owns `@channel`. It does not ship code. **Architect** is a system seat that proposes org plans on the Chart. A **room** (`#ship`) is a membership list of teams and seats.

---

## Hierarchy

```text
Organization
 └── Project          (repo / product)
      └── Team        (named roster)
           ├── Conductor (Channel)
           ├── Specialist bots  (each = OpenCode agent)
           └── Human members
```

The starter company is one organization with a ship-train project. Product is that project's PM. `@eng`, DevOps, and QA hang off the project. `@services` is org-shared. Multiple projects can sit under the org; each project PM has its own persona, instructions, knowledge, and skills.

---

## Methodology

| Layer | Responsibility |
|-------|----------------|
| **Organization** | Membership, shared providers, org-level seats |
| **Project** | One product / ship-train; owns a PM and project teams |
| **Team** | Named roster with Supervisor + Generic + specialists |
| **Seat** | Human or bot; maps to an OpenCode agent / session |
| **Room** | Shared log and @mentions |
| **Bus** | Inter-bot mail: send, handoff, report, ask-human |
| **Harness** | Real `opencode serve` — company bots and a System serve for Architect / Channel |

**Design principles we optimize for:**

- **Wrap, do not reimplement** — OpenCode owns the loop; Roster-flow owns org, room, bus, and chart.
- **Confirm on deploy** — autonomous work is allowed; skipping the human gate is not the product.
- **Honest offline** — if OpenCode is not installed, the room and chart still work; Architect does not fake a model.
- **Write-through settings** — providers and models land in OpenCode config, not a parallel secret store.
- **Open methodology, open code** — concept lives here on CORE; implementation is open on DEVELOPMENT under Apache-2.0.

Family join points (owned by sibling products, not reimplemented here). Written standard: private TheFLOW.

- skill-flow: Agent Skills catalog and install
- mcp-flow: MCP gateway
- ansible-flow-mcp: Ansible for agents
- OpenFlow: workflows
- wiki-flow: wiki workspace
- CleanFlow: clean-room dock
- ProjectEverflow: governance platform

---

## Get the software

```bash
git clone -b DEVELOPMENT https://github.com/real-limitless/roster-flow.git
cd roster-flow
npm install
npx playwright install chromium
npm run standup
```

- Marketing: http://127.0.0.1:5173/
- First-run setup: http://127.0.0.1:5173/setup
- Workspace: http://127.0.0.1:5173/app
- Settings: http://127.0.0.1:5173/app/settings
- API: http://127.0.0.1:8787/api/v1/health

Full standup, selectors, and Playwright: [docs/STANDUP.md on DEVELOPMENT](https://github.com/real-limitless/roster-flow/blob/DEVELOPMENT/docs/STANDUP.md).  
If you only see markdown and no `package.json`, you are still on `CORE`.

---

## Branch map

| Branch | Audience | Contents |
|--------|----------|----------|
| **CORE** (this branch) | Everyone | Concept, methodology, campaign, install pointers |
| **DEVELOPMENT** | Operators & developers | Runnable app, CORE API, OpenCode wrapper, tests |

```bash
git clone https://github.com/real-limitless/roster-flow.git
cd roster-flow
git checkout DEVELOPMENT
```

### Private work

GitHub **cannot** hide individual branches on a public repository. For personal experiments or internal notes, use a **private fork** or **private sibling repository** — never push secrets or internal-only docs to this public remote.

---

## Resources

- [Product README](https://github.com/real-limitless/roster-flow/blob/DEVELOPMENT/README.md) — standup, workspace, tests
- [Architecture (product)](https://github.com/real-limitless/roster-flow/blob/DEVELOPMENT/docs/ARCHITECTURE.md) — implementation map
- [CORE API](https://github.com/real-limitless/roster-flow/blob/DEVELOPMENT/docs/API.md)
- [OpenCode wrapper](https://github.com/real-limitless/roster-flow/blob/DEVELOPMENT/docs/OPENCODE.md)
- [Campaign brief](docs/CAMPAIGN.md) — positioning (this branch)
- [Conceptual architecture](docs/ARCHITECTURE.md) — consensus (this branch)
- [Project Everflow](https://github.com/real-limitless/ProjectEverflow) — governance platform that also wraps OpenCode

---

## Who made it

**Chen Chiu** · Creator · [@real-limitless](https://github.com/real-limitless)

Part of the Flow family with [mcp-flow](https://github.com/real-limitless/mcp-flow), [skill-flow](https://github.com/real-limitless/skill-flow), [ansible-flow-mcp](https://github.com/real-limitless/ansible-flow-mcp), [OpenFlow](https://github.com/real-limitless/OpenFlow), and [ProjectEverflow](https://github.com/real-limitless/ProjectEverflow). Powered by OpenCode — not an official OpenCode, Slack, or xAI product.

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).
