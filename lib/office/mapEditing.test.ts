import {
  OFFICE_COLS,
  OFFICE_ROWS,
  type OfficeFloor,
  type OfficeObjectKind,
  type OfficeRoom,
} from "./layout";
import {
  MIN_ROOM_SIZE,
  OBJECT_CATALOG,
  ROOM_TEMPLATES,
  ROOM_TYPES,
  hitTestRoom,
  resizeHandleAt,
  moveRoom,
  resizeRoom,
  hitTestObject,
  addObject,
  removeObject,
  snapToGrid,
  snapRoom,
  addRoom,
  deleteRoom,
  duplicateRoom,
  updateRoom,
  addFloor,
  deleteFloor,
  renameFloor,
  duplicateFloor,
  moveFloor,
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
  it("exposes a catalog covering every object kind, with footprints", () => {
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
      "image",
    ];
    const catalogKinds = OBJECT_CATALOG.map((o) => o.kind);
    // Every kind is present, exactly once.
    expect([...catalogKinds].sort()).toEqual([...ALL_KINDS].sort());
    expect(new Set(catalogKinds).size).toBe(catalogKinds.length);
    for (const o of OBJECT_CATALOG) {
      expect(o.label).toBeTruthy();
      expect(o.emoji).toBeTruthy();
      expect(o.w).toBeGreaterThan(0);
      expect(o.h).toBeGreaterThan(0);
    }
  });

  it("exposes the full room-type set including the premium zones", () => {
    const types = ROOM_TYPES.map((t) => t.type);
    for (const t of ["hub", "commons", "reception", "lounge", "cafe", "pod"] as const) {
      expect(types).toContain(t);
    }
    expect(new Set(types).size).toBe(types.length);
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

  // --- snapping ------------------------------------------------------------

  it("snapToGrid rounds to the nearest step and guards bad input", () => {
    expect(snapToGrid(2.4)).toBe(2);
    expect(snapToGrid(2.6)).toBe(3);
    expect(snapToGrid(7, 2)).toBe(8);
    expect(snapToGrid(11, 4)).toBe(12);
    // Non-positive / NaN step falls back to 1; non-finite value → 0.
    expect(snapToGrid(3.5, 0)).toBe(4);
    expect(snapToGrid(3.5, -2)).toBe(4);
    expect(snapToGrid(Number.NaN)).toBe(0);
  });

  it("snapRoom snaps the rect and re-clamps to bounds and min size", () => {
    const r = room({ x: 4.6, y: 2.4, w: 5.6, h: 3.4 });
    const snapped = snapRoom(r);
    expect(snapped).toMatchObject({ x: 5, y: 2, w: 6, h: 3 });
    // Input untouched.
    expect(r.x).toBe(4.6);
    // A tiny snapped size is floored to MIN_ROOM_SIZE.
    const tiny = snapRoom(room({ x: 1, y: 1, w: 0.2, h: 0.2 }));
    expect(tiny.w).toBe(MIN_ROOM_SIZE);
    expect(tiny.h).toBe(MIN_ROOM_SIZE);
    // A step keeps it on-grid.
    expect(snapRoom(room({ x: 3, y: 3, w: 5, h: 5 }), 2)).toMatchObject({
      x: 4,
      y: 4,
      w: 6,
      h: 6,
    });
  });

  // --- room CRUD -----------------------------------------------------------

  it("ROOM_TEMPLATES is a well-formed preset palette", () => {
    expect(ROOM_TEMPLATES.length).toBeGreaterThanOrEqual(7);
    const labels = ROOM_TEMPLATES.map((t) => t.label);
    for (const l of ["Meeting Room", "Focus Pod", "Boardroom", "Open Plan"]) {
      expect(labels).toContain(l);
    }
    for (const t of ROOM_TEMPLATES) {
      expect(t.w).toBeGreaterThanOrEqual(MIN_ROOM_SIZE);
      expect(t.h).toBeGreaterThanOrEqual(MIN_ROOM_SIZE);
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.purpose).toBeTruthy();
    }
  });

  it("addRoom appends a clamped room with a unique key", () => {
    const tmpl = ROOM_TEMPLATES[0]; // Meeting Room 8×6
    const rooms: OfficeRoom[] = [];
    const r1 = addRoom(rooms, tmpl, { x: 3, y: 4 });
    expect(rooms).toHaveLength(0); // input untouched
    expect(r1).toHaveLength(1);
    expect(r1[0]).toMatchObject({
      key: `${tmpl.type}-1`,
      hub: null,
      x: 3,
      y: 4,
      w: tmpl.w,
      h: tmpl.h,
    });
    // Same-type template gets a distinct key.
    const r2 = addRoom(r1, tmpl, { x: 0, y: 0 });
    const keys = r2.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Placed off the floor → clamped fully inside.
    const r3 = addRoom([], tmpl, { x: 999, y: 999 });
    expect(r3[0].x).toBe(OFFICE_COLS - tmpl.w);
    expect(r3[0].y).toBe(OFFICE_ROWS - tmpl.h);
  });

  it("deleteRoom removes by key and is a no-op when absent", () => {
    const rooms = [room({ key: "a" }), room({ key: "b" })];
    expect(deleteRoom(rooms, "a").map((r) => r.key)).toEqual(["b"]);
    // No-op keeps both, and never mutates the input.
    expect(deleteRoom(rooms, "zzz").map((r) => r.key)).toEqual(["a", "b"]);
    expect(rooms).toHaveLength(2);
  });

  it("duplicateRoom clones with an offset, a fresh key, and fresh object ids", () => {
    let src = room({ key: "a", type: "meeting", x: 5, y: 5, w: 6, h: 4 });
    src = addObject(src, "desk", 6, 6);
    const rooms = [src];
    const dup = duplicateRoom(rooms, "a");
    expect(dup).toHaveLength(2);
    const clone = dup[1];
    expect(clone.key).not.toBe("a");
    expect(clone.x).toBe(6);
    expect(clone.y).toBe(6);
    // Objects copied but independent (fresh object array, not the same ref).
    expect(clone.objects).toHaveLength(1);
    expect(clone.objects).not.toBe(src.objects);
    clone.objects![0].x = 99;
    expect(src.objects![0].x).toBe(6); // source unaffected
    // Absent key → no-op (same array reference back).
    expect(duplicateRoom(rooms, "nope")).toBe(rooms);
    // Duplicate near the edge stays inside the floor.
    const edge = room({ key: "e", type: "pod", x: OFFICE_COLS - 4, y: OFFICE_ROWS - 4, w: 4, h: 4 });
    const dupEdge = duplicateRoom([edge], "e", { x: 3, y: 3 });
    expect(dupEdge[1].x).toBe(OFFICE_COLS - 4);
    expect(dupEdge[1].y).toBe(OFFICE_ROWS - 4);
  });

  it("updateRoom shallow-merges a patch and re-clamps the rect", () => {
    const rooms = [room({ key: "a", label: "Old", x: 5, y: 5, w: 6, h: 4 })];
    const patched = updateRoom(rooms, "a", { label: "New", accent: "#000000" });
    expect(patched[0]).toMatchObject({ label: "New", accent: "#000000" });
    expect(rooms[0].label).toBe("Old"); // input untouched
    // An oversized/off-floor patch is clamped.
    const clamped = updateRoom(rooms, "a", { w: 999, x: 999 });
    expect(clamped[0].w).toBe(OFFICE_COLS);
    expect(clamped[0].x).toBe(0);
    // A below-min patch is floored.
    expect(updateRoom(rooms, "a", { h: 0 })[0].h).toBe(MIN_ROOM_SIZE);
    // Absent key → unchanged rooms (still a new array from map, values equal).
    expect(updateRoom(rooms, "nope", { label: "X" })[0].label).toBe("Old");
  });

  // --- floor CRUD ----------------------------------------------------------

  function floor(over: Partial<OfficeFloor> = {}): OfficeFloor {
    return { id: "f", name: "F", level: 0, rooms: [], ...over };
  }

  it("addFloor appends an empty floor with a unique id and next level", () => {
    const floors = [floor({ id: "ground", level: 0 })];
    const next = addFloor(floors, "Mezzanine");
    expect(floors).toHaveLength(1); // input untouched
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ name: "Mezzanine", level: 1, rooms: [] });
    expect(next[1].id).not.toBe("ground");
    // Default name when none supplied.
    expect(addFloor(next)[2].name).toBeTruthy();
    // Ids stay unique across repeated adds.
    const ids = addFloor(addFloor(floors)).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("deleteFloor protects the last floor and re-numbers levels", () => {
    const only = [floor({ id: "a", level: 0 })];
    expect(deleteFloor(only, "a")).toBe(only); // last-floor protection
    const floors = [
      floor({ id: "a", level: 0 }),
      floor({ id: "b", level: 1 }),
      floor({ id: "c", level: 2 }),
    ];
    const afterDelete = deleteFloor(floors, "b");
    expect(afterDelete.map((f) => f.id)).toEqual(["a", "c"]);
    expect(afterDelete.map((f) => f.level)).toEqual([0, 1]); // renumbered
    expect(floors).toHaveLength(3); // input untouched
    // Absent id → no-op.
    expect(deleteFloor(floors, "zzz")).toBe(floors);
  });

  it("renameFloor renames by id only", () => {
    const floors = [floor({ id: "a", name: "A" }), floor({ id: "b", name: "B" })];
    const next = renameFloor(floors, "b", "Beta");
    expect(next.map((f) => f.name)).toEqual(["A", "Beta"]);
    expect(floors[1].name).toBe("B"); // input untouched
  });

  it("duplicateFloor deep-clones rooms after the source with a unique id", () => {
    let r = room({ key: "risk", type: "meeting", x: 1, y: 1, w: 6, h: 4 });
    r = addObject(r, "desk", 2, 2);
    const floors = [
      floor({ id: "ground", level: 0 }),
      floor({ id: "trading", name: "Trading", level: 1, rooms: [r] }),
      floor({ id: "exec", level: 2 }),
    ];
    const next = duplicateFloor(floors, "trading");
    expect(next.map((f) => f.id)).toEqual([
      "ground",
      "trading",
      expect.any(String),
      "exec",
    ]);
    const clone = next[2];
    expect(clone.id).not.toBe("trading");
    expect(clone.name).toContain("copy");
    expect(next.map((f) => f.level)).toEqual([0, 1, 2, 3]); // renumbered
    // Rooms are deep-cloned: distinct objects, independent mutation.
    expect(clone.rooms).not.toBe(floors[1].rooms);
    expect(clone.rooms[0]).not.toBe(r);
    clone.rooms[0].label = "MUTATED";
    clone.rooms[0].objects![0].x = 42;
    expect(r.label).not.toBe("MUTATED");
    expect(r.objects![0].x).toBe(2);
    // Absent id → no-op.
    expect(duplicateFloor(floors, "nope")).toBe(floors);
  });

  it("moveFloor reorders and re-numbers levels, clamping at the ends", () => {
    const floors = [
      floor({ id: "a", level: 0 }),
      floor({ id: "b", level: 1 }),
      floor({ id: "c", level: 2 }),
    ];
    const up = moveFloor(floors, "c", "up");
    expect(up.map((f) => f.id)).toEqual(["a", "c", "b"]);
    expect(up.map((f) => f.level)).toEqual([0, 1, 2]);
    const down = moveFloor(floors, "a", "down");
    expect(down.map((f) => f.id)).toEqual(["b", "a", "c"]);
    // Already at the top / bottom → no-op.
    expect(moveFloor(floors, "a", "up")).toBe(floors);
    expect(moveFloor(floors, "c", "down")).toBe(floors);
    // Absent id → no-op.
    expect(moveFloor(floors, "zzz", "up")).toBe(floors);
    expect(floors.map((f) => f.id)).toEqual(["a", "b", "c"]); // input untouched
  });
});
