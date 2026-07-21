// Walls, doorways, collision, and room theming for the Virtual Office.
//
// Pure geometry (no DOM): the shell wires `resolveMovement` into its movement
// loop and the renderer draws the walls/doorways/themed floors. Everything is
// in TILE space (the same coordinate system as `layout.ts`), so it is fully
// unit-testable without a canvas.
//
// The doorway placement is layout-agnostic: for an arbitrary set of
// non-overlapping rooms it opens a passable gap on every room edge that faces a
// corridor (open floor between rooms), guaranteeing each room at least one
// reachable door regardless of how the map has been redesigned or hand-edited.
import {
  OFFICE_COLS,
  OFFICE_ROWS,
  type OfficeObjectKind,
  type OfficeRoom,
} from "./layout";
import { furnishRoom, PROP_SIZE } from "./furnish";

/** A thin, axis-aligned wall segment (tile space, top-left origin). */
export interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A passable opening cut into a room's wall, tagged with its room. */
export interface Doorway {
  x: number;
  y: number;
  w: number;
  h: number;
  roomKey: string;
}

/** Wall thickness in tiles (thin barriers straddling the room boundary line). */
const WALL_THICKNESS = 0.3;
/** Width of a doorway opening along the room edge, in tiles (~2 tiles). */
const DOOR_WIDTH = 2;
/** Default avatar collision radius in tiles. */
const DEFAULT_RADIUS = 0.3;
/** Float tolerance for edge/gap matching. */
const EPS = 1e-6;
/** How far outside an edge to sample for open (corridor) floor, in tiles. */
const PROBE = 0.5;
/** Keep doors off the outer floor margin (a border edge is never a corridor). */
const BORDER_MARGIN = 0.75;
/**
 * How far to shrink a furniture footprint before turning it into a collider, in
 * tiles per side, so an avatar can stand right up against the piece without the
 * inset AABB shoving it away.
 */
const FURNITURE_INSET = 0.15;
/**
 * Broadphase padding (tiles) added around the swept move box when culling walls.
 * Must comfortably exceed the avatar radius so the narrow-phase never misses a
 * wall the cull dropped; the outcome is identical to testing every wall.
 */
const BROADPHASE_MARGIN = 0.5;

type Edge = "left" | "right" | "top" | "bottom";

/** Is a point inside a room rectangle (with a small inward tolerance)? */
function pointInRoom(x: number, y: number, room: OfficeRoom): boolean {
  return (
    x > room.x + EPS &&
    x < room.x + room.w - EPS &&
    y > room.y + EPS &&
    y < room.y + room.h - EPS
  );
}

/** The point just outside `room`'s `edge`, at the middle of that edge. */
function probePoint(room: OfficeRoom, edge: Edge): { x: number; y: number } {
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  switch (edge) {
    case "left":
      return { x: room.x - PROBE, y: cy };
    case "right":
      return { x: room.x + room.w + PROBE, y: cy };
    case "top":
      return { x: cx, y: room.y - PROBE };
    case "bottom":
      return { x: cx, y: room.y + room.h + PROBE };
  }
}

/**
 * Does `edge` face a corridor — open floor between this room and the next? True
 * when the point just outside the edge lies within the interior floor (not the
 * outer margin) and inside no other room.
 */
function edgeFacesCorridor(
  room: OfficeRoom,
  edge: Edge,
  rooms: OfficeRoom[],
): boolean {
  const p = probePoint(room, edge);
  if (
    p.x < BORDER_MARGIN ||
    p.x > OFFICE_COLS - BORDER_MARGIN ||
    p.y < BORDER_MARGIN ||
    p.y > OFFICE_ROWS - BORDER_MARGIN
  ) {
    return false;
  }
  return !rooms.some((r) => r.key !== room.key && pointInRoom(p.x, p.y, r));
}

