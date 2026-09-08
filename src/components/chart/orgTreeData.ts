import { displayParentId, type Project, type Seat, type Team } from "../../data";
import type { ChartPreview } from "./planPreview";
import type { RawNodeDatum } from "react-d3-tree";

export type TreeKind = "seat" | "project" | "team";

export type OrgTreeNode = {
  id: string;
  name: string;
  kind: TreeKind;
  seat?: Seat;
  project?: Project;
  team?: Team;
  fire?: boolean;
  children: OrgTreeNode[];
};

export function chartCollections(
  roster: Seat[],
  teams: Team[],
  projects: Project[],
  preview: ChartPreview | undefined,
  showSystem: boolean,
) {
  const ghosts = preview?.ghosts || [];
  const replacing = Boolean(preview?.replace);
  const fireIds = new Set(preview?.fireIds || []);
  const allRoster = [...roster, ...ghosts.filter((g) => !roster.some((s) => s.id === g.id))];
  const visible = allRoster.filter((s) => {
    if (!showSystem && s.system) return false;
    if (replacing && fireIds.has(s.id)) return false;
    return true;
  });
  const staffed = [...(replacing ? [] : teams), ...(preview?.ghostTeams || [])].filter((t) => t.staffed !== false);
  const projectList = [
    ...(replacing ? [] : projects),
    ...(preview?.ghostProjects || []).filter((p) => replacing || !projects.some((x) => x.id === p.id)),
  ];
  return { allRoster, visible, staffed, projectList, fireIds };
}

function seatNode(seat: Seat, fire: boolean, children: OrgTreeNode[] = []): OrgTreeNode {
  return { id: seat.id, name: seat.name, kind: "seat", seat, fire, children };
}

function kidsOf(id: string, pool: Seat[], allRoster: Seat[], showSystem: boolean) {
  return pool.filter((s) => displayParentId(s, allRoster, showSystem) === id);
}

function teamSubtree(team: Team, visible: Seat[], allRoster: Seat[], showSystem: boolean, fireIds: Set<string>): OrgTreeNode {
  const members = visible.filter((s) => (team.seatIds || []).includes(s.id));
  const supervisor = members.find((s) => s.id === team.supervisorSeatId);
  const rest = members.filter((s) => s.id !== team.supervisorSeatId);

  function walk(root: Seat, pool: Seat[]): OrgTreeNode {
    const children = kidsOf(root.id, pool, allRoster, showSystem).map((c) => walk(c, pool));
    return seatNode(root, fireIds.has(root.id), children);
  }

  const children: OrgTreeNode[] = [];
  const inTree = new Set<string>();
  function mark(n: OrgTreeNode) {
    inTree.add(n.id);
    n.children.forEach(mark);
  }
  if (supervisor) {
    const node = walk(supervisor, members);
    mark(node);
    children.push(node);
  }
  const leftoverRoots = (supervisor ? rest : rest.filter((s) => !rest.some((p) => p.id === s.reportsTo))).filter(
    (s) => !inTree.has(s.id),
  );
  for (const r of leftoverRoots) {
    const node = walk(r, members);
    mark(node);
    children.push(node);
  }
  for (const s of members.filter((m) => !inTree.has(m.id))) {
    children.push(seatNode(s, fireIds.has(s.id)));
  }
  return {
    id: `team:${team.id}`,
    name: team.name,
    kind: "team",
    team,
    children,
  };
}

function projectSubtree(
  project: Project,
  staffed: Team[],
  visible: Seat[],
  allRoster: Seat[],
  showSystem: boolean,
  fireIds: Set<string>,
): OrgTreeNode {
  const projectTeams = staffed.filter((t) => t.projectId === project.id || (project.teamIds || []).includes(t.id));
  const teamed = new Set(projectTeams.flatMap((t) => t.seatIds || []));
  const loose = visible.filter((s) => s.projectId === project.id && !teamed.has(s.id));
  const pm = loose.find((s) => s.id === project.pmSeatId) || loose.find((s) => /pm|product|brief/i.test(`${s.role} ${s.name}`));
  const restLoose = loose.filter((s) => s.id !== pm?.id);
  const children: OrgTreeNode[] = [];
  if (pm) children.push(seatNode(pm, fireIds.has(pm.id)));
  for (const s of restLoose) children.push(seatNode(s, fireIds.has(s.id)));
  for (const team of projectTeams) children.push(teamSubtree(team, visible, allRoster, showSystem, fireIds));
  return {
    id: `project:${project.id}`,
    name: project.name,
    kind: "project",
    project,
    children,
  };
}

