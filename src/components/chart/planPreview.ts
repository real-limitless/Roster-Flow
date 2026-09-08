import { slugify, type Project, type Seat, type Team } from "../../data";

export type OrgPlanOp = {
  op: string;
  name?: string;
  id?: string;
  seatId?: string;
  projectId?: string;
  team?: string;
  kind?: "human" | "bot";
  role?: string;
  job?: string;
  reportsTo?: string;
  reason?: string;
  asPm?: boolean;
  persona?: string;
  instructions?: string;
  knowledge?: string;
  skills?: string[];
  [key: string]: unknown;
};

export type OrgPlan = {
  id: string;
  summary: string;
  rationale: string[];
  reply?: string;
  status?: string;
  source?: string;
  ops: OrgPlanOp[];
};

export type ChartPreview = {
  replace: boolean;
  fireIds: string[];
  ghosts: Seat[];
  ghostProjects: Project[];
  ghostTeams: Team[];
};

export function previewFromPlan(plan: OrgPlan | null, roster: Seat[]): ChartPreview {
  if (!plan || plan.status === "applied") return { replace: false, fireIds: [], ghosts: [], ghostProjects: [], ghostTeams: [] };
  const replace = plan.ops.some((o) => o.op === "replace_org");
  const fireIds = replace
    ? roster.filter((s) => s.id !== "you" && !s.system).map((s) => s.id)
    : plan.ops.filter((o) => o.op === "fire" && o.seatId).map((o) => String(o.seatId));
  const ghosts: Seat[] = [];
  const ghostProjects: Project[] = [];
  const ghostTeams: Team[] = [];
  for (const op of plan.ops) {
    if (op.op === "create_project" && op.name) {
      const id = slugify(String(op.id || op.name));
      ghostProjects.push({
        id,
        orgId: "roster-flow",
        name: String(op.name),
        brief: String(op.brief || ""),
        constitution: op.constitution ? String(op.constitution) : undefined,
        teamIds: [],
      });
    }
    if (op.op === "create_team" && op.name) {
      const id = slugify(String(op.id || op.name));
      ghostTeams.push({
        id,
        name: String(op.name).startsWith("@") ? String(op.name) : `@${op.name}`,
        staffed: true,
        projectId: op.projectId ? String(op.projectId) : undefined,
        supervisorSeatId: `${id}-supervisor`,
        genericSeatId: `${id}-generic`,
        seatIds: [`${id}-supervisor`, `${id}-generic`],
      });
      ghosts.push(ghostSeat(`${id}-supervisor`, `${op.name} Supervisor`, "Supervisor", op.projectId, `${id}`));
      ghosts.push(ghostSeat(`${id}-generic`, `${op.name} Generic`, "Generic", op.projectId, `${id}`));
    }
    if (op.op === "hire" && op.name) {
      const id = slugify(String(op.id || op.name));
      if (roster.some((s) => s.id === id) || ghosts.some((s) => s.id === id)) continue;
      ghosts.push(ghostSeat(id, String(op.name), String(op.role || "Specialist"), op.projectId, op.team));
    }
  }
  return { replace, fireIds, ghosts, ghostProjects, ghostTeams };
}

function ghostSeat(id: string, name: string, role: string, projectId?: unknown, team?: unknown): Seat {
  return {
    id,
    name,
    role,
    kind: "bot",
    seatType: "specialist",
    projectId: projectId ? String(projectId) : undefined,
    team: team ? String(team) : undefined,
    tools: ["read"],
    deny: ["deploy"],
    job: "Proposed seat",
    status: "idle",
    preview: "hire",
  };
}