/** A doorway rect centered on `room`'s `edge`, spanning ~{@link DOOR_WIDTH}. */
function doorwayOnEdge(room: OfficeRoom, edge: Edge): Doorway {
  const t = WALL_THICKNESS;
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  // Keep the opening within the edge span for short edges.
  const half = Math.min(DOOR_WIDTH, Math.min(room.w, room.h)) / 2;
  switch (edge) {
    case "left":
      return { x: room.x - t / 2, y: cy - half, w: t, h: half * 2, roomKey: room.key };
    case "right":
      return { x: room.x + room.w - t / 2, y: cy - half, w: t, h: half * 2, roomKey: room.key };
    case "top":
      return { x: cx - half, y: room.y - t / 2, w: half * 2, h: t, roomKey: room.key };
    case "bottom":
      return { x: cx - half, y: room.y + room.h - t / 2, w: half * 2, h: t, roomKey: room.key };
  }
}

/**
 * Edges of `room` in placement-preference order: the horizontal edge facing the
 * office center first (corridors run as vertical bands, so side doors read best),
 * then its opposite, then the vertical edges. Deterministic for a given layout.
 */
function preferredEdges(room: OfficeRoom): Edge[] {
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  const towardX: Edge = cx < OFFICE_COLS / 2 ? "right" : "left";
  const awayX: Edge = towardX === "right" ? "left" : "right";
  const towardY: Edge = cy < OFFICE_ROWS / 2 ? "bottom" : "top";
  const awayY: Edge = towardY === "bottom" ? "top" : "bottom";
  return [towardX, awayX, towardY, awayY];
}

/**
 * Every corridor-facing doorway for a room, in preference order. Guarantees at
 * least one opening: if no edge faces a corridor (a fully enclosed room), it
 * falls back to a single door on the most-preferred edge so the room is never
 * sealed off.
 */
export function doorwaysForRoom(room: OfficeRoom, rooms: OfficeRoom[]): Doorway[] {
  const edges = preferredEdges(room);
  const open = edges.filter((e) => edgeFacesCorridor(room, e, rooms));
  const chosen = open.length > 0 ? open : [edges[0]];
  return chosen.map((e) => doorwayOnEdge(room, e));
}

/**
 * The primary doorway for a room — the most-preferred corridor-facing opening.
 * Layout-agnostic: works for the built-in plan and any custom/hand-edited map.
 */
export function doorwayFor(room: OfficeRoom, rooms: OfficeRoom[]): Doorway {
  return doorwaysForRoom(room, rooms)[0];
}

/** Remaining sub-intervals of [start, end] after removing `gaps`. */
function subtractGaps(
  start: number,
  end: number,
  gaps: Array<[number, number]>,
): Array<[number, number]> {
  let segments: Array<[number, number]> = [[start, end]];
  for (const [gapStart, gapEnd] of gaps) {
    segments = segments.flatMap(([s, e]): Array<[number, number]> => {
      if (gapEnd <= s || gapStart >= e) return [[s, e]];
      const out: Array<[number, number]> = [];
      if (gapStart > s) out.push([s, gapStart]);
      if (gapEnd < e) out.push([gapEnd, e]);
      return out;
    });
  }
  return segments.filter(([s, e]) => e - s > EPS);
}

/** Wall segments for one room's four edges, split around its doorways. */
function edgesForRoom(room: OfficeRoom, doors: Doorway[]): Wall[] {
  const t = WALL_THICKNESS;
  const left = room.x;
  const right = room.x + room.w;
  const top = room.y;
  const bottom = room.y + room.h;
  const walls: Wall[] = [];

  // Vertical edges (left & right), extended by t/2 at each end to close corners.
  for (const edgeX of [left, right]) {
    const gaps = doors
      .filter((d) => Math.abs(d.x + d.w / 2 - edgeX) < 0.01)
      .map((d): [number, number] => [d.y, d.y + d.h]);
    for (const [y0, y1] of subtractGaps(top - t / 2, bottom + t / 2, gaps)) {
      walls.push({ x: edgeX - t / 2, y: y0, w: t, h: y1 - y0 });
    }
  }

  // Horizontal edges (top & bottom), spanning the room width exactly.
  for (const edgeY of [top, bottom]) {
    const gaps = doors
      .filter((d) => Math.abs(d.y + d.h / 2 - edgeY) < 0.01)
      .map((d): [number, number] => [d.x, d.x + d.w]);
    for (const [x0, x1] of subtractGaps(left, right, gaps)) {
      walls.push({ x: x0, y: edgeY - t / 2, w: x1 - x0, h: t });
    }
  }

  return walls;
}

