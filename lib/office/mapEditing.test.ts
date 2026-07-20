import { OFFICE_COLS, OFFICE_ROWS, type OfficeRoom } from "./layout";
import {
  MIN_ROOM_SIZE,
  OBJECT_CATALOG,
  ROOM_TYPES,
  hitTestRoom,
  resizeHandleAt,
  moveRoom,
  resizeRoom,
  hitTestObject,
  addObject,
  removeObject,
} from "./mapEditing";

function room(over: Partial<OfficeRoom> = {}): OfficeRoom {
  return {
    key: "r",
    label: "R",
    hub: null,
    x: 5,
    y: 5,
    w: 6,
    h: 4,
    accent: "#123abc",
    purpose: "",
    ...over,
  };
}

describe("mapEditing", () => {
  it("exposes a full catalog and room-type set", () => {
    expect(OBJECT_CATALOG.map((o) => o.kind)).toEqual([
      "desk",
      "plant",
      "whiteboard",
      "couch",
      "table",
      "screen",
    ]);
    for (const o of OBJECT_CATALOG) {
      expect(o.label).toBeTruthy();
      expect(o.emoji).toBeTruthy();
    }
    expect(ROOM_TYPES.map((t) => t.type)).toContain("hub");
    expect(ROOM_TYPES).toHaveLength(6);
  });

  it("hitTestRoom returns the topmost containing room", () => {
    const a = room({ key: "a", x: 0, y: 0, w: 10, h: 10 });
    const b = room({ key: "b", x: 2, y: 2, w: 4, h: 4 });
    // Overlap region → later room (b) wins.
    expect(hitTestRoom([a, b], 3, 3)?.key).toBe("b");
    // Only in a.
    expect(hitTestRoom([a, b], 8, 8)?.key).toBe("a");
    // Outside both.
    expect(hitTestRoom([a, b], 20, 20)).toBeNull();
  });

  it("resizeHandleAt detects corners before edges and interior misses", () => {
    const r = room({ x: 5, y: 5, w: 6, h: 4 }); // corners (5,5)(11,5)(5,9)(11,9)
    expect(resizeHandleAt(r, 5, 5, 0.5)).toBe("nw");
    expect(resizeHandleAt(r, 11, 9, 0.5)).toBe("se");
    // Midpoint of the top edge → "n".
    expect(resizeHandleAt(r, 8, 5, 0.5)).toBe("n");
    // Left edge midpoint → "w".
    expect(resizeHandleAt(r, 5, 7, 0.5)).toBe("w");
    // Deep interior → null.
    expect(resizeHandleAt(r, 8, 7, 0.5)).toBeNull();
  });

  it("moveRoom clamps the room inside the floor", () => {
    const r = room({ x: 5, y: 5, w: 6, h: 4 });
    expect(moveRoom(r, 2, 1)).toMatchObject({ x: 7, y: 6 });
    // Push far past the right/bottom edges → clamped to floor.
    const pushed = moveRoom(r, 999, 999);
    expect(pushed.x).toBe(OFFICE_COLS - r.w);
    expect(pushed.y).toBe(OFFICE_ROWS - r.h);
    // Negative past the origin.
    expect(moveRoom(r, -999, -999)).toMatchObject({ x: 0, y: 0 });
  });

  it("resizeRoom respects min size and floor bounds", () => {
    const r = room({ x: 5, y: 5, w: 6, h: 4 });
    // Grow the SE corner.
    expect(resizeRoom(r, "se", 2, 3)).toMatchObject({ x: 5, y: 5, w: 8, h: 7 });
    // Shrink the east edge past the min → clamped to MIN_ROOM_SIZE.
    const shrunk = resizeRoom(r, "e", -999, 0);
    expect(shrunk.w).toBe(MIN_ROOM_SIZE);
    expect(shrunk.x).toBe(5);
    // Drag NW corner far up-left → clamped to the floor origin.
    const nw = resizeRoom(r, "nw", -999, -999);
    expect(nw.x).toBe(0);
    expect(nw.y).toBe(0);
    // Drag the west edge right past the min → left edge stops MIN from the right.
    const w = resizeRoom(r, "w", 999, 0);
    expect(w.x).toBe(r.x + r.w - MIN_ROOM_SIZE);
    expect(w.w).toBe(MIN_ROOM_SIZE);
  });

  it("addObject appends a clamped, unique-id object", () => {
    const r = room({ x: 5, y: 5, w: 6, h: 4 });
    const r1 = addObject(r, "plant", 7, 6);
    expect(r1.objects).toHaveLength(1);
    expect(r1.objects![0]).toMatchObject({ kind: "plant", x: 7, y: 6 });
    // A second plant gets a distinct id.
    const r2 = addObject(r1, "plant", 100, 100);
    expect(new Set(r2.objects!.map((o) => o.id)).size).toBe(2);
    // Out-of-room point is clamped to the room rectangle.
    const clamped = r2.objects![1];
    expect(clamped.x).toBe(r.x + r.w);
    expect(clamped.y).toBe(r.y + r.h);
  });

  it("hitTestObject finds the nearest-topmost object within radius", () => {
    let r = room();
    r = addObject(r, "desk", 6, 6);
    r = addObject(r, "plant", 9, 8);
    expect(hitTestObject(r.objects, 6.1, 6.1, 0.6)?.kind).toBe("desk");
    expect(hitTestObject(r.objects, 9, 8, 0.6)?.kind).toBe("plant");
    expect(hitTestObject(r.objects, 0, 0, 0.6)).toBeNull();
    expect(hitTestObject(undefined, 6, 6)).toBeNull();
  });

  it("removeObject drops the objects key when empty", () => {
    let r = room();
    r = addObject(r, "desk", 6, 6);
    const id = r.objects![0].id;
    const empty = removeObject(r, id);
    expect("objects" in empty).toBe(false);
    // Removing a non-existent id from an object-free room is a no-op.
    expect(removeObject(empty, "nope")).toBe(empty);
  });
});
