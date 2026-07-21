import { ROOMS, ROOM_BY_KEY, OFFICE_COLS, OFFICE_ROWS, SPAWN } from "./layout";
import {
  buildWalls,
  doorwayFor,
  doorwaysForRoom,
  resolveMovement,
  roomTheme,
  type Wall,
} from "./walls";

/** Is a point inside a wall rectangle? */
function insideWall(x: number, y: number, w: Wall): boolean {
  return x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h;
}

describe("doorways", () => {
  it("gives every room at least one doorway on one of its edges", () => {
    for (const room of ROOMS) {
      const doors = doorwaysForRoom(room, ROOMS);
      expect(doors.length).toBeGreaterThanOrEqual(1);
      for (const door of doors) {
        expect(door.roomKey).toBe(room.key);
        // The opening spans ~2 tiles along the edge (the long dimension).
        expect(Math.max(door.w, door.h)).toBeGreaterThanOrEqual(1.9);
        // The doorway's center lies on one of the room's four edge lines.
        const cx = door.x + door.w / 2;
        const cy = door.y + door.h / 2;
        const onVertical =
          Math.abs(cx - room.x) < 0.01 || Math.abs(cx - (room.x + room.w)) < 0.01;
        const onHorizontal =
          Math.abs(cy - room.y) < 0.01 || Math.abs(cy - (room.y + room.h)) < 0.01;
        expect(onVertical || onHorizontal).toBe(true);
      }
    }
  });

  it("opens hub doors toward the central corridor", () => {
    // Build sits in the left band → its primary door faces the right corridor.
    const build = doorwayFor(ROOM_BY_KEY.build, ROOMS);
    expect(build.x + build.w / 2).toBeCloseTo(ROOM_BY_KEY.build.x + ROOM_BY_KEY.build.w);
    // Source sits in the right band → its primary door faces the left corridor.
    const source = doorwayFor(ROOM_BY_KEY.source, ROOMS);
    expect(source.x + source.w / 2).toBeCloseTo(ROOM_BY_KEY.source.x);
  });

  it("falls back to a single door when a room faces no corridor", () => {
    // A lone room filling most of the floor has every edge on the border margin.
    const solo = { ...ROOM_BY_KEY.commons, x: 1, y: 1, w: OFFICE_COLS - 2, h: OFFICE_ROWS - 2 };
    const doors = doorwaysForRoom(solo, [solo]);
    expect(doors).toHaveLength(1);
  });
});

describe("walls exclude the doorway span", () => {
  it("has no wall covering the center of any doorway", () => {
    const { walls, doorways } = buildWalls(ROOMS);
    for (const door of doorways) {
      const cx = door.x + door.w / 2;
      const cy = door.y + door.h / 2;
      const blocked = walls.some((w) => insideWall(cx, cy, w));
      expect(blocked).toBe(false);
    }
  });

  it("still walls off the solid part of a doored edge", () => {
    const { walls } = buildWalls(ROOMS);
    const build = ROOM_BY_KEY.build;
    // Build's right edge, near the top corner (away from the centered door), is solid.
    const solidPoint = walls.some((w) => insideWall(build.x + build.w, build.y + 1, w));
    expect(solidPoint).toBe(true);
  });
});

describe("resolveMovement", () => {
  // A single vertical wall at x ~= 5, spanning y 0..10.
  const vwall: Wall[] = [{ x: 5, y: 0, w: 0.3, h: 10 }];

  it("moves freely in open space", () => {
    const out = resolveMovement({ x: 1, y: 1 }, { x: 2, y: 3 }, []);
    expect(out).toEqual({ x: 2, y: 3 });
  });

  it("blocks crossing a solid wall", () => {
    const out = resolveMovement({ x: 4, y: 5 }, { x: 6, y: 5 }, vwall, 0.3);
    expect(out.x).toBeLessThan(5);
    expect(out.x).toBeCloseTo(4.7);
  });

  it("does not tunnel through a thin wall at speed", () => {
    const out = resolveMovement({ x: 1, y: 5 }, { x: 20, y: 5 }, vwall, 0.3);
    expect(out.x).toBeLessThan(5);
  });

  it("slides along a wall, blocking only the crossing axis", () => {
    const out = resolveMovement({ x: 4, y: 5 }, { x: 6, y: 8 }, vwall, 0.3);
    expect(out.x).toBeLessThan(5);
    expect(out.y).toBeCloseTo(8);
  });

  it("passes through a doorway gap", () => {
    const { walls } = buildWalls(ROOMS);
    const build = ROOM_BY_KEY.build;
    const door = doorwayFor(build, ROOMS);
    const cy = door.y + door.h / 2;
    // Travel from inside Build, across the door on its right edge, into the corridor.
    const out = resolveMovement(
      { x: build.x + build.w - 1, y: cy },
      { x: build.x + build.w + 1, y: cy },
      walls,
      0.3,
    );
    expect(out.x).toBeCloseTo(build.x + build.w + 1);
    expect(out.y).toBeCloseTo(cy);
  });
});