/**
 * Build the full set of wall segments and doorways for a room layout. Each room
 * gets a thin wall along its four edges, split around every doorway so the
 * openings are passable. Every room receives a door on each of its
 * corridor-facing edges (at minimum one), so the whole floor stays connected.
 */
export function buildWalls(rooms: OfficeRoom[]): {
  walls: Wall[];
  doorways: Doorway[];
} {
  const doorways: Doorway[] = [];
  for (const room of rooms) {
    doorways.push(...doorwaysForRoom(room, rooms));
  }

  const walls: Wall[] = [];
  for (const room of rooms) {
    const roomDoors = doorways.filter((d) => d.roomKey === room.key);
    walls.push(...edgesForRoom(room, roomDoors));
  }

  return { walls, doorways };
}

/**
 * Furniture kinds solid enough to block movement. Big, standing pieces an avatar
 * would bump into; everything else (rugs, lamps, wall art, windows, monitors,
 * loose chairs, small plants, whiteboards, screens, the pod shell, images) is
 * walk-through and deliberately absent here.
 */
export const COLLIDABLE_KINDS: Set<OfficeObjectKind> = new Set([
  "desk",
  "meeting_table",
  "couch",
  "armchair",
  "coffee_table",
  "bookshelf",
  "reception_desk",
  "cafe_counter",
  "server_rack",
  "plant_lg",
  "water_cooler",
  "divider",
  "table",
]);

/**
 * Collider walls for every solid piece of furniture across a room set. Each
 * room's objects (its persisted `objects`, else the deterministic
 * {@link furnishRoom} template) are scanned; each {@link COLLIDABLE_KINDS} piece
 * emits a thin-inset AABB centered on the object's anchor, using its footprint
 * (`obj.w/obj.h`, else {@link PROP_SIZE}). The inset lets avatars stand flush
 * against the piece. Pure: same rooms in, same colliders out.
 *
 * Callers feed these into movement alongside the room walls:
 * `resolveMovement(prev, next, [...walls, ...furnitureColliders(rooms)])`.
 */
export function furnitureColliders(rooms: OfficeRoom[]): Wall[] {
  const colliders: Wall[] = [];
  for (const room of rooms) {
    const objects = room.objects ?? furnishRoom(room);
    for (const obj of objects) {
      if (!COLLIDABLE_KINDS.has(obj.kind)) continue;
      const size = PROP_SIZE[obj.kind];
      const w = obj.w ?? size.w;
      const h = obj.h ?? size.h;
      const iw = Math.max(0, w - FURNITURE_INSET * 2);
      const ih = Math.max(0, h - FURNITURE_INSET * 2);
      if (iw <= 0 || ih <= 0) continue;
      colliders.push({
        x: obj.x - w / 2 + FURNITURE_INSET,
        y: obj.y - h / 2 + FURNITURE_INSET,
        w: iw,
        h: ih,
      });
    }
  }
  return colliders;
}

/** Does an avatar circle at (cx, cy) with radius r overlap wall `w` in Y? */
function overlapsY(cy: number, r: number, w: Wall): boolean {
  return cy - r < w.y + w.h - EPS && w.y < cy + r - EPS;
}

/** Does an avatar circle at (cx, cy) with radius r overlap wall `w` in X? */
function overlapsX(cx: number, r: number, w: Wall): boolean {
  return cx - r < w.x + w.w - EPS && w.x < cx + r - EPS;
}

/** Swept clamp of a horizontal move at fixed y, blocking the wall face. */
function moveX(x0: number, x1: number, y: number, walls: Wall[], r: number): number {
  let x = x1;
  for (const w of walls) {
    if (!overlapsY(y, r, w)) continue;
    if (x1 > x0) {
      // Moving right: keep the avatar's right face left of the wall.
      const face = w.x;
      if (x0 + r <= face + EPS && x1 + r > face) x = Math.min(x, face - r);
    } else if (x1 < x0) {
      // Moving left: keep the avatar's left face right of the wall.
      const face = w.x + w.w;
      if (x0 - r >= face - EPS && x1 - r < face) x = Math.max(x, face + r);
    }
  }
  return x;
}

