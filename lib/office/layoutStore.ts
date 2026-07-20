// Persisted, editable Virtual Office layout — the serialization/validation layer
// between the Supabase `office_layouts` row (jsonb) and the renderer/presence
// code, which read `OfficeRoom` geometry from `lib/office/layout`.
//
// This module is pure and DOM-free so it is unit-testable and safe to import in
// both server actions and the client editor. It NEVER throws: untrusted input
// (a stale row, a malformed client payload, a hand-edited jsonb) is coerced into
// a safe `OfficeLayoutData` that always has a `commons` room and the four hub
// rooms, with every rectangle clamped inside the office floor.
import {
  ROOMS,
  OFFICE_COLS,
  OFFICE_ROWS,
  type OfficeRoom,
  type OfficeObject,
  type RoomType,
} from "./layout";
import type { Hub } from "@/lib/supabase/database.types";

/** Valid object kinds, mirrored from {@link OfficeObject}. */
const OBJECT_KINDS = new Set<OfficeObject["kind"]>([
  "desk",
  "plant",
  "whiteboard",
  "couch",
  "table",
  "screen",
]);

/** Valid room types, mirrored from {@link RoomType}. */
const ROOM_TYPE_SET = new Set<RoomType>([
  "hub",
  "meeting",
  "focus",
  "private",
  "social",
  "commons",
]);

/** Fallback room type for custom rooms with no default and no valid `type`. */
const DEFAULT_ROOM_TYPE: RoomType = "focus";

/** Bumped when the persisted shape changes so future migrations can branch. */
export const LAYOUT_VERSION = 1;

export interface OfficeLayoutData {
  version: number;
  rooms: OfficeRoom[];
}

/**
 * The four hub rooms plus the Commons are structural: the renderer seats agents
 * in them (`agentDesks`) and humans spawn in the Commons, so a layout is only
 * valid if all five exist. They cannot be deleted in the editor.
 */
export const CORE_ROOM_KEYS = [
  "build",
  "source",
  "run",
  "execute",
  "commons",
] as const;

/** Default rooms keyed for quick fallback of any missing/invalid core room. */
const DEFAULT_ROOM_BY_KEY: Record<string, OfficeRoom> = Object.fromEntries(
  ROOMS.map((r) => [r.key, r]),
);

/** The built-in map, derived from the current static `ROOMS`. */
export const DEFAULT_LAYOUT: OfficeLayoutData = {
  version: LAYOUT_VERSION,
  rooms: ROOMS.map(cloneRoom),
};

function cloneRoom(room: OfficeRoom): OfficeRoom {
  return { ...room };
}

/** Minimum room extent (tiles) so a room is always visible/usable. */
const MIN_SIZE = 2;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function toNumber(v: unknown, fallback: number): number {
  return isFiniteNumber(v) ? v : fallback;
}

/** A #rgb or #rrggbb hex color, else the fallback. */
function toAccent(v: unknown, fallback: string): string {
  return typeof v === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)
    ? v
    : fallback;
}

/** Coerce a value into a valid {@link RoomType}, else the room's default. */
function toRoomType(v: unknown, fallback: RoomType): RoomType {
  return typeof v === "string" && ROOM_TYPE_SET.has(v as RoomType)
    ? (v as RoomType)
    : fallback;
}

/**
 * Validate & clamp an untrusted `objects` value into safe {@link OfficeObject}s:
 * each must have a valid `kind`; positions are clamped inside the office floor;
 * ids are coerced to non-empty strings and de-duplicated (later dupes dropped).
 * Returns `undefined` when there is nothing to store so backward-compatible
 * layouts (which omit `objects`) round-trip byte-for-byte.
 */
function parseObjects(raw: unknown): OfficeObject[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const objects: OfficeObject[] = [];
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const o = entry as Record<string, unknown>;
    if (typeof o.kind !== "string" || !OBJECT_KINDS.has(o.kind as OfficeObject["kind"])) {
      return;
    }
    let id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id) id = `obj-${i}`;
    if (seen.has(id)) return;
    seen.add(id);
    objects.push({
      id,
      kind: o.kind as OfficeObject["kind"],
      x: Math.min(Math.max(toNumber(o.x, 0), 0), OFFICE_COLS),
      y: Math.min(Math.max(toNumber(o.y, 0), 0), OFFICE_ROWS),
    });
  });
  return objects.length > 0 ? objects : undefined;
}

