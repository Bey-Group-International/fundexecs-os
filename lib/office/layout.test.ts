import { AGENTS } from "@/lib/agents";
import {
  ROOMS,
  OFFICE_COLS,
  OFFICE_ROWS,
  SPAWN,
  roomAt,
  clampToBounds,
  agentDesks,
} from "./layout";

describe("office layout", () => {
  it("keeps every room inside the office bounds", () => {
    for (const room of ROOMS) {
      expect(room.x).toBeGreaterThanOrEqual(0);
      expect(room.y).toBeGreaterThanOrEqual(0);
      expect(room.x + room.w).toBeLessThanOrEqual(OFFICE_COLS);
      expect(room.y + room.h).toBeLessThanOrEqual(OFFICE_ROWS);
    }
  });

  it("has a room for each hub plus the premium zones", () => {
    const keys = ROOMS.map((r) => r.key).sort();
    expect(keys).toEqual([
      "build",
      "cafe",
      "commons",
      "execute",
      "lounge",
      "pod-1",
      "pod-2",
      "reception",
      "run",
      "source",
    ]);
  });

  it("keeps each hub large enough to seat its agents", () => {
    for (const key of ["build", "source", "run", "execute"]) {
      const room = ROOMS.find((r) => r.key === key)!;
      expect(room.w).toBeGreaterThanOrEqual(10);
      expect(room.h).toBeGreaterThanOrEqual(8);
    }
  });

  it("does not overlap any two rooms", () => {
    for (let i = 0; i < ROOMS.length; i++) {
      for (let j = i + 1; j < ROOMS.length; j++) {
        const a = ROOMS[i];
        const b = ROOMS[j];
        const disjoint =
          a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y;
        expect(disjoint).toBe(true);
      }
    }
  });

  it("spawns humans inside the reception lobby", () => {
    const room = roomAt(SPAWN.x, SPAWN.y);
    expect(room?.key).toBe("reception");
  });

  it("roomAt returns null in the corridor between rooms", () => {
    // The two-tile vertical corridor (x 15..17) between the left hubs and the
    // central spine is open floor.
    expect(roomAt(16, 6)).toBeNull();
  });

  it("clampToBounds pins points to the floor", () => {
    expect(clampToBounds(-5, -5)).toEqual({ x: 0.6, y: 0.6 });
    const far = clampToBounds(999, 999);
    expect(far.x).toBeCloseTo(OFFICE_COLS - 0.6);
    expect(far.y).toBeCloseTo(OFFICE_ROWS - 0.6);
    expect(clampToBounds(10, 10)).toEqual({ x: 10, y: 10 });
  });

  it("seats every agent at a desk inside its hub's room", () => {
    const desks = agentDesks();
    expect(desks).toHaveLength(AGENTS.length);

    for (const desk of desks) {
      const expectedRoom = desk.agent.hub ?? "commons";
      expect(desk.room.key).toBe(expectedRoom);
      // Desk sits within the room rectangle.
      expect(desk.x).toBeGreaterThanOrEqual(desk.room.x);
      expect(desk.x).toBeLessThanOrEqual(desk.room.x + desk.room.w);
      expect(desk.y).toBeGreaterThanOrEqual(desk.room.y);
      expect(desk.y).toBeLessThanOrEqual(desk.room.y + desk.room.h);
    }
  });

  it("is deterministic across calls", () => {
    expect(agentDesks()).toEqual(agentDesks());
  });
});
