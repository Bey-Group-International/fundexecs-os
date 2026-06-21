// A* over the tile grid. Small grid (~1200 cells) so a plain array open-set is
// more than fast enough and keeps the dependency surface at zero.

import type { Cell } from "./types";

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: number; // index key of parent, -1 for start
}

const NEIGHBORS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/**
 * Returns the path from `start` to `goal` as cells AFTER the start (goal last).
 * Empty array if unreachable. If the goal itself is blocked, routes to the
 * nearest walkable neighbor of the goal instead (so a desk feature can be the
 * nominal target while the avatar stops on the adjacent stand cell).
 */
export function findPath(walkable: boolean[][], start: Cell, goal: Cell): Cell[] {
  const rows = walkable.length;
  const cols = walkable[0]?.length ?? 0;
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  const key = (x: number, y: number) => y * cols + x;

  let target = goal;
  if (!inBounds(goal.x, goal.y) || !walkable[goal.y][goal.x]) {
    let best: Cell | null = null;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = goal.x + dx;
      const ny = goal.y + dy;
      if (inBounds(nx, ny) && walkable[ny][nx]) {
        best = { x: nx, y: ny };
        break;
      }
    }
    if (!best) return [];
    target = best;
  }

  const h = (x: number, y: number) => Math.abs(x - target.x) + Math.abs(y - target.y);
  const open: Node[] = [{ x: start.x, y: start.y, g: 0, f: h(start.x, start.y), parent: -1 }];
  const nodes = new Map<number, Node>();
  nodes.set(key(start.x, start.y), open[0]);
  const closed = new Set<number>();

  while (open.length) {
    // Pop the lowest-f node.
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (cur.x === target.x && cur.y === target.y) {
      const path: Cell[] = [];
      let node: Node | undefined = cur;
      while (node && node.parent !== -1) {
        path.push({ x: node.x, y: node.y });
        node = nodes.get(node.parent);
      }
      path.reverse();
      return path;
    }

    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBounds(nx, ny) || !walkable[ny][nx]) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const g = cur.g + 1;
      const existing = nodes.get(nk);
      if (existing && g >= existing.g) continue;
      const node: Node = { x: nx, y: ny, g, f: g + h(nx, ny), parent: ck };
      nodes.set(nk, node);
      open.push(node);
    }
  }
  return [];
}
