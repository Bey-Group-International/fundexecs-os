/**
 * FundExecs OS — 2D-office → 3D-scene geometry (pure, testable).
 *
 * The `ThreeOfficeRenderer` needs the office laid out in 3D world units, but
 * the authoritative layout lives in the 2D data (`ROOMS`, `ROOM_W/H`, walls,
 * `WORKSTATIONS`) that the Phaser floor already reads. This module is the
 * single place that translates that 2D pixel data into 3D transforms, and it
 * imports NO Three.js and touches NO DOM — so the mapping is unit-testable and
 * the two renderers provably stay congruent (same rooms, same doors, same
 * desks, just projected onto the X-Z plane instead of a top-down canvas).
 *
 * ── Coordinate mapping ────────────────────────────────────────────────────
 * 2D is a top-down pixel plane: `+x` right, `+y` DOWN. 3D is the floor X-Z
 * plane with `+Y` up:
 *
 *     world2D (px)  ( x , y )  →  world3D (units)  ( x·S , 0 , y·S )
 *
 * where `S = PX_TO_WORLD`. Depth that the 2D floor faked with `yDepth(footY)`
 * becomes real GPU depth. A four-way facing maps to a yaw about `+Y`.
 */

import {
  ROOMS,
  ROOM_W,
  ROOM_H,
  GRID_COLS,
  TOTAL_ROWS,
  WORLD_W,
  WORLD_H,
  WALL_THICKNESS,
  DOOR_GAP,
} from "../types";
import type { ActorFacing } from "./OfficeRenderer";

/** Pixels → world units. One 32px tile = 1 unit, matching the Three scaffold. */
export const PX_TO_WORLD = 1 / 32;

/** A box in 3D world units: center on the floor plane + full extents. */
export type Box3D = {
  /** Center X (world units). */
  cx: number;
  /** Center Z (world units) — the 2D `+y` axis. */
  cz: number;
  /** Full width along X. */
  width: number;
  /** Full depth along Z. */
  depth: number;
  /** Full height along Y. */
  height: number;
};

/** A desk slot plus the seat in front of it, in world units. */
export type Workstation3D = {
  roomKey: string;
  desk: Box3D;
  /** Seat center (where an actor sits), world units on the floor plane. */
  seat: { x: number; z: number };
};

/** Convert a top-down pixel point to a floor-plane world point. */
export function worldOf(x: number, y: number): { x: number; z: number } {
  return { x: x * PX_TO_WORLD, z: y * PX_TO_WORLD };
}

/** Map a floor-plane world point back to top-down pixels (for pointer hits). */
export function pixelsOf(x: number, z: number): { x: number; y: number } {
  return { x: x / PX_TO_WORLD, y: z / PX_TO_WORLD };
}

/**
 * Facing → yaw about +Y (radians). "down" faces the camera (+Z), "up" away
 * (−Z), "left"/"right" ±90°. Matches the 2D convention where "down" is toward
 * the viewer.
 */
export function yawOf(facing: ActorFacing): number {
  switch (facing) {
    case "down":
      return 0;
    case "up":
      return Math.PI;
    case "left":
      return Math.PI / 2;
    case "right":
      return -Math.PI / 2;
  }
}

/** Overall floor plane size in world units. */
export function floorSize(): { width: number; depth: number } {
  return { width: WORLD_W * PX_TO_WORLD, depth: WORLD_H * PX_TO_WORLD };
}

/** Center of the whole floor, world units — the default camera look-at. */
export function floorCenter(): { x: number; z: number } {
  return { x: (WORLD_W / 2) * PX_TO_WORLD, z: (WORLD_H / 2) * PX_TO_WORLD };
}

/**
 * The floor rectangle for one room, world units. Honors `colSpan` so the
 * full-width Marketplace hall is one wide tile, exactly like the 2D floor.
 */
