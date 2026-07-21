import { PROP_CATALOG, drawProp } from "@/components/office/officeProps";
import type { OfficeObjectKind } from "@/lib/office/layout";

// Every OfficeObjectKind, hardcoded so the test fails loudly if the vocabulary
// in lib/office/layout.ts grows without the prop engine keeping up.
const ALL_KINDS: OfficeObjectKind[] = [
  "desk",
  "plant",
  "whiteboard",
  "couch",
  "table",
  "screen",
  "chair",
  "monitor",
  "plant_lg",
  "armchair",
  "coffee_table",
  "meeting_table",
  "tv",
  "bookshelf",
  "rug",
  "rug_round",
  "reception_desk",
  "cafe_counter",
  "coffee_machine",
  "water_cooler",
  "wall_art",
  "window",
  "divider",
  "pod",
  "lamp",
  "server_rack",
];

// A minimal mock 2D context: every drawing method is a no-op, and the gradient
// factories return objects with addColorStop, which is all the engine touches.
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

describe("PROP_CATALOG", () => {
  it("has an entry with a label and positive footprint for every kind", () => {
    for (const kind of ALL_KINDS) {
      const entry = PROP_CATALOG[kind];
      expect(entry).toBeDefined();
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.w).toBeGreaterThan(0);
      expect(entry.h).toBeGreaterThan(0);
    }
  });

  it("does not carry extra kinds beyond the known vocabulary", () => {
    expect(Object.keys(PROP_CATALOG).sort()).toEqual([...ALL_KINDS].sort());
  });
});

describe("drawProp", () => {
  it("runs for every kind (default footprint) without throwing", () => {
    const ctx = mockCtx();
    for (const kind of ALL_KINDS) {
      for (const timeMs of [0, 500, 2000]) {
        expect(() =>
          drawProp(ctx, { kind, x: 4, y: 3, tile: 26, timeMs, accent: "#8b5cf6" }),
        ).not.toThrow();
      }
    }
  });

  it("runs for every kind with rotation and custom footprints", () => {
    const ctx = mockCtx();
    for (const kind of ALL_KINDS) {
      for (const rot of [0, 45, 90, 180, 270]) {
        expect(() =>
          drawProp(ctx, {
            kind,
            x: 10,
            y: 8,
            tile: 26,
            w: 3,
            h: 2,
            rot,
            accent: "#22c55e",
            timeMs: 1234,
          }),
        ).not.toThrow();
      }
    }
  });

  it("runs without an accent or a clock", () => {
    const ctx = mockCtx();
    for (const kind of ALL_KINDS) {
      expect(() => drawProp(ctx, { kind, x: 0, y: 0, tile: 26 })).not.toThrow();
    }
  });

  it("tolerates a tiny footprint for every kind", () => {
    const ctx = mockCtx();
    for (const kind of ALL_KINDS) {
      expect(() =>
        drawProp(ctx, { kind, x: 1, y: 1, tile: 26, w: 0.3, h: 0.3, timeMs: 100 }),
      ).not.toThrow();
    }
  });
});
