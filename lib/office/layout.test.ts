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

  it("has a room for each hub plus the commons", () => {
    const keys = ROOMS.map((r) => r.key).sort();
    expect(keys).toEqual(["build", "commons", "execute", "run", "source"]);
  });

  it("spawns humans inside the commons", () => {
    const room = roomAt(SPAWN.x, SPAWN.y);
    expect(room?.key).toBe("commons");
  });

  it("roomAt returns null in the corridor between rooms", () => {
    // The one-tile gap between the left rooms (end at x=14) and the commons
    // (starts at x=15) is a corridor.
    expect(roomAt(14.5, 6)).toBeNull();
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
