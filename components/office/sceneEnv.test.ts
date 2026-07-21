import {
  drawFloorMaterial,
  drawRaisedWall,
  drawWindow,
  applySceneLighting,
  WALL_HEIGHT,
  LIGHT,
} from "@/components/office/sceneEnv";
import type { FloorStyle, Wall } from "@/lib/office/walls";
import type { OfficeRoom } from "@/lib/office/layout";

const ALL_FLOORS: FloorStyle[] = ["grid", "wood", "carpet", "tile", "marble"];

// A minimal mock 2D context: every drawing method is a no-op, and the gradient
// factories return an object with addColorStop — all the engine touches.
function mockCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        return () => gradient;
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
