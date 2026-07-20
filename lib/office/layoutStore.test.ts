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
