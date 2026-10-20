/**
 * Roster-flow CORE plugin for OpenCode.
 * Same shape as Oh My OpenAgent: default Plugin export, tools + hooks.
 * Tools POST to the CORE bus so Room / Chart stay the source of truth.
 */

const API = process.env.ROSTER_API || "http://127.0.0.1:8790";

/** Seat calls use the scoped token when the harness was started with ROSTER_API_TOKEN. */
export function rosterAuthHeaders(env = process.env) {
  const token = String(env.ROSTER_API_TOKEN || "").trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function api(path, init = {}) {
  const headers = { ...rosterAuthHeaders(), ...(init.headers || {}) };
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

/**
 * wiki-flow client. Reads WIKIFLOW_URL (base URL) and WIKIFLOW_TOKEN (Bearer)
 * at call time so a running serve picks up rotated tokens.
 */
export function wikiflowConfig(env = process.env) {
  const token = String(env.WIKIFLOW_TOKEN || "").trim();
  const base = String(env.WIKIFLOW_URL || "").trim().replace(/\/+$/, "");
  if (!token) throw new Error("WIKIFLOW_TOKEN is not set. Export it in the OpenCode serve env to use wikiflow_* tools.");
  if (!base) throw new Error("WIKIFLOW_URL is not set. Point it at the wiki-flow base URL (e.g. https://wiki.example).");
  return { token, base };
}

export async function wikiflowApi(path, init = {}, env = process.env, fetchImpl = fetch) {
  const { token, base } = wikiflowConfig(env);
  const headers = { accept: "application/json", authorization: `Bearer ${token}`, ...(init.headers || {}) };
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetchImpl(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`wiki-flow ${res.status}: ${data?.error || res.statusText || "request failed"}`);
  return data;
}

function repoPath(owner, repo) {
  if (!owner || !repo) throw new Error("owner and repo are required");
  return `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function parseSources(raw) {
  if (raw === undefined || raw === null || raw === "") return [];
  const v = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(v)) throw new Error("sources must be a JSON array");
  return v.map((entry, i) => {
    const where = `sources[${i}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${where} must be {path, startLine?, endLine?}`);
    const extra = Object.keys(entry).filter((k) => !["path", "startLine", "endLine"].includes(k));
    if (extra.length) throw new Error(`${where} has unknown keys: ${extra.join(", ")}`);
    if (typeof entry.path !== "string" || !entry.path.trim()) throw new Error(`${where}.path is required`);
    const out = { path: entry.path };
    for (const k of ["startLine", "endLine"]) {
      if (entry[k] === undefined) continue;
      if (!Number.isInteger(entry[k]) || entry[k] < 1) throw new Error(`${where}.${k} must be a positive integer`);
      out[k] = entry[k];
    }
    if (out.startLine && out.endLine && out.endLine < out.startLine) throw new Error(`${where}.endLine must be >= startLine`);
    return out;
  });
}

export const NO_ROOM_ERROR =
  "This session is not bound to a Roster-flow room. Pass channel (for example channel=ship), or call the tool from a room session.";

export function buildTools(tool, fetchApi = api, wikiApi = wikiflowApi) {
  const z = tool.schema;
  const rooms = new Map();
  /** The room of the calling session (`GET /api/v1/sessions/:id/room`), or null. */
  async function roomOf(ctx) {
    const id = ctx?.sessionID || ctx?.sessionId;
    if (!id) return null;
    if (!rooms.has(id)) {
      const found = await fetchApi(`/api/v1/sessions/${encodeURIComponent(id)}/room`).catch(() => null);
      rooms.set(id, found?.channelId || null);
    }
    return rooms.get(id);
  }
  async function roomOrFail(ctx, explicit) {
    const channel = explicit || (await roomOf(ctx));
    if (!channel) throw new Error(NO_ROOM_ERROR);
    return channel;
  }
  const sessionOf = (ctx) => ctx?.sessionID || ctx?.sessionId || undefined;
  return {
    roster_list_seats: tool({
      description: "List Roster-flow org-chart seats (humans and OpenCode bots), teams, and projects.",
      args: {},
      async execute() {
        const [seats, teams, projects] = await Promise.all([
          fetchApi("/api/v1/seats"),
          fetchApi("/api/v1/teams"),
          fetchApi("/api/v1/projects").catch(() => []),
        ]);
        return { title: "Roster", output: JSON.stringify({ seats, teams, projects }, null, 2) };
      },
    }),
    roster_propose_org: tool({
      description: "Propose an OrgPlan (replace_org, create_project, hire, fire). Does not apply. Human Apply commits.",
      args: {
        message: z.string().describe("What to staff, create, or cut"),
      },
      async execute(args) {
        const out = await fetchApi("/api/v1/architect/chat", {
          method: "POST",
          body: JSON.stringify({ message: args.message }),
        });
        return { title: out.plan?.summary || "Org plan", output: JSON.stringify(out) };
      },
    }),
    roster_send_message: tool({
      description:
        "Send a message to a seat id, team:eng, or channel:ship on the audited bus. Optional blocks is a Roster Block Kit JSON array.",
      args: {
        to: z.string().describe("Seat id, team:<id>, or channel:<id>"),
        text: z.string().describe("Message body (fallback if blocks are set)"),
        from: z.string().optional().describe("Your seat id if known"),
        channel: z.string().optional().describe("Room to post in. Defaults to the room of this session"),
        blocks: z.string().optional().describe("Optional Roster Block Kit JSON array"),
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        const blocks = parseBlocks(args.blocks);
        const toRoom = String(args.to || "").startsWith("channel:") ? String(args.to).slice("channel:".length) : null;
        const channel = await roomOrFail(ctx, args.channel || toRoom);
        const entry = await fetchApi("/api/v1/messages", {
          method: "POST",
          body: JSON.stringify({ to: args.to, text: args.text, from, wake: true, blocks, channel, sessionId: sessionOf(ctx) }),
        });
        return { title: `→ ${args.to}`, output: JSON.stringify(entry) };
      },
    }),
    roster_handoff: tool({
      description: "Close your phase and open the next seat with a brief. Fire-and-forget (Oh My OpenAgent mailbox style).",
      args: {
        to: z.string(),
        text: z.string(),
        from: z.string().optional(),
        channel: z.string().optional().describe("Room the handoff is posted in. Defaults to the room of this session"),
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        const channel = await roomOrFail(ctx, args.channel);
        const entry = await fetchApi("/api/v1/bus/send", {
          method: "POST",
          body: JSON.stringify({ from, to: args.to, kind: "handoff", text: args.text, wake: true, channel, sessionId: sessionOf(ctx) }),
        });
        return { title: `handoff → ${args.to}`, output: JSON.stringify(entry) };
      },
    }),
    roster_report: tool({
      description:
        "Post a structured result back to the originating Room thread. Pass jobId to complete that job (done, failed, or needs_human). Optional prUrl/branch render a GitHub card. Optional blocks is Roster Block Kit JSON.",
      args: {
        text: z.string(),
        channel: z.string().optional().describe("Room to post in. Defaults to the room of this session"),
        from: z.string().optional(),
        prUrl: z.string().optional().describe("GitHub pull request URL to render as a Room card"),
        branch: z.string().optional().describe("Worktree branch name (local; not a sandbox)"),
        blocks: z.string().optional().describe("Optional Roster Block Kit JSON array"),
        jobId: z.string().optional().describe("Job id to complete"),
        status: z.string().optional().describe("With jobId: done (default), failed, or needs_human"),
        cost: z.string().optional().describe("Optional cost, a non-negative number"),
        tokens: z.string().optional().describe("Optional usage: a number or JSON {input, output, total}"),
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        const blocks = parseBlocks(args.blocks);
        if (args.jobId) {
          const channel = args.channel || (await roomOf(ctx));
          const body = {
            result: args.text,
            status: args.status || "done",
            from,
            ...(channel ? { channel } : {}),
          };
          if (args.prUrl) body.prUrl = args.prUrl;
          if (args.branch) body.branch = args.branch;
          if (args.cost != null && args.cost !== "") body.cost = Number(args.cost);
          if (args.tokens) body.tokens = parseTokenArg(args.tokens);
          const job = await fetchApi(`/api/v1/jobs/${encodeURIComponent(args.jobId)}/complete`, {
            method: "POST",
            body: JSON.stringify(body),
          });
          return { title: `job ${body.status}`, output: JSON.stringify(job) };
        }
        const channel = await roomOrFail(ctx, args.channel);
        const entry = await fetchApi("/api/v1/bus/send", {
          method: "POST",
          body: JSON.stringify({
            from,
            to: `channel:${channel}`,
            kind: "report",
            text: args.text,
            channel,
            wake: false,
            blocks,
            prUrl: args.prUrl,
            branch: args.branch,
            sessionId: sessionOf(ctx),
          }),
        });
        return { title: "report", output: JSON.stringify(entry) };
      },
    }),
    roster_ask_human: tool({
      description: "Park the run on your reports_to human. Never dump into #general. Pass jobId to mark that job needs_human.",
      args: {
        text: z.string(),
        from: z.string().optional(),
        jobId: z.string().optional().describe("Job id to park as needs_human"),
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        const seats = await fetchApi("/api/v1/seats");
        const me = seats.find((s) => s.id === from);
        const manager = me?.reportsTo || "you";
        if (args.jobId) {
          await fetchApi(`/api/v1/jobs/${encodeURIComponent(args.jobId)}/complete`, {
            method: "POST",
            body: JSON.stringify({ status: "needs_human", result: args.text, from, announce: false }),
          });
        }
        const entry = await fetchApi("/api/v1/bus/send", {
          method: "POST",
          body: JSON.stringify({
            from,
            to: manager,
            kind: "ask_human",
            text: args.text,
            wake: false,
            ...(args.jobId ? { jobId: args.jobId } : {}),
          }),
        });
        return { title: `ask ${manager}`, output: JSON.stringify(entry) };
      },
    }),
    roster_knowledge: tool({
      description: "Search project-scoped knowledge (constitution, attached git/docs). Only the current seat’s project.",
      args: {
        q: z.string().describe("Search query"),
        projectId: z.string().optional().describe("Project id. Defaults to this seat’s project."),
        from: z.string().optional(),
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        let projectId = args.projectId;
        if (!projectId) {
          const seats = await fetchApi("/api/v1/seats");
          const me = Array.isArray(seats) ? seats.find((s) => s.id === from) : null;
          projectId = me?.projectId || "billing";
        }
        const out = await fetchApi(
          `/api/v1/projects/${projectId}/knowledge?q=${encodeURIComponent(args.q)}&seatId=${encodeURIComponent(from)}`,
        );
        return { title: `knowledge ${projectId}`, output: JSON.stringify(out) };
      },
    }),
    roster_inbox: tool({
      description:
        "Read this seat’s inbox: bus mail to you, team:<id> if you are that team’s Supervisor, or channel:<id> rooms you are in. Unread is everything after your cursor.",
      args: {
        seatId: z.string().optional().describe("Seat id. Defaults to the current agent."),
      },
      async execute(args, ctx) {
        const id = args.seatId || guessSeat(ctx.agent);
        const path = !id || id === "me" ? "/api/v1/seats/me/inbox" : `/api/v1/seats/${id}/inbox`;
        const out = await fetchApi(path);
        return { title: `inbox ${id}`, output: JSON.stringify(out) };
      },
    }),
    roster_task_create: tool({
      description: "Create a board task on a project/run. Optional depend_on (task id) is a blocker.",
      args: {
        title: z.string(),
        projectId: z.string().optional(),
        runId: z.string().optional(),
        depend_on: z.string().optional().describe("Task id that must be done before claim"),
        path: z.string().optional(),
      },
      async execute(args) {
        const out = await fetchApi("/api/v1/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: args.title,
            projectId: args.projectId,
            runId: args.runId,
            depend_on: args.depend_on,
            path: args.path,
          }),
        });
        return { title: `task ${out.id}`, output: JSON.stringify(out) };
      },
    }),
    roster_task_claim: tool({
      description: "Atomically claim a pending task. Fails if another seat already holds it or a blocker is open.",
      args: {
        taskId: z.string(),
        seatId: z.string().optional(),
      },
      async execute(args, ctx) {
        const seatId = args.seatId || guessSeat(ctx.agent);
        const out = await fetchApi(`/api/v1/tasks/${args.taskId}/claim`, {
          method: "POST",
          body: JSON.stringify({ seatId }),
        });
        return { title: `claimed ${args.taskId}`, output: JSON.stringify(out) };
      },
    }),
    roster_task_complete: tool({
      description: "Mark a claimed task done. Unblocks tasks that depend_on it.",
      args: {
        taskId: z.string(),
        seatId: z.string().optional(),
      },
      async execute(args, ctx) {
        const seatId = args.seatId || guessSeat(ctx.agent);
        const out = await fetchApi(`/api/v1/tasks/${args.taskId}/complete`, {
          method: "POST",
          body: JSON.stringify({ seatId }),
        });
        return { title: `done ${args.taskId}`, output: JSON.stringify(out) };
      },
    }),
    wikiflow_read_source: tool({
      description:
        "List wiki-flow sources for a repo (GET /api/v1/repos/:owner/:repo/sources -> {sources:[{path,language,bytes}]}). Pass paths to include file content. Needs WIKIFLOW_URL + WIKIFLOW_TOKEN.",
      args: {
        owner: z.string().describe("Repo owner"),
        repo: z.string().describe("Repo name"),
        paths: z.string().optional().describe("Comma-separated source paths to read with content, e.g. src/a.ts,README.md"),
      },
      async execute(args) {
        const paths = String(args.paths || "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        const qs = paths.length ? `?paths=${paths.map(encodeURIComponent).join(",")}` : "";
        const out = await wikiApi(`${repoPath(args.owner, args.repo)}/sources${qs}`);
        return { title: `sources ${args.owner}/${args.repo}`, output: JSON.stringify(out) };
      },
    }),
    wikiflow_search: tool({
      description: "Search wiki-flow sources (GET /api/v1/repos/:owner/:repo/sources/search?q= -> {results:[{path,line,snippet}]}).",
      args: {
        owner: z.string().describe("Repo owner"),
        repo: z.string().describe("Repo name"),
        q: z.string().describe("Search query"),
      },
      async execute(args) {
        if (!args.q) throw new Error("q is required");
        const out = await wikiApi(`${repoPath(args.owner, args.repo)}/sources/search?q=${encodeURIComponent(args.q)}`);
        return { title: `search ${args.q}`, output: JSON.stringify(out) };
      },
    }),
    wikiflow_put_page: tool({
      description:
        "Write a wiki page (PUT /api/v1/repos/:owner/:repo/pages/:slug, body {runId,title,markdown,sources,agent}). runId must be an existing, open wiki-flow run (404 unknown run, 409 run complete).",
      args: {
        owner: z.string().describe("Repo owner"),
        repo: z.string().describe("Repo name"),
        slug: z.string().describe("Page slug"),
        runId: z.string().describe("wiki-flow run id"),
        title: z.string().describe("Page title"),
        markdown: z.string().describe("Page body (Markdown)"),
        sources: z.string().optional().describe('JSON array of cited sources: [{"path":"src/a.ts","startLine":1,"endLine":20}] (startLine/endLine optional, 1-based)'),
        agent: z.string().optional().describe("Authoring agent id. Defaults to the current agent."),
      },
      async execute(args, ctx) {
        for (const k of ["slug", "runId", "title", "markdown"]) if (!args[k]) throw new Error(`${k} is required`);
        const body = {
          runId: args.runId,
          title: args.title,
          markdown: args.markdown,
          sources: parseSources(args.sources),
          agent: args.agent || ctx?.agent || "unknown",
        };
        const out = await wikiApi(`${repoPath(args.owner, args.repo)}/pages/${encodeURIComponent(args.slug)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        return { title: `page ${args.slug}`, output: JSON.stringify(out) };
      },
    }),
  };
}

