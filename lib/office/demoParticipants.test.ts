import { demoParticipants } from "./demoParticipants";
import { OFFICE_COLS, OFFICE_ROWS } from "./layout";

// A half-tile edge margin is baked into clampToBounds; positions must land at
// or inside the floor for every sampled instant.
const EDGE = 0.6;

describe("demoParticipants", () => {
  it("returns a stable, non-trivial roster", () => {
    const a = demoParticipants(0);
    const b = demoParticipants(123456);
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(a.length).toBeLessThanOrEqual(6);
    expect(b.length).toBe(a.length);
  });

  it("marks everyone as a human ghost persona", () => {
    for (const p of demoParticipants(9999)) {
      expect(p.kind).toBe("human");
      expect(p.name).toMatch(/\(demo\)/);
    }
  });

  it("uses unique, demo-prefixed ids", () => {
    const ids = demoParticipants(0).map((p) => p.id);
    for (const id of ids) expect(id.startsWith("demo:")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every position inside the office bounds over time", () => {
    for (let now = 0; now <= 120_000; now += 250) {
      for (const p of demoParticipants(now)) {
        expect(p.x).toBeGreaterThanOrEqual(EDGE);
        expect(p.x).toBeLessThanOrEqual(OFFICE_COLS - EDGE);
        expect(p.y).toBeGreaterThanOrEqual(EDGE);
        expect(p.y).toBeLessThanOrEqual(OFFICE_ROWS - EDGE);
      }
    }
  });

  it("is deterministic for a fixed now", () => {
    const now = 42_042;
    expect(demoParticipants(now)).toEqual(demoParticipants(now));
  });

  it("moves ghosts as time advances", () => {
    const first = demoParticipants(0);
    const later = demoParticipants(2000);
    const moved = first.some(
      (p, i) => p.x !== later[i].x || p.y !== later[i].y,
    );
    expect(moved).toBe(true);
  });

  it("produces only valid presence statuses", () => {
    const valid = new Set(["available", "focusing", "away", "in_meeting"]);
    for (let now = 0; now < 40_000; now += 1500) {
      for (const p of demoParticipants(now)) {
        expect(valid.has(p.status)).toBe(true);
      }
    }
  });
});
