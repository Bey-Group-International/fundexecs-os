import {
  distance,
  nearby,
  proximityVolume,
  colorFromId,
  type Participant,
} from "./presence";

function human(id: string, x: number, y: number, status: Participant["status"] = "available"): Participant {
  return { id, name: id, kind: "human", x, y, color: "#fff", status };
}

describe("presence proximity", () => {
  it("computes euclidean distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("returns only participants within range, nearest first", () => {
    const me = { x: 0, y: 0 };
    const others = [
      human("far", 10, 0),
      human("near", 1, 0),
      human("mid", 3, 0),
    ];
    const result = nearby(me, others, 4);
    expect(result.map((p) => p.id)).toEqual(["near", "mid"]);
  });

  it("excludes away participants from conversation range", () => {
    const me = { x: 0, y: 0 };
    const others = [human("here", 1, 0, "away"), human("also", 1, 1)];
    expect(nearby(me, others, 4).map((p) => p.id)).toEqual(["also"]);
  });

  it("proximity volume falls from 1 to 0 across the radius", () => {
    expect(proximityVolume(0, 4)).toBe(1);
    expect(proximityVolume(4, 4)).toBe(0);
    expect(proximityVolume(6, 4)).toBe(0);
    const near = proximityVolume(1, 4);
    const far = proximityVolume(3, 4);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThan(1);
    expect(far).toBeGreaterThan(0);
  });

  it("derives a stable color from an id", () => {
    expect(colorFromId("user-abc")).toBe(colorFromId("user-abc"));
    expect(colorFromId("user-abc")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