/** Swept clamp of a vertical move at fixed x, blocking the wall face. */
function moveY(y0: number, y1: number, x: number, walls: Wall[], r: number): number {
  let y = y1;
  for (const w of walls) {
    if (!overlapsX(x, r, w)) continue;
    if (y1 > y0) {
      const face = w.y;
      if (y0 + r <= face + EPS && y1 + r > face) y = Math.min(y, face - r);
    } else if (y1 < y0) {
      const face = w.y + w.h;
      if (y0 - r >= face - EPS && y1 - r < face) y = Math.max(y, face + r);
    }
  }
  return y;
}

/**
 * Broadphase cull: the walls whose AABB lies within {@link BROADPHASE_MARGIN} +
 * radius of the swept move box. With many colliders on the floor this skips the
 * far ones cheaply; the retained set is a superset of every wall the axis
 * clamps could touch, so the result is identical to testing all walls.
 */
function nearbyWalls(
  prev: { x: number; y: number },
  next: { x: number; y: number },
  walls: Wall[],
  radius: number,
): Wall[] {
  const pad = radius + BROADPHASE_MARGIN;
  const minX = Math.min(prev.x, next.x) - pad;
  const maxX = Math.max(prev.x, next.x) + pad;
  const minY = Math.min(prev.y, next.y) - pad;
  const maxY = Math.max(prev.y, next.y) + pad;
  return walls.filter(
    (w) =>
      w.x < maxX && w.x + w.w > minX && w.y < maxY && w.y + w.h > minY,
  );
}

/**
 * Axis-separated slide collision. Resolve the X move first (clamped against any
 * wall face it would cross), then the Y move independently at the resolved X, so
 * avatars slide along walls, pass cleanly through doorway gaps, and never tunnel
 * through a thin wall at normal speeds. A broadphase cull first drops walls far
 * from the swept segment, so a floor dense with furniture colliders stays cheap
 * without changing the outcome.
 */
export function resolveMovement(
  prev: { x: number; y: number },
  next: { x: number; y: number },
  walls: Wall[],
  radius: number = DEFAULT_RADIUS,
): { x: number; y: number } {
  const near = nearbyWalls(prev, next, walls, radius);
  const x = moveX(prev.x, next.x, prev.y, near, radius);
  const y = moveY(prev.y, next.y, x, near, radius);
  return { x, y };
}

/** Floor surface treatments the renderer knows how to draw. */
export type FloorStyle = "grid" | "wood" | "carpet" | "tile" | "marble";

/** Deterministic visual theme for a room. */
export interface RoomTheme {
  floor: FloorStyle;
  /** A darker shade of the room accent, as a hex string. */
  wall: string;
  /** Whether the room lays down a rug (social/gathering spaces). */
  rug: boolean;
}

/** Distinct floor per hub so each corner reads differently. */
const HUB_FLOOR: Record<string, FloorStyle> = {
  build: "wood",
  source: "tile",
  run: "grid",
  execute: "carpet",
};

/** Darken a hex accent to a wall shade (deterministic). */
function shade(hex: string, factor = 0.55): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.padStart(6, "0").slice(0, 6);
  const channel = (start: number): string => {
    const v = parseInt(full.slice(start, start + 2), 16);
    const scaled = Number.isNaN(v) ? 0 : Math.round(v * factor);
    return Math.max(0, Math.min(255, scaled)).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/**
 * Deterministic theme for a room, keyed off its `type`/`hub`. Same room always
 * yields the same theme, so every client renders floors identically.
 */
export function roomTheme(room: OfficeRoom): RoomTheme {
  let floor: FloorStyle;
  if (room.type === "commons" || room.key === "commons") {
    floor = "marble";
  } else if (room.hub && HUB_FLOOR[room.hub]) {
    floor = HUB_FLOOR[room.hub];
  } else {
    switch (room.type) {
      case "reception":
        floor = "marble";
        break;
      case "meeting":
        floor = "carpet";
        break;
      case "lounge":
      case "social":
        floor = "carpet";
        break;
      case "cafe":
        floor = "tile";
        break;
      case "pod":
      case "focus":
        floor = "wood";
        break;
      case "private":
        floor = "tile";
        break;
      default:
        floor = "grid";
    }
  }

  const rug =
    room.type === "social" ||
    room.type === "commons" ||
    room.type === "meeting" ||
    room.type === "lounge" ||
    room.type === "reception" ||
    room.key === "commons";

  return { floor, wall: shade(room.accent), rug };
}