export function buildOrgTree(
  roster: Seat[],
  teams: Team[] = [],
  projects: Project[] = [],
  preview: ChartPreview | undefined,
  showSystem: boolean,
): OrgTreeNode {
  const { allRoster, visible, staffed, projectList, fireIds } = chartCollections(roster, teams, projects, preview, showSystem);
  const teamedIds = new Set(staffed.flatMap((t) => t.seatIds || []));
  const projectTeamIds = new Set(
    projectList.flatMap((p) => [...(p.teamIds || []), ...staffed.filter((t) => t.projectId === p.id).map((t) => t.id)]),
  );
  const sharedTeams = staffed.filter((t) => !t.projectId && !projectTeamIds.has(t.id));
  const treeSeats = visible.filter((s) => !teamedIds.has(s.id) && !s.projectId);

  function reportingTree(seat: Seat): OrgTreeNode {
    const children = kidsOf(seat.id, treeSeats, allRoster, showSystem).map(reportingTree);
    return seatNode(seat, fireIds.has(seat.id), children);
  }

  const roots = treeSeats.filter((s) => {
    const p = displayParentId(s, allRoster, showSystem);
    return !p || !treeSeats.some((x) => x.id === p);
  });
  const you = roots.find((s) => s.id === "you") || treeSeats.find((s) => s.id === "you");
  const otherRoots = roots.filter((s) => s.id !== you?.id);

  const extra: OrgTreeNode[] = [
    ...projectList.map((p) => projectSubtree(p, staffed, visible, allRoster, showSystem, fireIds)),
    ...sharedTeams.map((t) => teamSubtree(t, visible, allRoster, showSystem, fireIds)),
    ...otherRoots.map(reportingTree),
  ];

  function projectAnchor(project: Project): string {
    const pm = visible.find((s) => s.id === project.pmSeatId);
    const manager = pm ? displayParentId(pm, allRoster, showSystem) : undefined;
    if (manager && treeSeats.some((s) => s.id === manager)) return manager;
    return you?.id || "you";
  }

  function attach(root: OrgTreeNode, parentId: string, child: OrgTreeNode): boolean {
    if (root.id === parentId) {
      root.children.push(child);
      return true;
    }
    return root.children.some((c) => attach(c, parentId, child));
  }

  if (you) {
    const node = reportingTree(you);
    for (const project of projectList) {
      const branch = projectSubtree(project, staffed, visible, allRoster, showSystem, fireIds);
      if (!attach(node, projectAnchor(project), branch)) node.children.push(branch);
    }
    for (const team of sharedTeams) {
      node.children.push(teamSubtree(team, visible, allRoster, showSystem, fireIds));
    }
    for (const r of otherRoots) node.children.push(reportingTree(r));
    return node;
  }
  return {
    id: "org",
    name: "Roster-flow",
    kind: "seat",
    children: extra,
  };
}

export function toRawNodeDatum(node: OrgTreeNode, collapsedIds: Set<string>): RawNodeDatum {
  const hasChildren = node.children.length > 0;
  const collapsed = collapsedIds.has(node.id);
  return {
    name: node.name,
    attributes: {
      id: node.id,
      kind: node.kind,
      hasChildren,
      collapsed,
    },
    children: hasChildren && !collapsed ? node.children.map((c) => toRawNodeDatum(c, collapsedIds)) : undefined,
  };
}

export function collectExpandableIds(node: OrgTreeNode, out: string[] = []): string[] {
  if (node.children.length) out.push(node.id);
  for (const c of node.children) collectExpandableIds(c, out);
  return out;
}
