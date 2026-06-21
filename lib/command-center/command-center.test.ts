import { buildMap, ROOMS, cellCenter } from "./map";
import { findPath } from "./pathfinding";
import { buildRoster, EARN_ID } from "./roster";
import { WorldEngine } from "./engine";
import { FLOW_A, FLOW_B } from "./flows";

describe("command center map", () => {
  const map = buildMap();

  it("builds the six-zone floor (hub + five offices)", () => {
    expect(ROOMS).toHaveLength(6);
    expect(ROOMS.map((r) => r.id).sort()).toEqual(
      ["capital", "diligence", "hub", "mandate", "outbound", "relationship"].sort(),
    );
  });

  it("every room's stand cells are walkable", () => {
    for (const room of ROOMS) {
      for (const s of room.stand) {
        expect(map.walkable[s.y][s.x]).toBe(true);
      }
    }
  });

  it("every executive desk is routable from the hub center", () => {
    const start = { x: 21, y: 12 }; // Earn's spawn
    for (const room of ROOMS) {
      for (const s of room.stand) {
        const path = findPath(map.walkable, start, s);
        // Same cell needs no path; otherwise a non-empty route must exist.
        if (s.x === start.x && s.y === start.y) continue;
        expect(path.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("roster", () => {
  it("wires Earn plus the full 15-agent catalog", () => {
    const roster = buildRoster();
    expect(roster).toHaveLength(15);
    const earn = roster.find((a) => a.id === EARN_ID);
    expect(earn?.isEarn).toBe(true);
    expect(earn?.name).toBe("Earn");
    // Exactly one Earn; the rest are executives.
    expect(roster.filter((a) => a.isEarn)).toHaveLength(1);
  });

  it("spawns every avatar on a walkable cell", () => {
    const map = buildMap();
    for (const a of buildRoster()) {
      expect(map.walkable[a.spawn.y][a.spawn.x]).toBe(true);
    }
  });
});

describe("engine flows", () => {
  function runToCompletion(steps: typeof FLOW_A) {
    const engine = new WorldEngine(buildMap(), buildRoster());
    engine.startFlow("A", steps);
    // Auto-approve when gated; advance the clock generously.
    for (let i = 0; i < 4000; i++) {
      engine.tick(16);
      if (engine.getStatus().awaitingApproval) engine.approve();
      if (!engine.getStatus().running) break;
    }
    return engine;
  }

  it("Flow A reaches a terminal (non-running) state with chat output", () => {
    const engine = runToCompletion(FLOW_A);
    expect(engine.getStatus().running).toBe(false);
    expect(engine.getChat().length).toBeGreaterThan(2);
    // Everyone returns home idle after completeAll.
    for (const a of engine.avatars.values()) {
      expect(a.path.length).toBe(0);
    }
  });

  it("Flow B routes Earn to a desk before completing", () => {
    const engine = new WorldEngine(buildMap(), buildRoster());
    engine.startFlow("B", FLOW_B);
    let earnMoved = false;
    const earn = engine.avatars.get(EARN_ID)!;
    const home = cellCenter(earn.def.spawn);
    for (let i = 0; i < 4000; i++) {
      engine.tick(16);
      if (engine.getStatus().awaitingApproval) engine.approve();
      if (Math.hypot(earn.px - home.px, earn.py - home.py) > 8) earnMoved = true;
      if (!engine.getStatus().running) break;
    }
    expect(earnMoved).toBe(true);
    expect(engine.getStatus().running).toBe(false);
  });
});
