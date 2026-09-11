/**
 * Roster-flow CORE plugin for OpenCode.
 * Same shape as Oh My OpenAgent: default Plugin export, tools + hooks.
 * Tools POST to the CORE bus so Room / Chart stay the source of truth.
 */

const API = process.env.ROSTER_API || "http://127.0.0.1:8790";

async function api(path, init = {}) {
  const headers = { ...(init.headers || {}) };
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

export function buildTools(tool, fetchApi = api) {
  const z = tool.schema;
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
        blocks: z.string().optional().describe("Optional Roster Block Kit JSON array"),
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        const blocks = parseBlocks(args.blocks);
        const entry = await fetchApi("/api/v1/messages", {
          method: "POST",
          body: JSON.stringify({ to: args.to, text: args.text, from, wake: true, blocks }),
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
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        const entry = await fetchApi("/api/v1/bus/send", {
          method: "POST",
          body: JSON.stringify({ from, to: args.to, kind: "handoff", text: args.text, wake: true }),
        });
        return { title: `handoff → ${args.to}`, output: JSON.stringify(entry) };
      },
    }),
    roster_report: tool({
      description: "Post a structured result back to the originating Room thread. Optional blocks is Roster Block Kit JSON.",
      args: {
        text: z.string(),
        channel: z.string().optional(),
        from: z.string().optional(),
        blocks: z.string().optional().describe("Optional Roster Block Kit JSON array"),
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        const channel = args.channel || "ship";
        const blocks = parseBlocks(args.blocks);
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
          }),
        });
        return { title: "report", output: JSON.stringify(entry) };
      },
    }),
    roster_ask_human: tool({
      description: "Park the run on your reports_to human. Never dump into #general.",
      args: {
        text: z.string(),
        from: z.string().optional(),
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        const seats = await fetchApi("/api/v1/seats");
        const me = seats.find((s) => s.id === from);
        const manager = me?.reportsTo || "you";
        const entry = await fetchApi("/api/v1/bus/send", {
          method: "POST",
          body: JSON.stringify({ from, to: manager, kind: "ask_human", text: args.text, wake: false }),
        });
        return { title: `ask ${manager}`, output: JSON.stringify(entry) };
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
  };
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
    async "experimental.chat.system.transform"(_input, output) {
      try {
        const [seats, teams, channels] = await Promise.all([
          api("/api/v1/seats"),
          api("/api/v1/teams"),
          api("/api/v1/channels"),
        ]);
        const roster = seats
          .filter((s) => s.kind === "bot")
          .map((s) => {
            const bits = [
              `${s.id}: ${s.name} [${s.seatType || "specialist"}]`,
              s.team ? `team=${s.team}` : null,
              s.model ? `model=${s.model}` : null,
              s.persona ? `persona=${s.persona}` : null,
              `job=${s.job}`,
              s.instructions ? `instructions=${s.instructions}` : null,
            ];
            return bits.filter(Boolean).join(" · ");
          })
          .join("\n");
        const rooms = (channels || [])
          .map((c) => `${c.name} teams=${(c.teamIds || []).join(",") || "—"} seats=${(c.seatIds || []).join(",") || "—"}`)
          .join("\n");
        output.system.push(
          "You are a Roster-flow seat. Stay in your persona and follow your instructions.",
          "Peers are other OpenCode agents on the same org chart.",
          "Talk through roster_send_message / roster_handoff / roster_report. Do not impersonate peers.",
          "You may attach Roster Block Kit via roster_send_message / roster_report `blocks` (JSON array of header|section|divider|context|image|actions|markdown).",
          "Mail to team:<id> reaches that team's Supervisor. @channel notifies room members and wakes the Channel conductor.",
          "Claim work with roster_task_claim. A task with an open depend_on blocker cannot be claimed.",
          "ask_human walks reports_to. Channel owns the org run graph. Architect proposes OrgPlan JSON; humans Apply.",
          `Teams: ${(teams || []).map((t) => t.name).join(", ")}`,
          `Rooms:\n${rooms}`,
          `Roster:\n${roster}`,
        );
      } catch {
        output.system.push("Roster-flow plugin: CORE API unreachable. Continue with local tools only.");
      }
    },
  };
}

export default RosterFlowPlugin;
export const server = RosterFlowPlugin;
