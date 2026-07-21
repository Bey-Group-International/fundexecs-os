// Pure, DOM-free geometry helpers for the drag-on-canvas MapMaker. Everything
// here operates in TILE space (floats allowed) and is side-effect-free so the
// canvas editor stays a thin rendering shell over unit-testable logic. Mirrors
// the clamping rules of `layoutStore` (min room size, floor bounds) so an edit
// made here survives serialization unchanged.
import {
  OFFICE_COLS,
  OFFICE_ROWS,
  type OfficeFloor,
  type OfficeObject,
  type OfficeRoom,
  type RoomType,
} from "./layout";
import { PROP_SIZE } from "./furnish";

/** Minimum room extent (tiles) — matches `layoutStore`'s MIN_SIZE. */
export const MIN_ROOM_SIZE = 2;

/** A palette entry: kind + label + glyph, joined with its default footprint. */
export interface CatalogEntry {
  kind: OfficeObject["kind"];
  label: string;
  emoji: string;
  /** Default footprint (tiles) applied when placing this prop. */
  w: number;
  h: number;
}

/** kind → human label + emoji glyph, in palette display order. */
const CATALOG_META: readonly {
  kind: OfficeObject["kind"];
  label: string;
  emoji: string;
}[] = [
  // legacy
  { kind: "desk", label: "Desk", emoji: "🪑" },
  { kind: "plant", label: "Plant", emoji: "🪴" },
  { kind: "whiteboard", label: "Whiteboard", emoji: "📝" },
  { kind: "couch", label: "Couch", emoji: "🛋️" },
  { kind: "table", label: "Table", emoji: "🍽️" },
  { kind: "screen", label: "Screen", emoji: "🖥️" },
  // premium catalogue
  { kind: "chair", label: "Chair", emoji: "💺" },
  { kind: "monitor", label: "Monitor", emoji: "💻" },
  { kind: "plant_lg", label: "Large Plant", emoji: "🌳" },
  { kind: "armchair", label: "Armchair", emoji: "🛋️" },
  { kind: "coffee_table", label: "Coffee Table", emoji: "☕" },
  { kind: "meeting_table", label: "Meeting Table", emoji: "📊" },
  { kind: "tv", label: "TV", emoji: "📺" },
  { kind: "bookshelf", label: "Bookshelf", emoji: "📚" },
  { kind: "rug", label: "Rug", emoji: "🟫" },
  { kind: "rug_round", label: "Round Rug", emoji: "🟢" },
  { kind: "reception_desk", label: "Reception Desk", emoji: "🛎️" },
  { kind: "cafe_counter", label: "Cafe Counter", emoji: "🍵" },
  { kind: "coffee_machine", label: "Coffee Machine", emoji: "☕" },
  { kind: "water_cooler", label: "Water Cooler", emoji: "🚰" },
  { kind: "wall_art", label: "Wall Art", emoji: "🖼️" },
  { kind: "window", label: "Window", emoji: "🪟" },
  { kind: "divider", label: "Divider", emoji: "🚧" },
  { kind: "pod", label: "Focus Pod", emoji: "🔇" },
  { kind: "lamp", label: "Lamp", emoji: "💡" },
  { kind: "server_rack", label: "Server Rack", emoji: "🗄️" },
  // uploaded branding (logo / poster / wall art) — placed via the upload control
  { kind: "image", label: "Image", emoji: "🖼️" },
];

/** Default footprint for the uploaded-image prop (not in `PROP_SIZE`). */
const IMAGE_SIZE = { w: 3, h: 2 } as const;

/** Default footprint (tiles) for a kind — `PROP_SIZE`, plus the image override. */
function footprintFor(kind: OfficeObject["kind"]): { w: number; h: number } {
  return kind === "image" ? IMAGE_SIZE : PROP_SIZE[kind];
}

/** Palette of placeable objects: label + emoji + default footprint per kind. */
export const OBJECT_CATALOG: readonly CatalogEntry[] = CATALOG_META.map((m) => ({
  ...m,
  w: footprintFor(m.kind).w,
  h: footprintFor(m.kind).h,
}));

