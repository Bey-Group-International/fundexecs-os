import {
  PX_TO_WORLD,
  floorCenter,
  floorSize,
  pixelsOf,
  roomCenterWorld,
  roomFloor,
  roomFloors,
  wallSegments,
  workstations3D,
  worldOf,
  yawOf,
  roomAccentHex,
} from "./officeGeometry3D";
import { ROOMS, ROOM_W, ROOM_H, WORLD_W, WORLD_H } from "../types";

describe("coordinate mapping", () => {
  it("worldOf scales pixels to world units", () => {
    expect(worldOf(32, 64)).toEqual({ x: 1, z: 2 });
  });

  it("pixelsOf is the exact inverse of worldOf", () => {
    const p = { x: 417, y: 233 };
    const w = worldOf(p.x, p.y);
    expect(pixelsOf(w.x, w.z)).toEqual(p);
  });

  it("maps facing to the expected yaw", () => {
    expect(yawOf("down")).toBe(0);
    expect(yawOf("up")).toBeCloseTo(Math.PI);
    expect(yawOf("left")).toBeCloseTo(Math.PI / 2);
    expect(yawOf("right")).toBeCloseTo(-Math.PI / 2);
  });
});

describe("floor + rooms", () => {
  it("floorSize matches the world dimensions", () => {
    expect(floorSize()).toEqual({
      width: WORLD_W * PX_TO_WORLD,
      depth: WORLD_H * PX_TO_WORLD,
    });
  });

  it("floorCenter is the middle of the world", () => {
    expect(floorCenter()).toEqual({
      x: (WORLD_W / 2) * PX_TO_WORLD,
      z: (WORLD_H / 2) * PX_TO_WORLD,
    });
  });

  it("produces one floor box per room", () => {
    expect(roomFloors()).toHaveLength(ROOMS.length);
  });

  it("places a standard room at its grid cell center", () => {
    const box = roomFloor("boardroom")!; // col 1, row 0
    expect(box.cx).toBeCloseTo((1 * ROOM_W + ROOM_W / 2) * PX_TO_WORLD);
    expect(box.cz).toBeCloseTo((0 * ROOM_H + ROOM_H / 2) * PX_TO_WORLD);
    expect(box.width).toBeCloseTo(ROOM_W * PX_TO_WORLD);
  });

  it("honors colSpan for the full-width marketplace hall", () => {
    const box = roomFloor("marketplace")!;
    expect(box.width).toBeCloseTo(WORLD_W * PX_TO_WORLD); // spans all 3 columns
    expect(box.cx).toBeCloseTo((WORLD_W / 2) * PX_TO_WORLD);
  });

  it("roomCenterWorld matches the room floor center", () => {
    const box = roomFloor("trading")!;
    expect(roomCenterWorld("trading")).toEqual({ x: box.cx, z: box.cz });
  });

  it("returns null for an unknown room", () => {
    expect(roomFloor("does-not-exist")).toBeNull();
    expect(roomCenterWorld("does-not-exist")).toBeNull();
  });
});

describe("walls", () => {
  const segments = wallSegments();

  it("emits a non-trivial number of split wall segments", () => {
    // 4 perimeter + many door-split internal segments.
    expect(segments.length).toBeGreaterThan(10);
  });

  it("keeps every wall inside the world bounds", () => {
    for (const s of segments) {
      const halfW = s.width / 2;
      const halfD = s.depth / 2;
      expect(s.cx - halfW).toBeGreaterThanOrEqual(-1e-9);
      expect(s.cx + halfW).toBeLessThanOrEqual(WORLD_W * PX_TO_WORLD + 1e-9);
      expect(s.cz - halfD).toBeGreaterThanOrEqual(-1e-9);
      expect(s.cz + halfD).toBeLessThanOrEqual(WORLD_H * PX_TO_WORLD + 1e-9);
      expect(s.height).toBeGreaterThan(0);
    }
  });
});

describe("workstations", () => {
  const desks = workstations3D();

  it("emits desks for the staffed rooms", () => {
    // Every office-grid room has a desk bank; count should be well above zero.
    expect(desks.length).toBeGreaterThan(15);
  });

  it("places the desk in front of (greater z than) its seat", () => {
    for (const w of desks) {
      expect(w.desk.cz).toBeGreaterThan(w.seat.z);
      expect(w.desk.cx).toBeCloseTo(w.seat.x); // desk centered on the seat's x
    }
  });

  it("tags each desk with a real room key", () => {
    const keys = new Set(ROOMS.map((r) => r.key));
    for (const w of desks) expect(keys.has(w.roomKey)).toBe(true);
  });
});

describe("accents", () => {
  it("returns the department accent for known rooms", () => {
    expect(roomAccentHex("trading")).toBe("#38bdf8");
    expect(roomAccentHex("legal")).toBe("#ef4444");
  });

  it("falls back to gold for unknown rooms", () => {
    expect(roomAccentHex("mystery")).toBe("#c9a84c");
  });
});
