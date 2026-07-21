import {
  ROOMS,
  OFFICE_COLS,
  OFFICE_ROWS,
  type OfficeRoom,
  type RoomType,
} from "./layout";
import { furnishRoom, furnishAll, PROP_SIZE } from "./furnish";

function room(over: Partial<OfficeRoom> = {}): OfficeRoom {
  return {
    key: "r",
    label: "R",
    hub: null,
    x: 6,
    y: 6,
    w: 14,
    h: 10,
    accent: "#123abc",
    purpose: "",
    ...over,
  };
}

const TYPES: RoomType[] = [
  "hub",
  "meeting",
  "social",
  "lounge",
  "cafe",
  "reception",
  "pod",
  "commons",
  "focus",
  "private",
];

describe("furnishRoom", () => {
  it("produces in-bounds, uniquely-id'd objects for every room type", () => {
    for (const type of TYPES) {
      const r = room({ key: `k-${type}`, type, w: type === "pod" ? 6 : 14, h: type === "cafe" ? 4 : 10 });
      const objects = furnishRoom(r);
      expect(objects.length).toBeGreaterThan(0);

      // Unique ids.
      const ids = objects.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);

      for (const o of objects) {
        // Anchor sits inside the room rectangle.
        expect(o.x).toBeGreaterThanOrEqual(r.x);
        expect(o.x).toBeLessThanOrEqual(r.x + r.w);
        expect(o.y).toBeGreaterThanOrEqual(r.y);
        expect(o.y).toBeLessThanOrEqual(r.y + r.h);
        // Anchor is also inside the whole office floor.
        expect(o.x).toBeGreaterThanOrEqual(0);
        expect(o.x).toBeLessThanOrEqual(OFFICE_COLS);
        expect(o.y).toBeGreaterThanOrEqual(0);
        expect(o.y).toBeLessThanOrEqual(OFFICE_ROWS);
        // Footprint matches the shared prop-size table.
        expect(o.w).toBe(PROP_SIZE[o.kind].w);
        expect(o.h).toBe(PROP_SIZE[o.kind].h);
      }
    }
  });

  it("is deterministic — same room in, same objects out", () => {
    for (const type of TYPES) {
      const r = room({ key: `d-${type}`, type });
      expect(furnishRoom(r)).toEqual(furnishRoom(r));
    }
  });

  it("uses the expected signature template per type", () => {
    const hub = furnishRoom(room({ key: "h", type: "hub" }));
    expect(hub.some((o) => o.kind === "desk")).toBe(true);
    expect(hub.some((o) => o.kind === "monitor")).toBe(true);
    expect(hub.some((o) => o.kind === "chair")).toBe(true);

    const lounge = furnishRoom(room({ key: "l", type: "lounge" }));
    expect(lounge.some((o) => o.kind === "couch")).toBe(true);
    expect(lounge.some((o) => o.kind === "rug_round")).toBe(true);

    const cafe = furnishRoom(room({ key: "c", type: "cafe", h: 4 }));
    expect(cafe.some((o) => o.kind === "cafe_counter")).toBe(true);
    expect(cafe.some((o) => o.kind === "coffee_machine")).toBe(true);

    const reception = furnishRoom(room({ key: "rc", type: "reception" }));
    expect(reception.some((o) => o.kind === "reception_desk")).toBe(true);

    const pod = furnishRoom(room({ key: "p", type: "pod", w: 6, h: 4 }));
    expect(pod.some((o) => o.kind === "pod")).toBe(true);

    const commons = furnishRoom(room({ key: "cm", type: "commons" }));
    expect(commons.some((o) => o.kind === "rug")).toBe(true);
  });

  it("keeps objects inside small rooms too", () => {
    const tiny = room({ key: "tiny", type: "pod", w: 3, h: 3 });
    for (const o of furnishRoom(tiny)) {
      expect(o.x).toBeGreaterThanOrEqual(tiny.x);
      expect(o.x).toBeLessThanOrEqual(tiny.x + tiny.w);
      expect(o.y).toBeGreaterThanOrEqual(tiny.y);
      expect(o.y).toBeLessThanOrEqual(tiny.y + tiny.h);
    }
  });
});

describe("furnishAll", () => {
  it("furnishes every built-in room with unique ids across the map", () => {
    const furnished = furnishAll(ROOMS);
    expect(furnished).toHaveLength(ROOMS.length);

    const allIds: string[] = [];
    for (const r of furnished) {
      expect(r.objects && r.objects.length).toBeGreaterThan(0);
      for (const o of r.objects ?? []) allIds.push(o.id);
    }
    // Ids are globally unique because they are namespaced by room key.
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("does not mutate the input rooms", () => {
    const before = ROOMS.map((r) => ({ ...r }));
    furnishAll(ROOMS);
    expect(ROOMS).toEqual(before);
  });
});
