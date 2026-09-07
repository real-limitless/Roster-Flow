/**
 * Roster-flow CORE plugin for OpenCode.
 * Same shape as Oh My OpenAgent: default Plugin export, tools + hooks.
 * Tools POST to the CORE bus so Room / Chart stay the source of truth.
 */

const API = process.env.ROSTER_API || "http://127.0.0.1:8787";

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

function tools(tool) {
  const z = tool.schema;
  return {
    roster_list_seats: tool({
      description: "List Roster-flow org-chart seats (humans and OpenCode bots) and teams.",
      args: {},
      async execute() {
        const [seats, teams] = await Promise.all([api("/api/v1/seats"), api("/api/v1/teams")]);
        return { title: "Roster", output: JSON.stringify({ seats, teams }, null, 2) };
      },
    }),
    roster_send_message: tool({
      description: "Send a message to a seat id, team:eng, or channel:ship on the audited bus.",
      args: {
        to: z.string().describe("Seat id, team:<id>, or channel:<id>"),
        text: z.string().describe("Message body"),
        from: z.string().optional().describe("Your seat id if known"),
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        const entry = await api("/api/v1/messages", {
          method: "POST",
          body: JSON.stringify({ to: args.to, text: args.text, from, wake: true }),
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
        const entry = await api("/api/v1/bus/send", {
          method: "POST",
          body: JSON.stringify({ from, to: args.to, kind: "handoff", text: args.text, wake: true }),
        });
        return { title: `handoff → ${args.to}`, output: JSON.stringify(entry) };
      },
    }),
    roster_report: tool({
      description: "Post a structured result back to the originating Room thread.",
      args: {
        text: z.string(),
        channel: z.string().optional(),
        from: z.string().optional(),
      },
      async execute(args, ctx) {
        const from = args.from || guessSeat(ctx.agent);
        const channel = args.channel || "ship";
        const entry = await api("/api/v1/bus/send", {
          method: "POST",
          body: JSON.stringify({
            from,
            to: `channel:${channel}`,
            kind: "report",
            text: args.text,
            channel,
            wake: false,
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
        const seats = await api("/api/v1/seats");
        const me = seats.find((s) => s.id === from);
        const manager = me?.reportsTo || "you";
        const entry = await api("/api/v1/bus/send", {
          method: "POST",
          body: JSON.stringify({ from, to: manager, kind: "ask_human", text: args.text, wake: false }),
        });
        return { title: `ask ${manager}`, output: JSON.stringify(entry) };
      },
    }),
  };
}

function guessSeat(agent) {
  if (!agent) return "floor";
  const a = String(agent).toLowerCase();
  if (a.includes("product")) return "product";
  if (a.includes("build")) return "build";
  if (a.includes("review")) return "review";
  if (a.includes("devops")) return "devops";
  if (a.includes("qa")) return "qa";
  if (a.includes("scout")) return "scout";
  if (a.includes("floor") || a.includes("conductor")) return "floor";
  return a.replace(/[^a-z0-9-]/g, "") || "floor";
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
    tool: tools(tool),
    async event({ event }) {
      const type = event?.type || event?.name;
      if (type && String(type).includes("session")) {
        /* seat ↔ session binding happens on the CORE API attach/wake path */
      }
    },
    async "experimental.chat.system.transform"(_input, output) {
      try {
        const seats = await api("/api/v1/seats");
        const roster = seats
          .filter((s) => s.kind === "bot")
          .map((s) => `${s.id}: ${s.name} — ${s.job}`)
          .join("\n");
        output.system.push(
          "You are a Roster-flow seat. Peers are other OpenCode agents on the same org chart.",
          "Talk through roster_send_message / roster_handoff / roster_report. Do not impersonate peers.",
          "ask_human walks reports_to. Floor owns the run graph.",
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
