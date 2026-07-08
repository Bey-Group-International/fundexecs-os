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

/** A furniture box: a `Box3D` (world units), a fill color, and optional glow
 *  (emissive) for lit surfaces like monitors so they read as powered-on. */
export type FurnitureBox = Box3D & { color: string; glow?: boolean };

/** A warm floor glow pool cast under a lamp (world units). */
export type LampGlow = { x: number; z: number; radius: number; color: string };

// ── Palette (mirrors officeEnvironment's furniture colors) ──────────────────
const C = {
  deskTop: "#2c3444",
  deskFront: "#191e2a",
  wood: "#3a2f2a",
  woodTop: "#4d3f36",
  metal: "#4a5568",
  gold: "#c9a84c",
  leaf: "#2f6b3f",
  leafLight: "#3f8a54", // upper foliage layer
  screen: "#0a0d13",
  screenGlow: "#6d86ad", // uniform powered-on monitor glow (not department-colored)
  sofa: "#28344a",
  cushion: "#30405c", // sofa back / cushions
  chair: "#3b4a63", // muted upholstery seat
  caddy: "#39424f", // desk-side organizer
  bookA: "#7a4636", // warm leather-brown spine
  bookB: "#9c7b46", // warm tan spine
  mug: "#c98a5a", // warm ceramic decor
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
  reception: [{ type: "reception", rx: 96, ry: 54 }, { type: "coffee", rx: 344, ry: 150 }, { type: "plant", rx: 40, ry: 232 }, { type: "sofa", rx: 160, ry: 210 }],
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
function box(
  footXpx: number,
  footYpx: number,
  wPx: number,
  dPx: number,
  hPx: number,
  color: string,
  glow = false,
): FurnitureBox {
  return {
    cx: footXpx * PX_TO_WORLD,
    cz: footYpx * PX_TO_WORLD,
    width: wPx * PX_TO_WORLD,
    depth: dPx * PX_TO_WORLD,
    height: hPx * PX_TO_WORLD,
    color,
    glow,
  };
}

/** A simple upholstered chair: low seat + back, centered at seat foot (fx, fy). */
function chairBoxes(fx: number, fy: number): FurnitureBox[] {
  return [box(fx, fy, 16, 14, 8, C.chair), box(fx, fy + 5, 16, 4, 16, C.chair)];
}

/** Build the 3D boxes for one furniture piece at world-pixel (fx, fy). */
function pieceBoxes(type: PieceType, fx: number, fy: number, accent: string): FurnitureBox[] {
  switch (type) {
    case "desk":
      // Desk + glowing monitor + keyboard/caddy/mug detail + a seat in front.
      return [
        box(fx, fy, 46, 16, 12, C.deskTop),
        box(fx - 10, fy - 4, 14, 4, 20, C.screenGlow, true), // powered-on monitor
        box(fx + 2, fy + 4, 22, 6, 3, C.screen), // keyboard strip
        box(fx + 18, fy, 6, 10, 10, C.caddy), // side caddy
        box(fx - 18, fy - 1, 4, 4, 5, C.mug), // desk mug
        ...chairBoxes(fx, fy + 15),
      ];
    case "console":
      return [
        box(fx, fy, 60, 18, 13, C.deskTop),
        box(fx, fy - 5, 44, 4, 22, C.screenGlow, true),
        box(fx, fy + 6, 60, 18, 2, C.screenGlow, true),
        box(fx - 22, fy, 5, 5, 6, C.mug), // mug
      ];
    case "screens":
      return [
        box(fx, fy, 54, 16, 8, C.deskFront),
        box(fx, fy - 8, 50, 3, 26, C.screenGlow, true),
        box(fx, fy + 4, 24, 6, 3, C.screen), // keyboard strip
      ];
    case "shelf":
      // Shelf unit + a few warm-toned books and a mug of decor.
      return [
        box(fx, fy, 30, 16, 34, C.wood),
        box(fx, fy, 30, 16, 3, C.woodTop),
        box(fx - 7, fy, 5, 10, 16, C.bookA),
        box(fx - 1, fy, 5, 10, 20, C.bookB),
        box(fx + 6, fy, 5, 10, 14, C.bookA),
        box(fx + 11, fy - 1, 4, 4, 6, C.mug),
      ];
    case "sofa":
      return [
        box(fx, fy, 58, 24, 9, C.sofa),
        box(fx, fy - 9, 58, 6, 14, C.cushion), // backrest
        box(fx - 16, fy, 22, 20, 12, C.cushion), // seat cushions
        box(fx + 16, fy, 22, 20, 12, C.cushion),
      ];
    case "table":
      // Boardroom table + chairs on both long sides.
      return [
        box(fx, fy, 150, 40, 9, C.wood),
        box(fx, fy, 150, 40, 2, C.gold),
        ...chairBoxes(fx - 45, fy + 26),
        ...chairBoxes(fx + 45, fy + 26),
        ...chairBoxes(fx - 45, fy - 26),
        ...chairBoxes(fx + 45, fy - 26),
      ];
    case "plant":
      // Pot + rim + layered foliage.
      return [
        box(fx, fy, 12, 12, 10, C.wood),
        box(fx, fy, 15, 15, 4, C.woodTop), // pot rim
        box(fx, fy, 20, 20, 15, C.leaf), // lower foliage
        box(fx, fy - 1, 12, 12, 22, C.leafLight), // upper foliage
      ];
    case "safe":
      return [box(fx, fy, 36, 20, 30, C.metal), box(fx, fy - 2, 22, 4, 22, "#11151f")];
    case "reception":
      return [box(fx, fy, 64, 18, 15, C.deskTop), box(fx, fy + 7, 64, 18, 2, C.gold)];
    case "coffee":
      return [
        box(fx, fy, 34, 16, 12, C.deskFront),
        box(fx, fy - 4, 16, 8, 14, "#11151f"),
        box(fx + 10, fy + 2, 4, 4, 5, C.mug), // mug
      ];
    case "stall":
      // Counter + awning + a couple of accent-colored goods on the counter.
      return [
        box(fx, fy, 46, 18, 13, C.wood),
        box(fx, fy - 6, 56, 20, 4, accent),
        box(fx - 12, fy, 10, 8, 8, accent),
        box(fx + 11, fy, 8, 8, 6, accent),
      ];
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

/** Warm floor glow pools, one under each room's lamp — the soft light spill the
 *  2D office draws under its lamps, as flat accent discs on the floor. */
export function officeLampGlows(): LampGlow[] {
  const out: LampGlow[] = [];
  for (const room of ROOMS) {
    const lamp = LAMPS[room.key];
    if (!lamp) continue;
    out.push({
      x: (room.col * ROOM_W + lamp.rx) * PX_TO_WORLD,
      z: (room.row * ROOM_H + lamp.ry) * PX_TO_WORLD,
      radius: 70 * PX_TO_WORLD,
      color: roomAccentHex(room.key),
    });
  }
  return out;
}