describe("reachability", () => {
  // Flood-fill the walkable floor from the spawn point and confirm every room's
  // interior is reachable — the strong guarantee that every doorway connects.
  it("can reach every room's interior from the spawn point", () => {
    const { walls } = buildWalls(ROOMS);
    const step = 0.5;
    const R = 0.3;
    const EPS = 1e-3;
    const k = (x: number, y: number): string => `${Math.round(x * 2)},${Math.round(y * 2)}`;

    const start = { x: SPAWN.x, y: SPAWN.y };
    const visited = new Set<string>([k(start.x, start.y)]);
    const queue: { x: number; y: number }[] = [start];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const neighbors = [
        { x: cur.x + step, y: cur.y },
        { x: cur.x - step, y: cur.y },
        { x: cur.x, y: cur.y + step },
        { x: cur.x, y: cur.y - step },
      ];
      for (const n of neighbors) {
        if (n.x < 0.5 || n.x > OFFICE_COLS - 0.5 || n.y < 0.5 || n.y > OFFICE_ROWS - 0.5) {
          continue;
        }
        const key = k(n.x, n.y);
        if (visited.has(key)) continue;
        const out = resolveMovement(cur, n, walls, R);
        // The step is passable only if it arrives at (not short of) the target.
        if (Math.abs(out.x - n.x) < EPS && Math.abs(out.y - n.y) < EPS) {
          visited.add(key);
          queue.push(n);
        }
      }
    }

    for (const room of ROOMS) {
      const reached = [...visited].some((key) => {
        const [px, py] = key.split(",").map((v) => Number(v) / 2);
        return (
          px > room.x + 0.5 &&
          px < room.x + room.w - 0.5 &&
          py > room.y + 0.5 &&
          py < room.y + room.h - 0.5
        );
      });
      expect(reached).toBe(true);
    }
  });
});

describe("roomTheme", () => {
  const styles = ["grid", "wood", "carpet", "tile", "marble"];

  it("is deterministic and valid for every built-in room", () => {
    for (const room of ROOMS) {
      const a = roomTheme(room);
      const b = roomTheme(room);
      expect(a).toEqual(b);
      expect(styles).toContain(a.floor);
      expect(a.wall).toMatch(/^#[0-9a-f]{6}$/);
      expect(typeof a.rug).toBe("boolean");
    }
  });

  it("themes the Commons as marble with a rug", () => {
    const theme = roomTheme(ROOM_BY_KEY.commons);
    expect(theme.floor).toBe("marble");
    expect(theme.rug).toBe(true);
  });

  it("themes the new premium zones", () => {
    expect(roomTheme(ROOM_BY_KEY.reception).floor).toBe("marble");
    expect(roomTheme(ROOM_BY_KEY.reception).rug).toBe(true);
    expect(roomTheme(ROOM_BY_KEY.lounge).rug).toBe(true);
    expect(roomTheme(ROOM_BY_KEY.cafe).floor).toBe("tile");
    expect(roomTheme(ROOM_BY_KEY["pod-1"]).floor).toBe("wood");
  });

  it("gives each hub a distinct floor", () => {
    const hubFloors = ["build", "source", "run", "execute"].map(
      (key) => roomTheme(ROOM_BY_KEY[key]).floor,
    );
    expect(new Set(hubFloors).size).toBe(4);
  });

  it("derives the wall color as a darker shade of the accent", () => {
    const theme = roomTheme(ROOM_BY_KEY.build);
    expect(theme.wall).not.toBe(ROOM_BY_KEY.build.accent);
    expect(theme.wall).toMatch(/^#[0-9a-f]{6}$/);
  });
});