function parseTokenArg(raw) {
  const text = String(raw).trim();
  if (!text) return undefined;
  if (text.startsWith("{")) return JSON.parse(text);
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error("tokens must be a number or JSON {input, output, total}");
  return n;
}

function parseBlocks(raw) {
  if (!raw) return undefined;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed : parsed?.blocks;
}

function guessSeat(agent) {
  if (!agent) return "channel";
  const a = String(agent).toLowerCase().replace(/[^a-z0-9-]/g, "");
  return a || "channel";
}

const BLOCK_RULES = [
  "You are a Roster-flow seat. Stay in your persona and follow your instructions.",
  "Peers are other OpenCode agents on the same org chart.",
  "Talk through roster_send_message / roster_handoff / roster_report. Do not impersonate peers.",
  "You may attach Roster Block Kit via roster_send_message / roster_report `blocks` (JSON array of header|section|divider|context|image|actions|markdown).",
  "Mail to team:<id> reaches that team's Supervisor. A job addressed to a team says how to route: supervisor, round_robin, or a named specialist.",
  "When a prompt includes a job id, finish with roster_report jobId=<id>. roster_ask_human jobId=<id> parks that job as needs_human.",
  "@channel notifies room members and wakes the Channel conductor.",
  "Claim work with roster_task_claim. A task with an open depend_on blocker cannot be claimed.",
  "ask_human walks reports_to. Channel owns the org run graph. Architect proposes OrgPlan JSON; humans Apply.",
];

