import {
  DEFAULT_GREET_RADIUS_PX,
  actorsWithin,
  distancePx,
  enterExitTransitions,
  nearestWithin,
  type ActorPoint,
} from "./officeProximity";

const focus = { x: 100, y: 100 };

describe("distancePx", () => {
  it("computes Euclidean distance", () => {
    expect(distancePx({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("is zero for coincident points", () => {
    expect(distancePx(focus, focus)).toBe(0);
  });
});

describe("DEFAULT_GREET_RADIUS_PX", () => {
  it("is a sensible adjacent-desk radius in office pixels", () => {
    expect(DEFAULT_GREET_RADIUS_PX).toBeGreaterThan(32); // more than one tile
    expect(DEFAULT_GREET_RADIUS_PX).toBeLessThan(288); // less than a room height
  });
});

describe("nearestWithin", () => {
  it("returns null for an empty actor list", () => {
    expect(nearestWithin(focus, [], DEFAULT_GREET_RADIUS_PX)).toBeNull();
  });

  it("returns a single actor inside the radius", () => {
    const actors: ActorPoint[] = [{ id: "ceo", x: 130, y: 100 }]; // 30px away
    expect(nearestWithin(focus, actors, DEFAULT_GREET_RADIUS_PX)).toEqual({
      id: "ceo",
      distance: 30,
    });
  });

  it("returns null when the only actor is outside the radius", () => {
    const actors: ActorPoint[] = [{ id: "ceo", x: 400, y: 100 }]; // 300px away
    expect(nearestWithin(focus, actors, DEFAULT_GREET_RADIUS_PX)).toBeNull();
  });

  it("includes an actor exactly on the radius boundary", () => {
    const actors: ActorPoint[] = [{ id: "edge", x: 100 + DEFAULT_GREET_RADIUS_PX, y: 100 }];
    const hit = nearestWithin(focus, actors, DEFAULT_GREET_RADIUS_PX);
    expect(hit?.id).toBe("edge");
    expect(hit?.distance).toBe(DEFAULT_GREET_RADIUS_PX);
  });

  it("picks the nearest of several in-radius actors", () => {
    const actors: ActorPoint[] = [
      { id: "far", x: 160, y: 100 }, // 60px
      { id: "near", x: 110, y: 100 }, // 10px
      { id: "mid", x: 130, y: 100 }, // 30px
    ];
    expect(nearestWithin(focus, actors, DEFAULT_GREET_RADIUS_PX)?.id).toBe("near");
  });

  it("excludes the actor matching excludeId", () => {
    const actors: ActorPoint[] = [
      { id: "self", x: 100, y: 100 }, // 0px, but excluded
      { id: "cfo", x: 120, y: 100 }, // 20px
    ];
    expect(nearestWithin(focus, actors, DEFAULT_GREET_RADIUS_PX, "self")?.id).toBe("cfo");
  });
});

describe("actorsWithin", () => {
  it("returns an empty array for an empty actor list", () => {
    expect(actorsWithin(focus, [], DEFAULT_GREET_RADIUS_PX)).toEqual([]);
  });

  it("drops actors outside the radius and keeps those inside", () => {
    const actors: ActorPoint[] = [
      { id: "in", x: 120, y: 100 }, // 20px
      { id: "out", x: 500, y: 100 }, // 400px
    ];
    const hits = actorsWithin(focus, actors, DEFAULT_GREET_RADIUS_PX);
    expect(hits.map((h) => h.id)).toEqual(["in"]);
  });

  it("sorts hits nearest-first", () => {
    const actors: ActorPoint[] = [
      { id: "c", x: 100, y: 160 }, // 60px
      { id: "a", x: 100, y: 110 }, // 10px
      { id: "b", x: 100, y: 130 }, // 30px
    ];
    const hits = actorsWithin(focus, actors, DEFAULT_GREET_RADIUS_PX);
    expect(hits.map((h) => h.id)).toEqual(["a", "b", "c"]);
    expect(hits.map((h) => h.distance)).toEqual([10, 30, 60]);
  });

  it("keeps input order for equidistant actors (stable tie-break)", () => {
    const actors: ActorPoint[] = [
      { id: "left", x: 60, y: 100 }, // 40px
      { id: "right", x: 140, y: 100 }, // 40px
      { id: "up", x: 100, y: 60 }, // 40px
    ];
    const hits = actorsWithin(focus, actors, DEFAULT_GREET_RADIUS_PX);
    expect(hits.map((h) => h.id)).toEqual(["left", "right", "up"]);
  });

  it("excludes the actor matching excludeId", () => {
    const actors: ActorPoint[] = [
      { id: "self", x: 100, y: 100 },
      { id: "coo", x: 120, y: 100 },
    ];
    const hits = actorsWithin(focus, actors, DEFAULT_GREET_RADIUS_PX, "self");
    expect(hits.map((h) => h.id)).toEqual(["coo"]);
  });
});

describe("enterExitTransitions", () => {
  it("reports no change when the sets match", () => {
    expect(enterExitTransitions(["a", "b"], ["a", "b"])).toEqual({
      entered: [],
      exited: [],
    });
  });

  it("detects a newly entered actor", () => {
    expect(enterExitTransitions(["a"], ["a", "b"])).toEqual({
      entered: ["b"],
      exited: [],
    });
  });

  it("detects a newly exited actor", () => {
    expect(enterExitTransitions(["a", "b"], ["a"])).toEqual({
      entered: [],
      exited: ["b"],
    });
  });

  it("detects simultaneous enter and exit", () => {
    expect(enterExitTransitions(["a", "b"], ["b", "c"])).toEqual({
      entered: ["c"],
      exited: ["a"],
    });
  });

  it("treats an empty previous frame as all-entered", () => {
    expect(enterExitTransitions([], ["a", "b"])).toEqual({
      entered: ["a", "b"],
      exited: [],
    });
  });

  it("collapses duplicate ids within a frame", () => {
    expect(enterExitTransitions([], ["a", "a", "b"])).toEqual({
      entered: ["a", "b"],
      exited: [],
    });
  });
});
