/**
 * FundExecs OS — office NPC pathfinding (native A* over the tile grid).
 *
 * Ported in spirit from `the-delegation` (MIT), which drives its 3D-office NPCs
 * with the `three-pathfinding` navmesh library. Rather than pull in a navmesh
 * dependency, this reimplements the same capability natively against the
 * office's existing tile grid: agents compute a walkable route between two
 * points — through doorways, around partition walls — instead of teleporting.
 *
 * It is renderer-agnostic (no Phaser, no Three.js, no DOM): both the 2D Phaser
 * floor and the 3D `ThreeOfficeRenderer` can consume the returned pixel
 * waypoints. Pure and fully unit-testable — reachability between every pair of
 * adjacent rooms is asserted in the test, so the door geometry is provably
 * navigable.
 *
 * Coordinate space is the shared top-down office pixel space (`+x` right, `+y`
 * down), the same one `ROOMS` / walls are defined in.
 *
 * Attribution: concept from https://github.com/arturitu/the-delegation (MIT).
 */

import {
  TILE_SIZE,
  ROOM_W,
  ROOM_H,
  GRID_COLS,
  GRID_ROWS,
  TOTAL_ROWS,
  WORLD_W,
  WORLD_H,
  WALL_THICKNESS,
  DOOR_GAP,
} from "../types";

/** Tile columns/rows spanning the whole world (36 × 36 for the default floor). */
export const TILE_COLS = Math.round(WORLD_W / TILE_SIZE);
export const TILE_ROWS = Math.round(WORLD_H / TILE_SIZE);

export type PixelPoint = { x: number; y: number };
export type Tile = { col: number; row: number };

/** Center pixel of a tile. */
export function tileCenter(col: number, row: number): PixelPoint {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
}

/** The tile containing a pixel point. */
export function pointToTile(x: number, y: number): Tile {
  return { col: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
}

// A tile is blocked when its center falls within this distance of a (non-door)
// wall line — half a tile plus half the wall thickness, so a 32px tile never
// straddles an 8px partition, while the 64px door gap always leaves a lane.
const WALL_BLOCK = TILE_SIZE / 2 + WALL_THICKNESS / 2;
const DOOR_HALF = DOOR_GAP / 2;

/** Whether a pixel point lies inside the open span of a door on a wall line. */
function inHorizontalDoor(x: number): boolean {
  for (let c = 0; c < GRID_COLS; c++) {
    const doorCenter = c * ROOM_W + ROOM_W / 2;
    if (Math.abs(x - doorCenter) <= DOOR_HALF) return true;
  }
  return false;
}
function inVerticalDoor(y: number): boolean {
  for (let r = 0; r < GRID_ROWS; r++) {
    const doorCenter = r * ROOM_H + ROOM_H / 2;
    if (Math.abs(y - doorCenter) <= DOOR_HALF) return true;
  }
  return false;
}

/**
 * Whether a world pixel point is walkable: inside the perimeter, and not on a
 * partition wall except where a doorway opens it. Mirrors the wall loops in
 * `officeEnvironment.createWallVisuals`, so what the renderer draws as a wall is
 * what the pathfinder treats as impassable.
 */
export function isWalkable(x: number, y: number): boolean {
  // Perimeter walls.
  if (x < WALL_BLOCK || x > WORLD_W - WALL_BLOCK) return false;
  if (y < WALL_BLOCK || y > WORLD_H - WALL_BLOCK) return false;

  // Internal horizontal walls (between rows) — door gaps at each column center.
  for (let r = 1; r < TOTAL_ROWS; r++) {
    const wallY = r * ROOM_H;
    if (Math.abs(y - wallY) < WALL_BLOCK && !inHorizontalDoor(x)) return false;
  }

  // Internal vertical walls (between columns) — only across the office grid;
  // the full-width Marketplace hall (last row) has no column dividers.
  if (y < GRID_ROWS * ROOM_H) {
    for (let c = 1; c < GRID_COLS; c++) {
      const wallX = c * ROOM_W;
      if (Math.abs(x - wallX) < WALL_BLOCK && !inVerticalDoor(y)) return false;
    }
  }

  return true;
}

/** The full walkability grid (row-major); `grid[row][col]` is true if walkable. */
export function buildWalkableGrid(): boolean[][] {
  const grid: boolean[][] = [];
  for (let row = 0; row < TILE_ROWS; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < TILE_COLS; col++) {
      const c = tileCenter(col, row);
      line.push(isWalkable(c.x, c.y));
    }
    grid.push(line);
  }
  return grid;
}

function tileWalkable(grid: boolean[][], col: number, row: number): boolean {
  return row >= 0 && row < TILE_ROWS && col >= 0 && col < TILE_COLS && grid[row][col];
}

/** Nearest walkable tile to a point, by expanding-ring search (or null). */
function snapToWalkable(grid: boolean[][], x: number, y: number): Tile | null {
  const start = pointToTile(x, y);
  if (tileWalkable(grid, start.col, start.row)) return start;
  for (let radius = 1; radius <= Math.max(TILE_COLS, TILE_ROWS); radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue; // ring only
        const col = start.col + dc;
        const row = start.row + dr;
        if (tileWalkable(grid, col, row)) return { col, row };
      }
    }
  }
  return null;
}

const KEY = (col: number, row: number) => row * TILE_COLS + col;

/**
 * A* from `start` to `goal` (world pixels), 4-connected over walkable tiles.
 * Returns pixel waypoints (tile centers) from the start tile to the goal tile,
 * or `null` if the goal is unreachable. Endpoints are snapped to the nearest
 * walkable tile, so callers may pass a room-center or a desk seat directly.
 */
export function findPath(start: PixelPoint, goal: PixelPoint, grid = buildWalkableGrid()): PixelPoint[] | null {
  const s = snapToWalkable(grid, start.x, start.y);
  const g = snapToWalkable(grid, goal.x, goal.y);
  if (!s || !g) return null;

  const h = (col: number, row: number) => Math.abs(col - g.col) + Math.abs(row - g.row);
  const open: Array<{ col: number; row: number; f: number; gScore: number }> = [
    { col: s.col, row: s.row, f: h(s.col, s.row), gScore: 0 },
  ];
  const gScore = new Map<number, number>([[KEY(s.col, s.row), 0]]);
  const cameFrom = new Map<number, number>();

  const neighbors = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  while (open.length > 0) {
    // Pop the lowest-f node (small grid → linear scan is fine).
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIdx].f) bestIdx = i;
    const current = open.splice(bestIdx, 1)[0];

    if (current.col === g.col && current.row === g.row) {
      return reconstruct(cameFrom, KEY(g.col, g.row));
    }

    for (const [dc, dr] of neighbors) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      if (!tileWalkable(grid, nc, nr)) continue;
      const tentative = current.gScore + 1;
      const nk = KEY(nc, nr);
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, KEY(current.col, current.row));
        gScore.set(nk, tentative);
        open.push({ col: nc, row: nr, f: tentative + h(nc, nr), gScore: tentative });
      }
    }
  }
  return null;
}

function reconstruct(cameFrom: Map<number, number>, goalKey: number): PixelPoint[] {
  const keys: number[] = [goalKey];
  let cur = goalKey;
  while (cameFrom.has(cur)) {
    cur = cameFrom.get(cur)!;
    keys.push(cur);
  }
  keys.reverse();
  return keys.map((k) => {
    const col = k % TILE_COLS;
    const row = Math.floor(k / TILE_COLS);
    return tileCenter(col, row);
  });
}