function fullRosterLine(s) {
  const bits = [
    `${s.id}: ${s.name} [${s.seatType || "specialist"}]`,
    s.team ? `team=${s.team}` : null,
    s.model ? `model=${s.model}` : null,
    s.persona ? `persona=${s.persona}` : null,
    `job=${s.job}`,
    s.instructions ? `instructions=${s.instructions}` : null,
  ];
  return bits.filter(Boolean).join(" · ");
}

function roomLine(c) {
  return `${c.name} teams=${(c.teamIds || []).join(",") || "—"} seats=${(c.seatIds || []).join(",") || "—"}`;
}

/**
 * The org context injected into every turn. A room session (`bound.kind ===
 * "room"`) gets only that room's members and the caller's team, one line each;
 * DM and unbound sessions get the whole org.
 */
export function systemBlock({ seats = [], teams = [], channels = [], bound = null } = {}) {
  const room = bound?.kind === "room" ? (channels || []).find((c) => c.id === bound.channelId) : null;
  if (!room) {
    const roster = seats.filter((s) => s.kind === "bot").map(fullRosterLine).join("\n");
    return [
      ...BLOCK_RULES,
      `Teams: ${(teams || []).map((t) => t.name).join(", ")}`,
      `Rooms:\n${(channels || []).map(roomLine).join("\n")}`,
      `Roster:\n${roster}`,
    ];
  }
  const me = seats.find((s) => s.id === bound.seatId);
  const teamIds = new Set([...(room.teamIds || []), ...(me?.team ? [me.team] : [])]);
  const ids = new Set(["channel", ...(room.seatIds || [])]);
  for (const t of teams || []) {
    if (teamIds.has(t.id)) for (const id of t.seatIds || []) ids.add(id);
  }
  const people = seats.filter((s) => ids.has(s.id) && s.id !== bound.seatId);
  const line = (s) => `${s.id}: ${s.name}${s.kind === "human" ? " (human)" : ""}${s.team ? ` · team=${s.team}` : ""} — ${s.job || s.role || ""}`.trim();
  return [
    ...BLOCK_RULES,
    `Current room: ${room.name}. Your plain-text replies are posted there.`,
    `Teams here: ${(teams || []).filter((t) => teamIds.has(t.id)).map((t) => t.name).join(", ") || "—"}`,
    `Members of ${room.name} and your team:\n${people.map(line).join("\n")}`,
  ];
}

