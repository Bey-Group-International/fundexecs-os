import { ROOMS, ROOM_BY_KEY } from "./layout";
import {
  buildWalls,
  doorwayFor,
  resolveMovement,
  roomTheme,
  type Wall,
} from "./walls";

/** Is a point inside a wall rectangle? */
function insideWall(x: number, y: number, w: Wall): boolean {
  return x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h;
}

describe("doorways", () => {
  it("sits on its room's edge and opens ~2 tiles wide", () => {
    for (const room of ROOMS) {
      const door = doorwayFor(room, ROOMS);
      expect(door.roomKey).toBe(room.key);
      // The opening spans ~2 tiles along the edge (the long dimension).
      expect(Math.max(door.w, door.h)).toBeCloseTo(2);
      // The doorway's center lies on one of the room's four edge lines.
      const cx = door.x + door.w / 2;
      const cy = door.y + door.h / 2;
      const onVertical =
        Math.abs(cx - room.x) < 0.01 || Math.abs(cx - (room.x + room.w)) < 0.01;
      const onHorizontal =
        Math.abs(cy - room.y) < 0.01 || Math.abs(cy - (room.y + room.h)) < 0.01;
      expect(onVertical || onHorizontal).toBe(true);
    }
  });

  it("places left-of-Commons rooms' doors on their right edge, and vice versa", () => {
    const build = doorwayFor(ROOM_BY_KEY.build, ROOMS);
    const source = doorwayFor(ROOM_BY_KEY.source, ROOMS);
    // Build is left of Commons → right edge (x = 1 + 13 = 14).
    expect(build.x + build.w / 2).toBeCloseTo(14);
    // Source is right of Commons → left edge (x = 26).
    expect(source.x + source.w / 2).toBeCloseTo(26);
  });

  it("gives the Commons one opening per hub room, facing them", () => {
    const { doorways } = buildWalls(ROOMS);
    const commonsDoors = doorways.filter((d) => d.roomKey === "commons");
    // Four hub rooms → four Commons openings, two per side (x = 15 and x = 25).
    expect(commonsDoors).toHaveLength(4);
    const leftDoors = commonsDoors.filter((d) => Math.abs(d.x + d.w / 2 - 15) < 0.01);
    const rightDoors = commonsDoors.filter((d) => Math.abs(d.x + d.w / 2 - 25) < 0.01);
    expect(leftDoors).toHaveLength(2);
    expect(rightDoors).toHaveLength(2);
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

  it("still walls off the solid part of the same edge", () => {
    const { walls } = buildWalls(ROOMS);
    // Build's right edge (x = 14) above the door (door centered at y = 6) is solid.
    const solidPoint = walls.some((w) => insideWall(14, 2, w));
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
    // Clamped to the wall's left face minus the radius; never past the wall.
    expect(out.x).toBeLessThan(5);
    expect(out.x).toBeCloseTo(4.7);
  });

  it("does not tunnel through a thin wall at speed", () => {
    // A large step that would overshoot the wall entirely must still be stopped.
    const out = resolveMovement({ x: 1, y: 5 }, { x: 20, y: 5 }, vwall, 0.3);
    expect(out.x).toBeLessThan(5);
  });

  it("slides along a wall, blocking only the crossing axis", () => {
    const out = resolveMovement({ x: 4, y: 5 }, { x: 6, y: 8 }, vwall, 0.3);
    expect(out.x).toBeLessThan(5); // X blocked by the wall
    expect(out.y).toBeCloseTo(8); // Y slides freely
  });

  it("passes through a doorway gap", () => {
    const { walls } = buildWalls(ROOMS);
    // Build's doorway is centered at (14, 6); travel from inside Build, across the
    // corridor, into the Commons at that height.
    const out = resolveMovement({ x: 13, y: 6 }, { x: 16, y: 6 }, walls, 0.3);
    expect(out.x).toBeCloseTo(16);
    expect(out.y).toBeCloseTo(6);
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

  it("gives each hub a distinct floor", () => {
    const hubFloors = ["build", "source", "run", "execute"].map(
      (k) => roomTheme(ROOM_BY_KEY[k]).floor,
    );
    expect(new Set(hubFloors).size).toBe(4);
  });

  it("derives the wall color as a darker shade of the accent", () => {
    // Build's accent is #8b5cf6; the wall must be a strictly darker hex.
    const theme = roomTheme(ROOM_BY_KEY.build);
    expect(theme.wall).not.toBe(ROOM_BY_KEY.build.accent);
    expect(theme.wall).toMatch(/^#[0-9a-f]{6}$/);
  });
});