export function roomFloor(roomKey: string): Box3D | null {
  const room = ROOMS.find((r) => r.key === roomKey);
  if (!room) return null;
  const cols = room.colSpan ?? 1;
  const w = ROOM_W * cols;
  const ox = room.col * ROOM_W;
  const oy = room.row * ROOM_H;
  return {
    cx: (ox + w / 2) * PX_TO_WORLD,
    cz: (oy + ROOM_H / 2) * PX_TO_WORLD,
    width: w * PX_TO_WORLD,
    depth: ROOM_H * PX_TO_WORLD,
    height: 0,
  };
}

/** Every room's floor rectangle, in `ROOMS` order. */
export function roomFloors(): Array<{ roomKey: string; box: Box3D }> {
  const out: Array<{ roomKey: string; box: Box3D }> = [];
  for (const room of ROOMS) {
    const box = roomFloor(room.key);
    if (box) out.push({ roomKey: room.key, box });
  }
  return out;
}

/** Center of a room on the floor plane — the `focusRoom` camera target. */
export function roomCenterWorld(roomKey: string): { x: number; z: number } | null {
  const box = roomFloor(roomKey);
  return box ? { x: box.cx, z: box.cz } : null;
}

/** A room's display label + where to float its 3D signage (room center, world). */
export type RoomLabelAnchor = { roomKey: string; label: string; x: number; z: number };

/** Per-room signage anchors: the department name at each room's center. */
export function roomLabelAnchors(): RoomLabelAnchor[] {
  const out: RoomLabelAnchor[] = [];
  for (const room of ROOMS) {
    const center = roomCenterWorld(room.key);
    if (center) out.push({ roomKey: room.key, label: room.label, x: center.x, z: center.z });
  }
  return out;
}

const WALL_HEIGHT_PX = 40; // extruded wall height; reads as a partition, not a silo

/**
 * The partition-wall segments as 3D boxes, split around each `DOOR_GAP` so the
 * doorways line up with the 2D collision model. Mirrors the perimeter +
 * internal-wall loops in `officeEnvironment.createWallVisuals` / the scene's
 * `_createWalls`, so a door in 2D is a door in 3D.
 */
export function wallSegments(): Box3D[] {
  const segments: Box3D[] = [];
  const W = WALL_THICKNESS;
  const DG = DOOR_GAP;
  const H = WALL_HEIGHT_PX;

  const hWall = (x: number, y: number, w: number) => {
    if (w <= 0) return;
    segments.push({
      cx: (x + w / 2) * PX_TO_WORLD,
      cz: (y + W / 2) * PX_TO_WORLD,
      width: w * PX_TO_WORLD,
      depth: W * PX_TO_WORLD,
      height: H * PX_TO_WORLD,
    });
  };
  const vWall = (x: number, y: number, h: number) => {
    if (h <= 0) return;
    segments.push({
      cx: (x + W / 2) * PX_TO_WORLD,
      cz: (y + h / 2) * PX_TO_WORLD,
      width: W * PX_TO_WORLD,
      depth: h * PX_TO_WORLD,
      height: H * PX_TO_WORLD,
    });
  };

  // Perimeter.
  hWall(0, 0, WORLD_W);
  hWall(0, WORLD_H - W, WORLD_W);
  vWall(0, 0, WORLD_H);
  vWall(WORLD_W - W, 0, WORLD_H);

  // Internal horizontal walls (between rows), split around the door gap.
  for (let r = 1; r < TOTAL_ROWS; r++) {
    const wallY = r * ROOM_H - W / 2;
    for (let c = 0; c < GRID_COLS; c++) {
      const wallX = c * ROOM_W;
      const doorCenter = wallX + ROOM_W / 2;
      hWall(wallX, wallY, doorCenter - DG / 2 - wallX);
      const rightStart = doorCenter + DG / 2;
      hWall(rightStart, wallY, wallX + ROOM_W - rightStart);
    }
  }

  // Internal vertical walls (between columns), split around the door gap.
  // Capped at the office grid rows so the wide Marketplace hall has no column
  // dividers (GRID_ROWS === TOTAL_ROWS - 1).
  for (let c = 1; c < GRID_COLS; c++) {
    const wallX = c * ROOM_W - W / 2;
    for (let r = 0; r < TOTAL_ROWS - 1; r++) {
      const wallY = r * ROOM_H;
      const doorCenter = wallY + ROOM_H / 2;
      vWall(wallX, wallY, doorCenter - DG / 2 - wallY);
      const botStart = doorCenter + DG / 2;
      vWall(wallX, botStart, wallY + ROOM_H - botStart);
    }
  }

  return segments;
}