/**
 * Clamp a room rectangle fully inside the office floor: size is bounded to the
 * floor and at least MIN_SIZE, then the origin is pulled in so `x+w`/`y+h` never
 * exceed the bounds. Coordinates are kept as-is (floats allowed) — rounding is
 * `serializeLayout`'s job.
 */
function clampRoomRect(room: OfficeRoom): OfficeRoom {
  const w = Math.min(Math.max(toNumber(room.w, MIN_SIZE), MIN_SIZE), OFFICE_COLS);
  const h = Math.min(Math.max(toNumber(room.h, MIN_SIZE), MIN_SIZE), OFFICE_ROWS);
  const x = Math.min(Math.max(toNumber(room.x, 0), 0), OFFICE_COLS - w);
  const y = Math.min(Math.max(toNumber(room.y, 0), 0), OFFICE_ROWS - h);
  return { ...room, x, y, w, h };
}

/**
 * Coerce one untrusted value into a valid `OfficeRoom`, or null if it lacks a
 * usable string `key`. The default room for that key (when it is a core room)
 * supplies fallbacks for any missing field so partial edits stay safe.
 */
function parseRoom(raw: unknown): OfficeRoom | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === "string" ? r.key.trim() : "";
  if (!key) return null;

  const base = DEFAULT_ROOM_BY_KEY[key];
  const label =
    typeof r.label === "string" && r.label.trim()
      ? r.label.trim()
      : base?.label ?? key;
  const hub: Hub | null = base
    ? base.hub
    : typeof r.hub === "string"
      ? (r.hub as Hub)
      : null;
  const purpose =
    typeof r.purpose === "string" ? r.purpose : base?.purpose ?? "";
  const approvalGated =
    typeof r.approvalGated === "boolean"
      ? r.approvalGated
      : base?.approvalGated;

  const room: OfficeRoom = {
    key,
    label,
    hub,
    x: toNumber(r.x, base?.x ?? 0),
    y: toNumber(r.y, base?.y ?? 0),
    w: toNumber(r.w, base?.w ?? MIN_SIZE),
    h: toNumber(r.h, base?.h ?? MIN_SIZE),
    accent: toAccent(r.accent, base?.accent ?? "#d4a82a"),
    purpose,
    type: toRoomType(r.type, base?.type ?? DEFAULT_ROOM_TYPE),
  };
  if (approvalGated !== undefined) room.approvalGated = approvalGated;

  const objects = parseObjects(r.objects);
  if (objects) room.objects = objects;

  return clampRoomRect(room);
}

/**
 * Validate & normalize an untrusted layout value into a safe `OfficeLayoutData`.
 * Invalid rooms are dropped, duplicate keys collapse to the first seen, every
 * rectangle is clamped into the floor, and any missing core room (the four hubs
 * + Commons) is restored from the defaults. Never throws.
 */
export function parseLayout(raw: unknown): OfficeLayoutData {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawRooms = Array.isArray(source.rooms) ? source.rooms : [];

  const seen = new Set<string>();
  const rooms: OfficeRoom[] = [];
  for (const entry of rawRooms) {
    const room = parseRoom(entry);
    if (!room || seen.has(room.key)) continue;
    seen.add(room.key);
    rooms.push(room);
  }

  // Guarantee the structural rooms exist, restoring defaults for any missing.
  for (const key of CORE_ROOM_KEYS) {
    if (seen.has(key)) continue;
    const fallback = DEFAULT_ROOM_BY_KEY[key];
    if (fallback) {
      seen.add(key);
      rooms.push(cloneRoom(fallback));
    }
  }

  return {
    version: toNumber(source.version, LAYOUT_VERSION),
    rooms,
  };
}

/** Round a coordinate to 0.1-tile precision for stable jsonb storage. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Produce a normalized, rounded layout ready to write to jsonb. Runs the input
 * through `parseLayout` first so a serialized layout is always valid, then
 * rounds coordinates to keep the stored payload tidy and diff-friendly.
 */
export function serializeLayout(data: OfficeLayoutData): OfficeLayoutData {
  const safe = parseLayout(data);
  return {
    version: LAYOUT_VERSION,
    rooms: safe.rooms.map((room) => ({
      ...room,
      x: round(room.x),
      y: round(room.y),
      w: round(room.w),
      h: round(room.h),
      // Only rewrite `objects` when present, so object-free layouts stay byte-
      // identical after a round-trip.
      ...(room.objects
        ? {
            objects: room.objects.map((o) => ({
              ...o,
              x: round(o.x),
              y: round(o.y),
            })),
          }
        : {}),
    })),
  };
}
