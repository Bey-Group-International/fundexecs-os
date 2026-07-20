// Pure, DOM-free geometry helpers for the drag-on-canvas MapMaker. Everything
// here operates in TILE space (floats allowed) and is side-effect-free so the
// canvas editor stays a thin rendering shell over unit-testable logic. Mirrors
// the clamping rules of `layoutStore` (min room size, floor bounds) so an edit
// made here survives serialization unchanged.
import {
  OFFICE_COLS,
  OFFICE_ROWS,
  type OfficeObject,
  type OfficeRoom,
  type RoomType,
} from "./layout";

/** Minimum room extent (tiles) — matches `layoutStore`'s MIN_SIZE. */
export const MIN_ROOM_SIZE = 2;

/** Palette of placeable objects: kind → human label + emoji glyph. */
export const OBJECT_CATALOG: readonly {
  kind: OfficeObject["kind"];
  label: string;
  emoji: string;
}[] = [
  { kind: "desk", label: "Desk", emoji: "🪑" },
  { kind: "plant", label: "Plant", emoji: "🪴" },
  { kind: "whiteboard", label: "Whiteboard", emoji: "📝" },
  { kind: "couch", label: "Couch", emoji: "🛋️" },
  { kind: "table", label: "Table", emoji: "🍽️" },
  { kind: "screen", label: "Screen", emoji: "🖥️" },
];

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
  const obj: OfficeObject = {
    id: nextObjectId(objects, kind),
    kind,
    x: clamp(x, room.x, room.x + room.w),
    y: clamp(y, room.y, room.y + room.h),
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