/** @type {import('@opencode-ai/plugin').Plugin} */
export async function RosterFlowPlugin(_input) {
  let tool;
  try {
    ({ tool } = await import("@opencode-ai/plugin"));
  } catch {
    return {
      async event() {},
    };
  }
  return {
    tool: buildTools(tool),
    async event({ event }) {
      const type = event?.type || event?.name;
      const sessionId = event?.properties?.sessionID || event?.sessionID || event?.sessionId;
      const agent = event?.properties?.agent || event?.agent;
      if (sessionId && agent && String(type || "").includes("session")) {
        try {
          await api(`/api/v1/seats/${guessSeat(agent)}`, {
            method: "PATCH",
            body: JSON.stringify({ lastSession: sessionId }),
          });
        } catch {
          /* CORE optional */
        }
      }
    },
    async "experimental.chat.system.transform"(input, output) {
      try {
        const sessionID = input?.sessionID || input?.sessionId || null;
        const [seats, teams, channels, bound] = await Promise.all([
          api("/api/v1/seats"),
          api("/api/v1/teams"),
          api("/api/v1/channels"),
          sessionID ? api(`/api/v1/sessions/${encodeURIComponent(sessionID)}/room`).catch(() => null) : null,
        ]);
        output.system.push(...systemBlock({ seats, teams, channels, bound }));
      } catch {
        output.system.push("Roster-flow plugin: CORE API unreachable. Continue with local tools only.");
      }
    },
  };
}

const definition = {
  id: "roster-flow-opencode",
  setup: RosterFlowPlugin,
};
export default definition;
export const server = definition;