const OBJECT_LABEL: Record<OfficeObject["kind"], string> = Object.fromEntries(
  OBJECT_CATALOG.map((o) => [o.kind, o.label]),
) as Record<OfficeObject["kind"], string>;

/** Selectable room types with display labels for the type dropdown. */
export const ROOM_TYPES: readonly { type: RoomType; label: string }[] = [
  { type: "hub", label: "Hub" },
  { type: "meeting", label: "Meeting" },
  { type: "focus", label: "Focus" },
  { type: "private", label: "Private" },
  { type: "social", label: "Social" },
  { type: "commons", label: "Commons" },
  { type: "reception", label: "Reception" },
  { type: "lounge", label: "Lounge" },
  { type: "cafe", label: "Cafe" },
  { type: "pod", label: "Focus Pod" },
];

/** A resize grip: a corner (two letters) or an edge (one letter). */
export type ResizeHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Topmost room containing a tile-space point, or null. Iterates last-to-first so
 * the result matches paint order (later rooms draw on top).
 */
export function hitTestRoom(
  rooms: OfficeRoom[],
  x: number,
  y: number,
): OfficeRoom | null {
  for (let i = rooms.length - 1; i >= 0; i--) {
    const r = rooms[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
  }
  return null;
}

/**
 * Which resize grip (if any) a point falls on, within `tol` tiles. Corners take
 * priority over edges. Returns null when the point is in the room interior or
 * outside the room + tolerance band.
 */
export function resizeHandleAt(
  room: OfficeRoom,
  x: number,
  y: number,
  tol = 0.5,
): ResizeHandle | null {
  const x0 = room.x;
  const y0 = room.y;
  const x1 = room.x + room.w;
  const y1 = room.y + room.h;

  const nearL = Math.abs(x - x0) <= tol;
  const nearR = Math.abs(x - x1) <= tol;
  const nearT = Math.abs(y - y0) <= tol;
  const nearB = Math.abs(y - y1) <= tol;
  const inX = x >= x0 - tol && x <= x1 + tol;
  const inY = y >= y0 - tol && y <= y1 + tol;

  // Corners first.
  if (nearL && nearT) return "nw";
  if (nearR && nearT) return "ne";
  if (nearL && nearB) return "sw";
  if (nearR && nearB) return "se";
  // Then edges (only when the point lies along that edge's span).
  if (nearT && inX) return "n";
  if (nearB && inX) return "s";
  if (nearL && inY) return "w";
  if (nearR && inY) return "e";
  return null;
}

/** Move a room by a tile-space delta, clamped fully inside the floor. */
export function moveRoom(room: OfficeRoom, dx: number, dy: number): OfficeRoom {
  return {
    ...room,
    x: clamp(room.x + dx, 0, OFFICE_COLS - room.w),
    y: clamp(room.y + dy, 0, OFFICE_ROWS - room.h),
  };
}

/**
 * Resize a room by dragging `handle` by a tile-space delta. Enforces the minimum
 * room size (pushing the dragged edge back rather than crossing the opposite
 * edge) and keeps every edge on the floor.
 */
export function resizeRoom(
  room: OfficeRoom,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): OfficeRoom {
  let x0 = room.x;
  let y0 = room.y;
  let x1 = room.x + room.w;
  let y1 = room.y + room.h;

  if (handle.includes("w")) x0 = clamp(x0 + dx, 0, x1 - MIN_ROOM_SIZE);
  if (handle.includes("e")) x1 = clamp(x1 + dx, x0 + MIN_ROOM_SIZE, OFFICE_COLS);
  if (handle.includes("n")) y0 = clamp(y0 + dy, 0, y1 - MIN_ROOM_SIZE);
  if (handle.includes("s")) y1 = clamp(y1 + dy, y0 + MIN_ROOM_SIZE, OFFICE_ROWS);

  return { ...room, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Topmost object within `radius` tiles of a point, or null. Objects are compared
 * by Euclidean distance from their anchor; later objects win ties.
 */
export function hitTestObject(
  objects: OfficeObject[] | undefined,
  x: number,
  y: number,
  radius = 0.6,
): OfficeObject | null {
  if (!objects) return null;
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (Math.hypot(o.x - x, o.y - y) <= radius) return o;
  }
  return null;
}

/** Mint an object id unique within a room's existing objects. */
function nextObjectId(
  objects: OfficeObject[],
  kind: OfficeObject["kind"],
): string {
  const used = new Set(objects.map((o) => o.id));
  let i = 1;
  let id = `${kind}-${i}`;
  while (used.has(id)) id = `${kind}-${++i}`;
  return id;
}

/**
 * Add an object of `kind` to a room at a tile-space point, clamped inside the
 * room rectangle. Returns a new room with a fresh unique-id object appended.
 */
export function addObject(
  room: OfficeRoom,
  kind: OfficeObject["kind"],
  x: number,
  y: number,
): OfficeRoom {
  const objects = room.objects ?? [];
  const size = footprintFor(kind);
  const obj: OfficeObject = {
    id: nextObjectId(objects, kind),
    kind,
    x: clamp(x, room.x, room.x + room.w),
    y: clamp(y, room.y, room.y + room.h),
    w: size.w,
    h: size.h,
  };
  return { ...room, objects: [...objects, obj] };
}

/**
 * Remove an object by id. Drops the `objects` key entirely when the room ends up
 * empty, keeping object-free rooms byte-identical to legacy layouts.
 */
export function removeObject(room: OfficeRoom, id: string): OfficeRoom {
  if (!room.objects) return room;
  const objects = room.objects.filter((o) => o.id !== id);
  if (objects.length === 0) {
    const { objects: _omit, ...rest } = room;
    void _omit;
    return rest;
  }
  return { ...room, objects };
}

/** Human label for an object kind (falls back to the raw kind). */
export function objectLabel(kind: OfficeObject["kind"]): string {
  return OBJECT_LABEL[kind] ?? kind;
}

// ===========================================================================
// Room & floor CRUD — pure, DOM-free operations the MapMaker store composes.
// Every function returns NEW arrays/objects (never mutates its input), mints
// collision-free ids/keys, and coerces/clamps bad input rather than throwing,
// so an edit made here always serializes back to a valid 48×32 floor plan.
// ===========================================================================

/** Coerce a maybe-NaN/Infinity number to a finite value (fallback otherwise). */
function num(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Force a room's rectangle to be valid: at least MIN_ROOM_SIZE on each axis and
 * fully inside the floor. Shared by every helper that produces or edits a room
 * so bounds rules live in exactly one place.
 */
function clampRoomRect(room: OfficeRoom): OfficeRoom {
  const w = clamp(num(room.w, MIN_ROOM_SIZE), MIN_ROOM_SIZE, OFFICE_COLS);
  const h = clamp(num(room.h, MIN_ROOM_SIZE), MIN_ROOM_SIZE, OFFICE_ROWS);
  const x = clamp(num(room.x), 0, OFFICE_COLS - w);
  const y = clamp(num(room.y), 0, OFFICE_ROWS - h);
  return { ...room, x, y, w, h };
}

/** Mint a `${base}-${n}` room key unique within an existing room set. */
function nextRoomKey(rooms: OfficeRoom[], base: string): string {
  const used = new Set(rooms.map((r) => r.key));
  let i = 1;
  let key = `${base}-${i}`;
  while (used.has(key)) key = `${base}-${++i}`;
  return key;
}

/** Copy a room's objects, giving each a fresh id unique within the copy. */
function cloneObjects(objects: OfficeObject[]): OfficeObject[] {
  const out: OfficeObject[] = [];
  for (const o of objects) out.push({ ...o, id: nextObjectId(out, o.kind) });
  return out;
}

/**
 * Round a tile coordinate to the nearest `step` (snap-to-grid dragging). Guards
 * against a non-positive/NaN step (falls back to 1) and non-finite values.
 */
export function snapToGrid(value: number, step = 1): number {
  const s = Number.isFinite(step) && step > 0 ? step : 1;
  return Math.round(num(value) / s) * s;
}

/** Snap a room's x/y/w/h to the grid, then re-clamp to bounds and min size. */
export function snapRoom(room: OfficeRoom, step = 1): OfficeRoom {
  return clampRoomRect({
    ...room,
    x: snapToGrid(room.x, step),
    y: snapToGrid(room.y, step),
    w: snapToGrid(room.w, step),
    h: snapToGrid(room.h, step),
  });
}

/** A ready-to-place room preset for the MapMaker's room palette. */
export interface RoomTemplate {
  type: RoomType;
  label: string;
  w: number;
  h: number;
  accent: string;
  purpose: string;
}

/**
 * A palette of institutional room presets, reusing the accents already in the
 * floor plans (layout.ts). Placed via {@link addRoom}, which stamps a unique key.
 */
export const ROOM_TEMPLATES: readonly RoomTemplate[] = [
  { type: "meeting", label: "Meeting Room", w: 8, h: 6, accent: "#5566a6", purpose: "A room for scheduled syncs and reviews." },
  { type: "pod", label: "Focus Pod", w: 4, h: 4, accent: "#5b6673", purpose: "A quiet booth for heads-down, single-track work." },
  { type: "private", label: "Private Office", w: 6, h: 6, accent: "#8a7096", purpose: "A private office for closed-door work." },
  { type: "lounge", label: "Lounge", w: 10, h: 8, accent: "#5a7797", purpose: "Soft seating for casual syncs and downtime." },
  { type: "meeting", label: "Boardroom", w: 12, h: 8, accent: "#c9a24a", purpose: "The main boardroom for IC and the board." },
  { type: "cafe", label: "Cafe", w: 12, h: 4, accent: "#a6774d", purpose: "Coffee, counter seating, and informal collisions." },
  { type: "social", label: "Open Plan", w: 14, h: 10, accent: "#4a7a5e", purpose: "An open-plan floor where the team works together." },
];

/**
 * Append a new room built from a template at a tile position. The key is unique
 * within `rooms` (`${type}-${n}`), hub is null, and the rectangle is clamped
 * fully inside the floor. Returns a new array.
 */
export function addRoom(
  rooms: OfficeRoom[],
  template: RoomTemplate,
  at: { x: number; y: number },
): OfficeRoom[] {
  const room = clampRoomRect({
    key: nextRoomKey(rooms, template.type),
    label: template.label,
    hub: null,
    x: num(at?.x),
    y: num(at?.y),
    w: template.w,
    h: template.h,
    accent: template.accent,
    type: template.type,
    purpose: template.purpose,
  });
  return [...rooms, room];
}

/** Remove a room by key (no-op if absent). Returns a new array. */
export function deleteRoom(rooms: OfficeRoom[], key: string): OfficeRoom[] {
  return rooms.filter((r) => r.key !== key);
}

/**
 * Clone a room offset by a tile or two, with a fresh unique key and clamped
 * inside the floor. Its objects are copied with fresh ids. No-op if `key` is
 * absent. Returns a new array.
 */
export function duplicateRoom(
  rooms: OfficeRoom[],
  key: string,
  offset: { x: number; y: number } = { x: 1, y: 1 },
): OfficeRoom[] {
  const src = rooms.find((r) => r.key === key);
  if (!src) return rooms;
  const clone = clampRoomRect({
    ...src,
    key: nextRoomKey(rooms, src.type ?? "room"),
    x: num(src.x) + num(offset?.x, 1),
    y: num(src.y) + num(offset?.y, 1),
    ...(src.objects ? { objects: cloneObjects(src.objects) } : {}),
  });
  return [...rooms, clone];
}

/**
 * Shallow-merge a patch (label / accent / type / purpose / rect …) into the room
 * with `key`, re-clamping its rectangle. No-op if absent. Returns a new array.
 */
export function updateRoom(
  rooms: OfficeRoom[],
  key: string,
  patch: Partial<OfficeRoom>,
): OfficeRoom[] {
  return rooms.map((r) => (r.key === key ? clampRoomRect({ ...r, ...patch }) : r));
}

// --- Floor CRUD (operate on OfficeFloor[]) ---------------------------------

/** Mint a `floor-${n}` id unique within the building. */
function nextFloorId(floors: OfficeFloor[]): string {
  const used = new Set(floors.map((f) => f.id));
  let i = floors.length + 1;
  let id = `floor-${i}`;
  while (used.has(id)) id = `floor-${++i}`;
  return id;
}

/** Re-number `level` to match array order (0-based), leaving order intact. */
function relevel(floors: OfficeFloor[]): OfficeFloor[] {
  return floors.map((f, i) => (f.level === i ? f : { ...f, level: i }));
}

/** Deep-copy a floor's rooms: fresh keys and fresh object ids per room. */
function cloneRooms(rooms: OfficeRoom[]): OfficeRoom[] {
  const out: OfficeRoom[] = [];
  for (const r of rooms) {
    out.push({
      ...r,
      key: nextRoomKey(out, r.type ?? "room"),
      ...(r.objects ? { objects: cloneObjects(r.objects) } : {}),
    });
  }
  return out;
}

/**
 * Append an empty new floor with a unique id (`floor-${n}`) and the next level.
 * Returns a new array.
 */
export function addFloor(floors: OfficeFloor[], name?: string): OfficeFloor[] {
  const level = floors.length;
  const floor: OfficeFloor = {
    id: nextFloorId(floors),
    name: name?.trim() || `Level ${level + 1}`,
    level,
    rooms: [],
  };
  return [...floors, floor];
}

/**
 * Remove a floor by id, but never the last remaining floor (returns the input
 * unchanged if it is the only one, or if `id` is absent). Re-numbers levels.
 */
export function deleteFloor(floors: OfficeFloor[], id: string): OfficeFloor[] {
  if (floors.length <= 1) return floors;
  if (!floors.some((f) => f.id === id)) return floors;
  return relevel(floors.filter((f) => f.id !== id));
}

/** Rename a floor by id (no-op if absent). Returns a new array. */
export function renameFloor(
  floors: OfficeFloor[],
  id: string,
  name: string,
): OfficeFloor[] {
  return floors.map((f) => (f.id === id ? { ...f, name } : f));
}

/**
 * Deep-clone a floor (fresh room keys / object ids, copied zones) as a new floor
 * with a unique id and "(copy)" name, inserted immediately after the source.
 * No-op if absent. Levels are re-numbered.
 */
export function duplicateFloor(floors: OfficeFloor[], id: string): OfficeFloor[] {
  const idx = floors.findIndex((f) => f.id === id);
  if (idx === -1) return floors;
  const src = floors[idx];
  const clone: OfficeFloor = {
    id: nextFloorId(floors),
    name: `${src.name} (copy)`,
    level: idx + 1, // provisional; relevel fixes it
    rooms: cloneRooms(src.rooms),
    ...(src.zones
      ? {
          zones: src.zones.map((z) => ({
            ...z,
            ...(z.payload ? { payload: { ...z.payload } } : {}),
          })),
        }
      : {}),
  };
  const next = [...floors.slice(0, idx + 1), clone, ...floors.slice(idx + 1)];
  return relevel(next);
}

/**
 * Reorder a floor one slot within the building and re-number levels. "up" moves
 * it earlier in the list (toward level 0), "down" moves it later. No-op if the
 * floor is absent or already at the relevant end. Returns a new array.
 */
export function moveFloor(
  floors: OfficeFloor[],
  id: string,
  dir: "up" | "down",
): OfficeFloor[] {
  const idx = floors.findIndex((f) => f.id === id);
  if (idx === -1) return floors;
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= floors.length) return floors;
  const next = [...floors];
  [next[idx], next[swap]] = [next[swap], next[idx]];
  return relevel(next);
}
