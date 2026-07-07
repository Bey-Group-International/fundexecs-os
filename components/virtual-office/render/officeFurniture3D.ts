/**
 * FundExecs OS — 3D office furniture + room-floor art (pure, testable).
 *
 * Phase 1 of restoring the office look in 3D: turns the 2D floor's per-room
 * furniture (`officeEnvironment.LAYOUT` / lamps / marketplace stalls) into
 * light 3D box assemblies, and maps each room to its background art for a
 * textured floor. Kept Three.js-free and DOM-free so the geometry is
 * unit-testable; the LAYOUT data is duplicated here (not imported) because
 * `officeEnvironment` pulls in Phaser at import time.
 *
 * Coordinate space matches `officeGeometry3D`: a piece placed at 2D pixel
 * (footX, footY) becomes a box standing on the floor at world (footX·S, 0,
 * footY·S), rising in +Y.
 */

import { ROOMS, ROOM_W, ROOM_H } from "../types";
import { PX_TO_WORLD, roomAccentHex, type Box3D } from "./officeGeometry3D";

/** A furniture box: a `Box3D` (world units) plus a fill color. */
export type FurnitureBox = Box3D & { color: string };

// ── Palette (mirrors officeEnvironment's furniture colors) ──────────────────
const C = {
  deskTop: "#2c3444",
  deskFront: "#191e2a",
  wood: "#3a2f2a",
  woodTop: "#4d3f36",
  metal: "#4a5568",
  gold: "#c9a84c",
  leaf: "#2f6b3f",
  screen: "#0a0d13",
  sofa: "#28344a",
} as const;

type PieceType =
  | "desk"
  | "console"
  | "screens"
  | "shelf"
  | "sofa"
  | "table"
  | "plant"
  | "safe"
  | "reception"
  | "coffee"
  | "stall";

type Piece = { type: PieceType; rx: number; ry: number };

// Per-room furniture, room-relative pixels — ported from officeEnvironment.LAYOUT.
const LAYOUT: Record<string, Piece[]> = {
  ceo: [{ type: "console", rx: 96, ry: 52 }, { type: "desk", rx: 300, ry: 60 }, { type: "plant", rx: 40, ry: 232 }],
  boardroom: [{ type: "table", rx: 192, ry: 236 }, { type: "shelf", rx: 70, ry: 50 }, { type: "shelf", rx: 314, ry: 50 }],
  trading: [{ type: "screens", rx: 100, ry: 48 }, { type: "desk", rx: 300, ry: 60 }, { type: "plant", rx: 348, ry: 232 }],
  research: [{ type: "shelf", rx: 68, ry: 50 }, { type: "shelf", rx: 120, ry: 50 }, { type: "desk", rx: 306, ry: 60 }, { type: "plant", rx: 40, ry: 232 }],
  office: [{ type: "desk", rx: 84, ry: 58 }, { type: "desk", rx: 300, ry: 58 }, { type: "plant", rx: 348, ry: 234 }],
  ops: [{ type: "screens", rx: 100, ry: 48 }, { type: "desk", rx: 300, ry: 60 }, { type: "coffee", rx: 344, ry: 150 }, { type: "plant", rx: 40, ry: 232 }],
  legal: [{ type: "shelf", rx: 66, ry: 50 }, { type: "shelf", rx: 300, ry: 50 }, { type: "desk", rx: 110, ry: 232 }],
  marketing: [{ type: "safe", rx: 84, ry: 58 }, { type: "desk", rx: 300, ry: 60 }, { type: "plant", rx: 40, ry: 232 }],
  reception: [{ type: "reception", rx: 96, ry: 54 }, { type: "coffee", rx: 344, ry: 150 }, { type: "plant", rx: 40, ry: 232 }],
};

// One floor lamp per room (represented in 3D as a slim pole box + shade).
const LAMPS: Record<string, { rx: number; ry: number }> = {
  ceo: { rx: 346, ry: 232 }, boardroom: { rx: 44, ry: 236 }, trading: { rx: 40, ry: 232 },
  research: { rx: 346, ry: 232 }, office: { rx: 40, ry: 232 }, ops: { rx: 346, ry: 236 },
  legal: { rx: 346, ry: 232 }, marketing: { rx: 346, ry: 232 }, reception: { rx: 346, ry: 236 },
};

// Desk workstations per room (staffed desks) — mirrors officeEnvironment.WORKSTATIONS.
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