// Desk workstations per room, room-relative seat pixels — kept in sync with
// `officeEnvironment.WORKSTATIONS` (the 2D floor's desk banks). Duplicated here
// rather than imported because that module pulls in Phaser at import time.
const WORKSTATIONS: Record<string, Array<{ sx: number; sy: number }>> = {
  ceo: [{ sx: 78, sy: 80 }, { sx: 306, sy: 80 }, { sx: 78, sy: 214 }],
  boardroom: [{ sx: 74, sy: 84 }, { sx: 310, sy: 84 }],
  trading: [{ sx: 78, sy: 80 }, { sx: 306, sy: 80 }, { sx: 78, sy: 214 }],
  research: [{ sx: 78, sy: 80 }, { sx: 306, sy: 80 }, { sx: 78, sy: 214 }],
  office: [{ sx: 78, sy: 80 }, { sx: 306, sy: 80 }, { sx: 78, sy: 214 }, { sx: 306, sy: 214 }],
  ops: [{ sx: 78, sy: 80 }, { sx: 306, sy: 80 }, { sx: 78, sy: 214 }],
  legal: [{ sx: 78, sy: 80 }, { sx: 306, sy: 80 }, { sx: 78, sy: 214 }],
  marketing: [{ sx: 78, sy: 80 }, { sx: 306, sy: 80 }, { sx: 78, sy: 214 }],
  reception: [{ sx: 306, sy: 80 }, { sx: 306, sy: 214 }],
};

const DESK_W_PX = 46;
const DESK_D_PX = 14;
const DESK_H_PX = 18;
const DESK_DY_PX = 13; // desk sits this far in front (+y) of the seat, as in 2D

/**
 * Every desk workstation on the floor as a 3D desk box + seat point. Reads the
 * same per-room seat table the 2D floor uses, so a desk in one renderer is a
 * desk in the other.
 */
export function workstations3D(): Workstation3D[] {
  const out: Workstation3D[] = [];
  for (const room of ROOMS) {
    const ox = room.col * ROOM_W;
    const oy = room.row * ROOM_H;
    for (const w of WORKSTATIONS[room.key] ?? []) {
      const seatX = ox + w.sx;
      const seatY = oy + w.sy;
      const deskY = seatY + DESK_DY_PX;
      out.push({
        roomKey: room.key,
        seat: worldOf(seatX, seatY),
        desk: {
          cx: seatX * PX_TO_WORLD,
          cz: deskY * PX_TO_WORLD,
          width: DESK_W_PX * PX_TO_WORLD,
          depth: DESK_D_PX * PX_TO_WORLD,
          height: DESK_H_PX * PX_TO_WORLD,
        },
      });
    }
  }
  return out;
}

/** Per-department accent color (hex string), mirroring the 2D `ROOM_ACCENT`. */
const ROOM_ACCENT: Record<string, string> = {
  ceo: "#c9a84c",
  boardroom: "#a855f7",
  trading: "#38bdf8",
  research: "#38bdf8",
  office: "#ec4899",
  ops: "#22c55e",
  legal: "#ef4444",
  marketing: "#14b8a6",
  reception: "#f59e0b",
  marketplace: "#2dd4bf",
};

/** The department accent for a room key (gold fallback), as a hex string. */
export function roomAccentHex(roomKey: string): string {
  return ROOM_ACCENT[roomKey] ?? "#c9a84c";
}
