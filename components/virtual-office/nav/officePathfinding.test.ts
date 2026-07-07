import {
  TILE_COLS,
  TILE_ROWS,
  buildWalkableGrid,
  findPath,
  isWalkable,
  pointToTile,
  tileCenter,
  type PixelPoint,
} from "./officePathfinding";
import {
  ROOMS,
  ROOM_W,
  ROOM_H,
  WORLD_W,
  WORLD_H,
  TILE_SIZE,
} from "../types";

const roomCenter = (key: string): PixelPoint => {
  const r = ROOMS.find((x) => x.key === key)!;
  const cols = r.colSpan ?? 1;
  return { x: r.col * ROOM_W + (ROOM_W * cols) / 2, y: r.row * ROOM_H + ROOM_H / 2 };
};

describe("grid + walkability", () => {
  it("has the expected tile dimensions", () => {
    expect(TILE_COLS).toBe(WORLD_W / TILE_SIZE);
    expect(TILE_ROWS).toBe(WORLD_H / TILE_SIZE);
  });

  it("treats room centers as walkable", () => {
    for (const room of ROOMS) {
      const c = roomCenter(room.key);
      expect(isWalkable(c.x, c.y)).toBe(true);
    }
  });

  it("blocks the world perimeter", () => {
    expect(isWalkable(1, WORLD_H / 2)).toBe(false);
    expect(isWalkable(WORLD_W - 1, WORLD_H / 2)).toBe(false);
    expect(isWalkable(WORLD_W / 2, 1)).toBe(false);
  });

  it("blocks a point on an internal wall away from any door", () => {
    // Horizontal wall between row 0 and row 1 is at y = ROOM_H. A point near a
    // room corner (far from the column-center door) must be blocked.
    const nearCorner = { x: 20, y: ROOM_H };
    expect(isWalkable(nearCorner.x, nearCorner.y)).toBe(false);
  });

  it("leaves the doorway on that wall open", () => {
    // Door center on the row-0/row-1 wall, under column 0's center.
    expect(isWalkable(ROOM_W / 2, ROOM_H)).toBe(true);
  });
});

describe("findPath", () => {
  const grid = buildWalkableGrid();

  const assertValidPath = (path: PixelPoint[] | null) => {
    expect(path).not.toBeNull();
    const p = path!;
    expect(p.length).toBeGreaterThan(0);
    // Every waypoint walkable, and consecutive waypoints tile-adjacent.
    for (let i = 0; i < p.length; i++) {
      expect(isWalkable(p[i].x, p[i].y)).toBe(true);
      if (i > 0) {
        const a = pointToTile(p[i - 1].x, p[i - 1].y);
        const b = pointToTile(p[i].x, p[i].y);
        expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row)).toBe(1);
      }
    }
  };

  it("finds a direct path within a single room", () => {
    const c = roomCenter("office");
    const path = findPath({ x: c.x - 40, y: c.y - 20 }, { x: c.x + 40, y: c.y + 20 }, grid);
    assertValidPath(path);
  });

  it("reaches every room from the reception lounge (whole floor connected)", () => {
    const from = roomCenter("reception");
    for (const room of ROOMS) {
      const path = findPath(from, roomCenter(room.key), grid);
      expect(path).not.toBeNull();
      assertValidPath(path);
    }
  });

  it("connects every pair of grid-adjacent rooms through their shared door", () => {
    // Adjacency in the 3-column office grid: right neighbor and down neighbor.
    const byCell = new Map(ROOMS.map((r) => [`${r.col},${r.row}`, r.key]));
    for (const r of ROOMS) {
      for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
        const neighbor = byCell.get(`${r.col + dc},${r.row + dr}`);
        if (!neighbor) continue;
        const path = findPath(roomCenter(r.key), roomCenter(neighbor), grid);
        assertValidPath(path);
      }
    }
  });

  it("snaps unwalkable endpoints (e.g. inside a wall) to reach a goal", () => {
    const path = findPath({ x: 2, y: 2 }, roomCenter("ceo"), grid);
    assertValidPath(path);
  });

  it("starts and ends near the requested points", () => {
    const start = roomCenter("trading");
    const goal = roomCenter("legal");
    const path = findPath(start, goal, grid)!;
    const near = (a: PixelPoint, b: PixelPoint) => Math.hypot(a.x - b.x, a.y - b.y);
    expect(near(path[0], start)).toBeLessThan(TILE_SIZE * 2);
    expect(near(path[path.length - 1], goal)).toBeLessThan(TILE_SIZE * 2);
  });
});

describe("tile helpers", () => {
  it("round-trips a tile center through pointToTile", () => {
    const t = pointToTile(tileCenter(5, 7).x, tileCenter(5, 7).y);
    expect(t).toEqual({ col: 5, row: 7 });
  });
});
