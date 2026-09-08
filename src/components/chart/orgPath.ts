import type { TreeLinkDatum } from "react-d3-tree";

/** Layout cell. Cards are ~168×108; extra room is the gutter for elbows. */
export const ORG_NODE_SIZE = { x: 250, y: 200 };
export const ORG_SEPARATION = { siblings: 1.22, nonSiblings: 1.5 };

/** Drop past the card before traveling sideways so links do not slice siblings. */
const PARENT_EXIT = 104;
const CHILD_ENTER = 8;
const GUTTER = 142;

export function orgStepPath(link: TreeLinkDatum, orientation: string) {
  const { source, target } = link;
  if (orientation === "horizontal") {
    const sx = source.y;
    const sy = source.x;
    const tx = target.y;
    const ty = target.x;
    const mid = sx + GUTTER;
    return `M ${sx} ${sy} H ${mid} V ${ty} H ${tx}`;
  }
  const sx = source.x;
  const sy = source.y;
  const tx = target.x;
  const ty = target.y;
  const parentOut = sy + PARENT_EXIT;
  const childIn = ty - CHILD_ENTER;
  const gutter = Math.min(Math.max(sy + GUTTER, parentOut + 8), childIn - 8);
  return `M ${sx} ${parentOut} V ${gutter} H ${tx} V ${childIn}`;
}