// Marketplace hall stalls — back-wall X offsets (dodge the three entry lanes).
const MARKETPLACE_STALL_X = [96, 300, 468, 684, 852, 1056];
const MARKETPLACE_STALL_FY = 66;
const MARKETPLACE_AWNINGS = ["#ef4444", "#2dd4bf", "#f59e0b", "#38bdf8", "#a855f7", "#22c55e"];

/** A box standing on the floor: center from foot pixel, extents in px → world. */
function box(footXpx: number, footYpx: number, wPx: number, dPx: number, hPx: number, color: string): FurnitureBox {
  return {
    cx: footXpx * PX_TO_WORLD,
    cz: footYpx * PX_TO_WORLD,
    width: wPx * PX_TO_WORLD,
    depth: dPx * PX_TO_WORLD,
    height: hPx * PX_TO_WORLD,
    color,
  };
}

/** Build the 3D boxes for one furniture piece at world-pixel (fx, fy). */
function pieceBoxes(type: PieceType, fx: number, fy: number, accent: string): FurnitureBox[] {
  switch (type) {
    case "desk":
      return [box(fx, fy, 46, 16, 12, C.deskTop), box(fx - 10, fy - 4, 14, 4, 20, C.screen)];
    case "console":
      return [box(fx, fy, 60, 18, 13, C.deskTop), box(fx, fy - 5, 44, 4, 22, C.screen), box(fx, fy + 6, 60, 18, 2, accent)];
    case "screens":
      return [box(fx, fy, 54, 16, 8, C.deskFront), box(fx, fy - 8, 50, 3, 26, accent)];
    case "shelf":
      return [box(fx, fy, 30, 16, 34, C.wood), box(fx, fy, 30, 16, 3, C.woodTop)];
    case "sofa":
      return [box(fx, fy, 58, 24, 9, C.sofa), box(fx, fy - 9, 58, 6, 14, "#30405c")];
    case "table":
      return [box(fx, fy, 150, 40, 9, C.wood), box(fx, fy, 150, 40, 2, C.gold)];
    case "plant":
      return [box(fx, fy, 12, 12, 10, C.wood), box(fx, fy, 20, 20, 16, C.leaf)];
    case "safe":
      return [box(fx, fy, 36, 20, 30, C.metal), box(fx, fy - 2, 22, 4, 22, "#11151f")];
    case "reception":
      return [box(fx, fy, 64, 18, 15, C.deskTop), box(fx, fy + 7, 64, 18, 2, C.gold)];
    case "coffee":
      return [box(fx, fy, 34, 16, 12, C.deskFront), box(fx, fy - 4, 16, 8, 14, "#11151f")];
    case "stall":
      return [box(fx, fy, 46, 18, 13, C.wood), box(fx, fy - 6, 56, 20, 4, accent)];
  }
}

/** A slim floor lamp: pole + warm shade, in world-pixel space. */
function lampBoxes(fx: number, fy: number, accent: string): FurnitureBox[] {
  return [box(fx, fy, 3, 3, 34, "#2a323f"), box(fx, fy, 18, 12, 12, accent)];
}

/**
 * Every furniture box on the floor: per-room LAYOUT pieces, staffed-desk
 * workstations, lamps, and the marketplace stalls. World units, ready for the
 * renderer to group by color into instanced meshes.
 */
export function officeFurniture3D(): FurnitureBox[] {
  const out: FurnitureBox[] = [];
  for (const room of ROOMS) {
    const ox = room.col * ROOM_W;
    const oy = room.row * ROOM_H;
    const accent = roomAccentHex(room.key);

    if (room.key === "marketplace") {
      MARKETPLACE_STALL_X.forEach((sx, i) => {
        out.push(...pieceBoxes("stall", ox + sx, oy + MARKETPLACE_STALL_FY, MARKETPLACE_AWNINGS[i % MARKETPLACE_AWNINGS.length]));
      });
      continue;
    }

    for (const p of LAYOUT[room.key] ?? []) {
      out.push(...pieceBoxes(p.type, ox + p.rx, oy + p.ry, accent));
    }
    for (const w of WORKSTATIONS[room.key] ?? []) {
      out.push(...pieceBoxes("desk", ox + w.sx, oy + w.sy + 13, accent));
    }
    const lamp = LAMPS[room.key];
    if (lamp) out.push(...lampBoxes(ox + lamp.rx, oy + lamp.ry, accent));
  }
  return out;
}

/** The background art image for a room's floor, or `null` if none. */
export function roomFloorImage(roomKey: string): string | null {
  return ROOMS.find((r) => r.key === roomKey)?.imagePath ?? null;
}
