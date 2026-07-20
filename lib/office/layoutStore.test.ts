import { OFFICE_COLS, OFFICE_ROWS } from "./layout";
import {
  DEFAULT_LAYOUT,
  LAYOUT_VERSION,
  CORE_ROOM_KEYS,
  parseLayout,
  serializeLayout,
} from "./layoutStore";

function keysOf(data: { rooms: { key: string }[] }): string[] {
  return data.rooms.map((r) => r.key).sort();
}

function withinBounds(room: { x: number; y: number; w: number; h: number }) {
  expect(room.x).toBeGreaterThanOrEqual(0);
  expect(room.y).toBeGreaterThanOrEqual(0);
  expect(room.w).toBeGreaterThan(0);
  expect(room.h).toBeGreaterThan(0);
  expect(room.x + room.w).toBeLessThanOrEqual(OFFICE_COLS);
  expect(room.y + room.h).toBeLessThanOrEqual(OFFICE_ROWS);
}

describe("layoutStore", () => {
  it("the default layout is valid and contains the core rooms", () => {
    expect(DEFAULT_LAYOUT.version).toBe(LAYOUT_VERSION);
    for (const key of CORE_ROOM_KEYS) {
      expect(DEFAULT_LAYOUT.rooms.some((r) => r.key === key)).toBe(true);
    }
    for (const room of DEFAULT_LAYOUT.rooms) withinBounds(room);
  });

  it("round-trips the default layout through parse + serialize", () => {
    const parsed = parseLayout(DEFAULT_LAYOUT);
    expect(keysOf(parsed)).toEqual(keysOf(DEFAULT_LAYOUT));

    const serialized = serializeLayout(DEFAULT_LAYOUT);
    // The default rects are integers, so serialization is a stable fixed point.
    expect(serialized).toEqual({
      version: LAYOUT_VERSION,
      rooms: DEFAULT_LAYOUT.rooms,
    });
    expect(serializeLayout(serialized)).toEqual(serialized);
  });

  it("returns a safe layout with the required rooms for malformed input", () => {
    for (const bad of [null, undefined, 42, "nope", [], {}, { rooms: null }]) {
      const parsed = parseLayout(bad as unknown);
      expect(parsed.version).toBe(LAYOUT_VERSION);
      // Every structural room is present even when the input supplied none.
      for (const key of CORE_ROOM_KEYS) {
        expect(parsed.rooms.some((r) => r.key === key)).toBe(true);
      }
      for (const room of parsed.rooms) withinBounds(room);
    }
  });

  it("drops invalid rooms but restores missing core rooms from defaults", () => {
    const parsed = parseLayout({
      version: 1,
      rooms: [
        { key: "commons", label: "Renamed Commons", x: 15, y: 1, w: 10, h: 22, accent: "#ffffff" },
        { label: "no key" }, // dropped: missing key
        null, // dropped
        "garbage", // dropped
      ],
    });
    // commons kept (with its edit), the four hubs restored from defaults.
    expect(keysOf(parsed)).toEqual([...CORE_ROOM_KEYS].sort());
    const commons = parsed.rooms.find((r) => r.key === "commons");
    expect(commons?.label).toBe("Renamed Commons");
    expect(commons?.accent).toBe("#ffffff");
  });

  it("collapses duplicate room keys to the first seen", () => {
    const parsed = parseLayout({
      rooms: [
        { key: "commons", label: "First", x: 15, y: 1, w: 10, h: 22 },
        { key: "commons", label: "Second", x: 0, y: 0, w: 5, h: 5 },
      ],
    });
    expect(parsed.rooms.filter((r) => r.key === "commons")).toHaveLength(1);
    expect(parsed.rooms.find((r) => r.key === "commons")?.label).toBe("First");
  });

  it("clamps out-of-bounds rectangles back onto the floor", () => {
    const parsed = parseLayout({
      rooms: [
        // Way off the floor and oversized.
        { key: "build", label: "Build", x: 999, y: -50, w: 500, h: 500, accent: "#8b5cf6" },
        // Negative / zero size collapses to the minimum.
        { key: "source", label: "Source", x: 5, y: 5, w: -3, h: 0, accent: "#f59e0b" },
      ],
    });
    for (const room of parsed.rooms) withinBounds(room);

    const build = parsed.rooms.find((r) => r.key === "build");
    expect(build?.x).toBe(OFFICE_COLS - build!.w);
    expect(build?.y).toBe(0);

    const source = parsed.rooms.find((r) => r.key === "source");
    expect(source?.w).toBeGreaterThanOrEqual(2);
    expect(source?.h).toBeGreaterThanOrEqual(2);
  });

  it("keeps non-core custom rooms that are valid", () => {
    const parsed = parseLayout({
      rooms: [
        { key: "lounge", label: "Lounge", hub: null, x: 2, y: 2, w: 4, h: 4, accent: "#123abc", purpose: "chill" },
      ],
    });
    const lounge = parsed.rooms.find((r) => r.key === "lounge");
    expect(lounge).toBeDefined();
    expect(lounge?.label).toBe("Lounge");
    // ...and the core rooms are still guaranteed alongside it.
    for (const key of CORE_ROOM_KEYS) {
      expect(parsed.rooms.some((r) => r.key === key)).toBe(true);
    }
  });

  it("defaults the room type from the built-in room and validates the enum", () => {
    const parsed = parseLayout({
      rooms: [
        // No type supplied → defaults to the built-in hub type.
        { key: "build", label: "Build", x: 1, y: 1, w: 13, h: 10, accent: "#8b5cf6" },
        // Invalid type → also falls back to the default.
        { key: "run", label: "Run", x: 1, y: 13, w: 13, h: 10, accent: "#22d3ee", type: "nonsense" },
        // Valid explicit type on a custom room is kept.
        { key: "lounge", label: "Lounge", hub: null, x: 2, y: 2, w: 4, h: 4, accent: "#123abc", type: "social" },
      ],
    });
    expect(parsed.rooms.find((r) => r.key === "build")?.type).toBe("hub");
    expect(parsed.rooms.find((r) => r.key === "run")?.type).toBe("hub");
    expect(parsed.rooms.find((r) => r.key === "commons")?.type).toBe("commons");
    expect(parsed.rooms.find((r) => r.key === "lounge")?.type).toBe("social");
  });

  it("validates, de-duplicates, and clamps objects; drops invalid kinds", () => {
    const parsed = parseLayout({
      rooms: [
        {
          key: "commons",
          label: "Commons",
          hub: null,
          x: 15,
          y: 1,
          w: 10,
          h: 22,
          accent: "#d4a82a",
          objects: [
            { id: "a", kind: "plant", x: 3, y: 3 },
            { id: "a", kind: "couch", x: 4, y: 4 }, // dup id dropped
            { id: "b", kind: "bogus", x: 5, y: 5 }, // invalid kind dropped
            { id: "c", kind: "desk", x: 999, y: -20 }, // clamped in-bounds
            "garbage", // dropped
          ],
        },
      ],
    });
    const commons = parsed.rooms.find((r) => r.key === "commons");
    const objects = commons?.objects ?? [];
    expect(objects.map((o) => o.id)).toEqual(["a", "c"]);
    expect(objects.find((o) => o.id === "a")?.kind).toBe("plant");
    const c = objects.find((o) => o.id === "c");
    expect(c?.x).toBeGreaterThanOrEqual(0);
    expect(c?.x).toBeLessThanOrEqual(OFFICE_COLS);
    expect(c?.y).toBeGreaterThanOrEqual(0);
    expect(c?.y).toBeLessThanOrEqual(OFFICE_ROWS);
  });

  it("round-trips objects and type through serialize with rounding", () => {
    const serialized = serializeLayout({
      version: LAYOUT_VERSION,
      rooms: [
        {
          key: "lounge",
          label: "Lounge",
          hub: null,
          x: 2,
          y: 2,
          w: 4,
          h: 4,
          accent: "#123abc",
          purpose: "",
          type: "social",
          objects: [{ id: "p1", kind: "plant", x: 3.04, y: 2.97 }],
        },
      ],
    });
    const lounge = serialized.rooms.find((r) => r.key === "lounge");
    expect(lounge?.type).toBe("social");
    expect(lounge?.objects).toEqual([{ id: "p1", kind: "plant", x: 3, y: 3 }]);

    // A second pass is a stable fixed point.
    expect(serializeLayout(serialized)).toEqual(serialized);
  });

  it("omits objects entirely for object-free layouts (backward-compatible)", () => {
    const parsed = parseLayout({
      rooms: [{ key: "commons", label: "Commons", hub: null, x: 15, y: 1, w: 10, h: 22, accent: "#d4a82a" }],
    });
    const commons = parsed.rooms.find((r) => r.key === "commons");
    expect(commons && "objects" in commons).toBe(false);
  });

  it("rounds coordinates when serializing", () => {
    const serialized = serializeLayout({
      version: LAYOUT_VERSION,
      rooms: [
        { key: "commons", label: "Commons", hub: null, x: 15.04, y: 1.06, w: 10.11, h: 21.98, accent: "#d4a82a", purpose: "" },
      ],
    });
    const commons = serialized.rooms.find((r) => r.key === "commons");
    expect(commons?.x).toBe(15);
    expect(commons?.y).toBe(1.1);
    expect(commons?.w).toBe(10.1);
    expect(commons?.h).toBe(22);
  });
});
