// Walls, doorways, collision, and room theming for the Virtual Office.
//
// Pure geometry (no DOM): the shell wires `resolveMovement` into its movement
// loop and the renderer draws the walls/doorways/themed floors. Everything is
// in TILE space (the same coordinate system as `layout.ts`), so it is fully
// unit-testable without a canvas.
//
// The floor is a cross: four hub rooms in the corners (left rooms span the left
// band, right rooms the right band) with a Commons down the middle column and a
// ~1-tile corridor between rooms. Doorways open toward that central corridor so
// avatars can travel room-to-room: left-of-Commons rooms open on their right
// edge, right-of-Commons rooms on their left edge, and the Commons opens on both
// sides, one gap facing each hub room.
import type { OfficeRoom } from "./layout";

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

type Side = "left" | "right";

function commonsOf(rooms: OfficeRoom[]): OfficeRoom | undefined {
  return rooms.find((r) => r.type === "commons" || r.key === "commons");
}

/** Which side of the Commons a room sits on (by horizontal center). */
function sideOfCommons(room: OfficeRoom, commons: OfficeRoom): Side {
  const roomCenter = room.x + room.w / 2;
  const commonsCenter = commons.x + commons.w / 2;
  return roomCenter < commonsCenter ? "left" : "right";
}

/**
 * A doorway on `room`'s edge facing the Commons, centered vertically on that
 * edge. Left-of-Commons rooms open on their right edge; right-of-Commons rooms
 * open on their left edge.
 */
function doorwayFacingCommons(room: OfficeRoom, commons: OfficeRoom): Doorway {
  const side = sideOfCommons(room, commons);
  const edgeX = side === "left" ? room.x + room.w : room.x;
  const cy = room.y + room.h / 2;
  return {
    x: edgeX - WALL_THICKNESS / 2,
    y: cy - DOOR_WIDTH / 2,
    w: WALL_THICKNESS,
    h: DOOR_WIDTH,
    roomKey: room.key,
  };
}

/**
 * A doorway on the Commons' edge that faces `room`, aligned vertically with
 * `room`'s own doorway so the two openings line up across the corridor.
 */
function commonsDoorwayFacing(commons: OfficeRoom, room: OfficeRoom): Doorway {
  const side = sideOfCommons(room, commons);
  const edgeX = side === "left" ? commons.x : commons.x + commons.w;
  const cy = room.y + room.h / 2;
  return {
    x: edgeX - WALL_THICKNESS / 2,
    y: cy - DOOR_WIDTH / 2,
    w: WALL_THICKNESS,
    h: DOOR_WIDTH,
    roomKey: commons.key,
  };
}

/**
 * The doorway for a room. Hub rooms get a single opening toward the Commons;
 * the Commons returns its primary opening (facing the first hub room) —
 * {@link buildWalls} adds the remaining Commons openings, one per hub room.
 */
export function doorwayFor(room: OfficeRoom, rooms: OfficeRoom[]): Doorway {
  const commons = commonsOf(rooms);
  if (!commons) {
    // No Commons in the set: fall back to a right-edge opening.
    const cy = room.y + room.h / 2;
    return {
      x: room.x + room.w - WALL_THICKNESS / 2,
      y: cy - DOOR_WIDTH / 2,
      w: WALL_THICKNESS,
      h: DOOR_WIDTH,
      roomKey: room.key,
    };
  }
  if (room.key === commons.key) {
    const firstHub = rooms.find((r) => r.key !== commons.key);
    return commonsDoorwayFacing(commons, firstHub ?? commons);
  }
  return doorwayFacingCommons(room, commons);
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
 * openings are passable. The Commons receives one opening per hub room.
 */
export function buildWalls(rooms: OfficeRoom[]): {
  walls: Wall[];
  doorways: Doorway[];
} {
  const commons = commonsOf(rooms);
  const doorways: Doorway[] = [];

  for (const room of rooms) {
    if (commons && room.key === commons.key) {
      for (const other of rooms) {
        if (other.key === commons.key) continue;
        doorways.push(commonsDoorwayFacing(commons, other));
      }
    } else {
      doorways.push(doorwayFor(room, rooms));
    }
  }

  const walls: Wall[] = [];
  for (const room of rooms) {
    const roomDoors = doorways.filter((d) => d.roomKey === room.key);
    walls.push(...edgesForRoom(room, roomDoors));
  }

  return { walls, doorways };
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
 * Axis-separated slide collision. Resolve the X move first (clamped against any
 * wall face it would cross), then the Y move independently at the resolved X, so
 * avatars slide along walls, pass cleanly through doorway gaps, and never tunnel
 * through a thin wall at normal speeds.
 */
export function resolveMovement(
  prev: { x: number; y: number },
  next: { x: number; y: number },
  walls: Wall[],
  radius: number = DEFAULT_RADIUS,
): { x: number; y: number } {
  const x = moveX(prev.x, next.x, prev.y, walls, radius);
  const y = moveY(prev.y, next.y, x, walls, radius);
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
      case "meeting":
        floor = "carpet";
        break;
      case "focus":
        floor = "wood";
        break;
      case "private":
        floor = "tile";
        break;
      case "social":
        floor = "carpet";
        break;
      default:
        floor = "grid";
    }
  }

  const rug =
    room.type === "social" ||
    room.type === "commons" ||
    room.type === "meeting" ||
    room.key === "commons";

  return { floor, wall: shade(room.accent), rug };
}
