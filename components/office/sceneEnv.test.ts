import {
  drawFloorMaterial,
  drawRaisedWall,
  drawGlassPartition,
  drawWindow,
  applySceneLighting,
  drawRoomPlaque,
  drawHubCrest,
  drawWordmark,
  WALL_HEIGHT,
  LIGHT,
  BRASS,
} from "@/components/office/sceneEnv";
import type { FloorStyle, Wall } from "@/lib/office/walls";
import type { OfficeRoom } from "@/lib/office/layout";

const ALL_FLOORS: FloorStyle[] = ["grid", "wood", "carpet", "tile", "marble"];

// A minimal mock 2D context: every drawing method is a no-op, the gradient
// factories return an object with addColorStop, and measureText returns a
// width — all the engine touches.
function mockCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        return () => gradient;
      }
      if (prop === "measureText") {
        return (t: string) => ({ width: (t ?? "").length * 7 });
      }
      if (prop === "canvas") return { width: 300, height: 300 };
      if (!(prop in target)) {
        target[prop] = () => {};
      }
      return target[prop];
    },
    set(target, prop: string, val) {
      target[prop] = val;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

const WALLS: Wall[] = [
  { x: 1, y: 1, w: 14, h: 0.3 }, // horizontal segment
  { x: 1, y: 1, w: 0.3, h: 10 }, // vertical segment
];

const ROOMS: OfficeRoom[] = [
  {
    key: "build",
    label: "Build Studio",
    hub: "build",
    x: 1,
    y: 1,
    w: 14,
    h: 10,
    accent: "#8b5cf6",
    purpose: "Firm identity.",
  },
  {
    key: "commons",
    label: "The Commons",
    hub: null,
    x: 17,
    y: 10,
    w: 14,
    h: 10,
    accent: "#d4a82a",
    purpose: "Where the team gathers.",
  },
];

describe("light convention", () => {
  it("keys the scene from the top-left (light travels right + down)", () => {
    expect(LIGHT.x).toBeGreaterThan(0);
    expect(LIGHT.y).toBeGreaterThan(0);
  });

  it("exposes a positive wall height in tiles", () => {
    expect(WALL_HEIGHT).toBeGreaterThan(0);
    expect(WALL_HEIGHT).toBeLessThan(1);
  });
});

describe("BRASS palette", () => {
  it("exposes a small set of well-formed brass hex tones", () => {
    const tones = Object.values(BRASS);
    expect(tones.length).toBeGreaterThanOrEqual(3);
    for (const hex of tones) {
      expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("drawFloorMaterial", () => {
  it("runs for every floor style without throwing", () => {
    const ctx = mockCtx();
    for (const floor of ALL_FLOORS) {
      expect(() =>
        drawFloorMaterial(ctx, {
          floor,
          x: 26,
          y: 26,
          w: 14 * 26,
          h: 10 * 26,
          accent: "#8b5cf6",
          surface: "#1b2130",
        }),
      ).not.toThrow();
    }
  });

  it("tolerates tiny and zero-size rects", () => {
    const ctx = mockCtx();
    for (const floor of ALL_FLOORS) {
      expect(() =>
        drawFloorMaterial(ctx, {
          floor,
          x: 0,
          y: 0,
          w: 8,
          h: 8,
          accent: "#22c55e",
          surface: "#101418",
        }),
      ).not.toThrow();
      expect(() =>
        drawFloorMaterial(ctx, {
          floor,
          x: 5,
          y: 5,
          w: 0,
          h: 0,
          accent: "#22c55e",
          surface: "#101418",
        }),
      ).not.toThrow();
    }
  });

  it("accepts 3-digit and malformed hex colors", () => {
    const ctx = mockCtx();
    expect(() =>
      drawFloorMaterial(ctx, {
        floor: "wood",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        accent: "#abc",
        surface: "zzz",
      }),
    ).not.toThrow();
  });
});

describe("drawRaisedWall", () => {
  it("runs for representative walls, with and without floor shadow", () => {
    const ctx = mockCtx();
    for (const wall of WALLS) {
      for (const floorShadow of [true, false, undefined]) {
        expect(() =>
          drawRaisedWall(ctx, {
            wall,
            tile: 26,
            color: "#3a4150",
            floorShadow,
          }),
        ).not.toThrow();
      }
    }
  });

  it("renders the glass-walled variant via the glass flag", () => {
    const ctx = mockCtx();
    for (const wall of WALLS) {
      expect(() =>
        drawRaisedWall(ctx, {
          wall,
          tile: 26,
          color: "#3a4150",
          glass: true,
          accent: "#7fb0c4",
        }),
      ).not.toThrow();
    }
  });
});

describe("drawGlassPartition", () => {
  it("runs for horizontal and vertical panes, with/without floor shadow", () => {
    const ctx = mockCtx();
    expect(() =>
      drawGlassPartition(ctx, {
        x: 40,
        y: 20,
        w: 200,
        h: 30,
        accent: "#7fb0c4",
        tile: 26,
      }),
    ).not.toThrow();
    expect(() =>
      drawGlassPartition(ctx, {
        x: 40,
        y: 20,
        w: 30,
        h: 200,
        accent: "#8b5cf6",
        tile: 26,
        floorShadow: false,
      }),
    ).not.toThrow();
    expect(() =>
      drawGlassPartition(ctx, { x: 0, y: 0, w: 0, h: 0, accent: "#abc" }),
    ).not.toThrow();
  });
});

describe("drawWindow", () => {
  it("runs with and without an explicit daylight color", () => {
    const ctx = mockCtx();
    expect(() =>
      drawWindow(ctx, { x: 40, y: 20, w: 120, h: 30 }),
    ).not.toThrow();
    expect(() =>
      drawWindow(ctx, { x: 40, y: 20, w: 30, h: 120, daylight: "#bfe3f5" }),
    ).not.toThrow();
    expect(() =>
      drawWindow(ctx, { x: 0, y: 0, w: 0, h: 0 }),
    ).not.toThrow();
  });
});

describe("applySceneLighting", () => {
  it("runs over the room set without throwing", () => {
    const ctx = mockCtx();
    expect(() =>
      applySceneLighting(ctx, {
        width: 48 * 26,
        height: 32 * 26,
        rooms: ROOMS,
      }),
    ).not.toThrow();
  });

  it("runs with an empty room set and a custom tile size", () => {
    const ctx = mockCtx();
    expect(() =>
      applySceneLighting(ctx, {
        width: 800,
        height: 600,
        rooms: [],
        tile: 32,
      }),
    ).not.toThrow();
  });
});

describe("signage helpers", () => {
  it("drawRoomPlaque runs, auto-sized and explicitly-sized", () => {
    const ctx = mockCtx();
    expect(() =>
      drawRoomPlaque(ctx, { x: 30, y: 12, label: "Boardroom", accent: "#d4a82a" }),
    ).not.toThrow();
    expect(() =>
      drawRoomPlaque(ctx, {
        x: 30,
        y: 12,
        label: "",
        accent: "#8b5cf6",
        w: 120,
        h: 22,
      }),
    ).not.toThrow();
  });

  it("drawHubCrest runs with and without a monogram, incl. zero radius", () => {
    const ctx = mockCtx();
    expect(() =>
      drawHubCrest(ctx, { cx: 100, cy: 100, r: 26, accent: "#d4a82a" }),
    ).not.toThrow();
    expect(() =>
      drawHubCrest(ctx, {
        cx: 100,
        cy: 100,
        r: 40,
        accent: "#8b5cf6",
        monogram: "FE",
      }),
    ).not.toThrow();
    expect(() =>
      drawHubCrest(ctx, { cx: 0, cy: 0, r: 0, accent: "#abc" }),
    ).not.toThrow();
  });

  it("drawWordmark runs at default and custom scale", () => {
    const ctx = mockCtx();
    expect(() =>
      drawWordmark(ctx, { x: 24, y: 24, text: "FUNDEXECS" }),
    ).not.toThrow();
    expect(() =>
      drawWordmark(ctx, {
        x: 24,
        y: 24,
        text: "Reception",
        scale: 1.6,
        accent: "#d4a82a",
      }),
    ).not.toThrow();
    expect(() =>
      drawWordmark(ctx, { x: 0, y: 0, text: "" }),
    ).not.toThrow();
  });
});
