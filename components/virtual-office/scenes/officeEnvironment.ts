import * as Phaser from "phaser";
import { ROOMS, ROOM_W, ROOM_H, GRID_COLS, GRID_ROWS, WORLD_W, WORLD_H, WALL_THICKNESS, DOOR_GAP } from "../types";

/**
 * FundExecs OS — 2.5D office environment (rendering layer).
 *
 * Draws the *institutional department* look on top of the flat tile floor:
 * extruded partition walls with a lit top face, and per-department furniture
 * (command consoles, boardroom table, trading terminals, compliance filing,
 * treasury safe, IR lounge…) rendered as light-from-above vector blocks so the
 * top-down floor reads with real depth.
 *
 * This module is deliberately free of any game/networking/program state — it
 * only takes a Phaser.Scene and paints geometry. That keeps the "renderer"
 * cleanly separable: a future Three.js/WebGPU, Unity WebGL, or Unreal
 * Pixel-Streaming floor swaps this file out and consumes the same ROOMS map.
 *
 * Depth model (shared with OfficeScene): the floor + room overlays live below
 * DEPTH_WALL; walls sit at DEPTH_WALL; furniture and moving avatars share a
 * single y-sorted band via yDepth(footY) so an avatar walking toward the back
 * of a room passes *behind* a desk, and toward the front passes in front of it.
 */

export const DEPTH_FLOOR_DECOR = 2;
export const DEPTH_WALL = 6;
export const DEPTH_ACTOR_BASE = 10;
export const DEPTH_LABEL = 19.5;

/** y-sorted depth for anything that shares the floor with avatars. */
export function yDepth(footY: number): number {
  return DEPTH_ACTOR_BASE + footY * 0.01;
}

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  wallCap: 0x323a4d,
  wallFace: 0x1b2130,
  wallExtrude: 0x11151f,
  deskTop: 0x2c3444,
  deskFront: 0x191e2a,
  legDark: 0x0d1017,
  wood: 0x3a2f2a,
  woodTop: 0x4d3f36,
  monitorFrame: 0x0a0d13,
  gold: 0xc9a84c,
  metal: 0x4a5568,
  metalTop: 0x63718a,
  leaf: 0x2f6b3f,
  leafHi: 0x3f8a52,
};

/** Per-department screen/accent glow. */
const ROOM_ACCENT: Record<string, number> = {
  ceo: 0xc9a84c,
  boardroom: 0xa855f7,
  trading: 0x38bdf8,
  research: 0x38bdf8,
  office: 0xec4899,
  ops: 0x22c55e,
  legal: 0xef4444,
  marketing: 0x14b8a6,
  reception: 0xf59e0b,
};

type PieceType = "desk" | "screens" | "shelf" | "sofa" | "table" | "plant" | "safe" | "console" | "reception";
type Piece = { type: PieceType; rx: number; ry: number };

/**
 * Per-room furniture layout, in room-relative pixels. Placement rule:
 * everything sits along the back/side walls and corners, clear of the
 * center agent cluster (rx 130–255, ry 96–210) and the door lanes
 * (rx 152–232 top/bottom, ry 112–176 sides).
 */
const LAYOUT: Record<string, Piece[]> = {
  ceo: [
    { type: "console", rx: 96, ry: 52 },
    { type: "desk", rx: 300, ry: 60 },
    { type: "plant", rx: 40, ry: 232 },
  ],
  boardroom: [
    { type: "table", rx: 192, ry: 236 },
    { type: "shelf", rx: 70, ry: 50 },
    { type: "shelf", rx: 314, ry: 50 },
  ],
  trading: [
    { type: "screens", rx: 100, ry: 48 },
    { type: "desk", rx: 300, ry: 60 },
    { type: "plant", rx: 348, ry: 232 },
  ],
  research: [
    { type: "shelf", rx: 68, ry: 50 },
    { type: "shelf", rx: 120, ry: 50 },
    { type: "desk", rx: 306, ry: 60 },
    { type: "plant", rx: 40, ry: 232 },
  ],
  office: [
    { type: "desk", rx: 84, ry: 58 },
    { type: "desk", rx: 300, ry: 58 },
    { type: "plant", rx: 348, ry: 234 },
  ],
  ops: [
    { type: "screens", rx: 100, ry: 48 },
    { type: "desk", rx: 300, ry: 60 },
    { type: "plant", rx: 40, ry: 232 },
  ],
  legal: [
    { type: "shelf", rx: 66, ry: 50 },
    { type: "shelf", rx: 300, ry: 50 },
    { type: "desk", rx: 110, ry: 232 },
  ],
  marketing: [
    { type: "safe", rx: 84, ry: 58 },
    { type: "desk", rx: 300, ry: 60 },
    { type: "plant", rx: 40, ry: 232 },
  ],
  reception: [
    { type: "reception", rx: 96, ry: 54 },
    { type: "sofa", rx: 300, ry: 226 },
    { type: "plant", rx: 40, ry: 232 },
  ],
};

// ── Walls ────────────────────────────────────────────────────────────────────

/**
 * Extruded partition walls with a lit top cap and a shadowed front face.
 * Mirrors the door-gap geometry of OfficeScene._createWalls so the visual
 * walls line up exactly with the invisible physics walls (doors stay open).
 */
export function createWallVisuals(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(DEPTH_WALL);
  const W = WALL_THICKNESS;
  const DG = DOOR_GAP;

  const hWall = (x: number, y: number, w: number) => {
    if (w <= 0) return;
    // Downward extrusion (the wall's visible height toward the viewer).
    g.fillStyle(C.wallExtrude, 1); g.fillRect(x, y + W, w, 5);
    g.fillStyle(0x000000, 0.16); g.fillRect(x, y + W + 5, w, 3);
    // Body + lit cap.
    g.fillStyle(C.wallFace, 1); g.fillRect(x, y + 2.5, w, W - 2.5);
    g.fillStyle(C.wallCap, 1); g.fillRect(x, y, w, 2.5);
  };
  const vWall = (x: number, y: number, h: number) => {
    if (h <= 0) return;
    g.fillStyle(C.wallExtrude, 0.9); g.fillRect(x + W - 2, y, 2, h);
    g.fillStyle(C.wallFace, 1); g.fillRect(x + 2.5, y, W - 4.5, h);
    g.fillStyle(C.wallCap, 1); g.fillRect(x, y, 2.5, h); // left edge catches light
  };

  // Perimeter
  hWall(0, 0, WORLD_W);
  hWall(0, WORLD_H - W, WORLD_W);
  vWall(0, 0, WORLD_H);
  vWall(WORLD_W - W, 0, WORLD_H);

  // Internal horizontal walls (between rows), split around the door gap.
  for (let r = 1; r < GRID_ROWS; r++) {
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
  for (let c = 1; c < GRID_COLS; c++) {
    const wallX = c * ROOM_W - W / 2;
    for (let r = 0; r < GRID_ROWS; r++) {
      const wallY = r * ROOM_H;
      const doorCenter = wallY + ROOM_H / 2;
      vWall(wallX, wallY, doorCenter - DG / 2 - wallY);
      const botStart = doorCenter + DG / 2;
      vWall(wallX, botStart, wallY + ROOM_H - botStart);
    }
  }

  return g;
}

// ── Furniture ────────────────────────────────────────────────────────────────

export type FurniturePiece = { gfx: Phaser.GameObjects.Graphics; footY: number };

/**
 * Paint every department's furniture. Rugs are flat (below walls); solid pieces
 * are y-sorted via yDepth so avatars occlude correctly. Returns the pieces so
 * the caller can dispose them on shutdown.
 */
export function createFurniture(scene: Phaser.Scene): FurniturePiece[] {
  const pieces: FurniturePiece[] = [];

  for (const room of ROOMS) {
    const ox = room.col * ROOM_W;
    const oy = room.row * ROOM_H;
    const accent = ROOM_ACCENT[room.key] ?? C.gold;

    // A soft department rug anchors the center of the floor (flat, no height).
    const rug = scene.add.graphics().setDepth(DEPTH_FLOOR_DECOR);
    rug.fillStyle(accent, 0.05);
    rug.fillRoundedRect(ox + ROOM_W / 2 - 70, oy + ROOM_H / 2 - 40, 140, 90, 10);
    rug.lineStyle(1, accent, 0.12);
    rug.strokeRoundedRect(ox + ROOM_W / 2 - 70, oy + ROOM_H / 2 - 40, 140, 90, 10);
    pieces.push({ gfx: rug, footY: -1 });

    for (const p of LAYOUT[room.key] ?? []) {
      const x = ox + p.rx;
      const footY = oy + p.ry;
      const g = scene.add.graphics().setDepth(yDepth(footY));
      drawPiece(g, p.type, x, footY, accent);
      pieces.push({ gfx: g, footY });
    }
  }

  return pieces;
}

/** A light-from-above extruded block: front face + top cap + soft shadow. */
function box(
  g: Phaser.GameObjects.Graphics,
  cx: number, footY: number, w: number, capDepth: number, height: number,
  topColor: number, frontColor: number,
) {
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(cx, footY + 1, w * 0.96, capDepth * 0.7);
  g.fillStyle(frontColor, 1);
  g.fillRect(cx - w / 2, footY - height, w, height);
  g.fillStyle(topColor, 1);
  g.fillRect(cx - w / 2, footY - height - capDepth, w, capDepth);
  // Top highlight edge (lit).
  g.fillStyle(shade(topColor, 1.25), 0.8);
  g.fillRect(cx - w / 2, footY - height - capDepth, w, 1.2);
}

/** A small monitor sitting on a desktop, screen facing the viewer. */
function monitor(g: Phaser.GameObjects.Graphics, cx: number, topY: number, accent: number) {
  g.fillStyle(C.monitorFrame, 1);
  g.fillRoundedRect(cx - 6, topY - 9, 12, 9, 1);
  g.fillStyle(accent, 0.9);
  g.fillRect(cx - 4.6, topY - 7.6, 9.2, 6.2);
  g.fillStyle(shade(accent, 1.4), 0.8);
  g.fillRect(cx - 4.6, topY - 7.6, 9.2, 1.4);
  g.fillStyle(C.legDark, 1);
  g.fillRect(cx - 1, topY - 1, 2, 2);
}

function drawPiece(g: Phaser.GameObjects.Graphics, type: PieceType, x: number, footY: number, accent: number) {
  switch (type) {
    case "desk": {
      box(g, x, footY, 46, 7, 12, C.deskTop, C.deskFront);
      monitor(g, x - 10, footY - 12 - 7, accent);
      monitor(g, x + 10, footY - 12 - 7, accent);
      break;
    }
    case "console": {
      // Command console — wide desk with a curved screen array + gold trim.
      box(g, x, footY, 60, 8, 13, C.deskTop, C.deskFront);
      monitor(g, x - 18, footY - 13 - 8, accent);
      monitor(g, x, footY - 13 - 8, accent);
      monitor(g, x + 18, footY - 13 - 8, accent);
      g.fillStyle(C.gold, 0.9);
      g.fillRect(x - 30, footY - 3, 60, 1.4);
      break;
    }
    case "screens": {
      // Wall of market/ops terminals mounted above a low bench.
      box(g, x, footY, 54, 6, 8, C.deskTop, C.deskFront);
      for (let i = -1; i <= 1; i++) {
        g.fillStyle(C.monitorFrame, 1);
        g.fillRoundedRect(x + i * 18 - 8, footY - 8 - 6 - 15, 16, 12, 1);
        g.fillStyle(accent, 0.9);
        g.fillRect(x + i * 18 - 6.6, footY - 8 - 6 - 13.6, 13.2, 9.2);
        g.fillStyle(shade(accent, 1.5), 0.7);
        g.fillRect(x + i * 18 - 6.6, footY - 8 - 6 - 13.6 + (i + 1) * 2.4, 13.2, 1);
      }
      break;
    }
    case "shelf": {
      // Filing / bookshelf with colored spines.
      box(g, x, footY, 30, 6, 34, C.woodTop, C.wood);
      const spines = [accent, 0xdfe6ee, C.gold, 0x64748b, 0xe8eef5];
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 5; i++) {
          g.fillStyle(spines[(i + row) % spines.length], 0.85);
          g.fillRect(x - 13 + i * 5.2, footY - 30 + row * 10, 4.2, 8);
        }
      }
      break;
    }
    case "table": {
      // Boardroom table with seats along both long edges.
      box(g, x, footY, 150, 12, 9, C.woodTop, C.wood);
      g.fillStyle(C.gold, 0.5);
      g.fillRect(x - 66, footY - 9 - 12 + 5.5, 132, 1);
      for (let i = -3; i <= 3; i++) {
        g.fillStyle(C.metal, 1);
        g.fillRoundedRect(x + i * 20 - 4, footY - 9 - 12 - 6, 8, 6, 1.5); // far chairs
        g.fillRoundedRect(x + i * 20 - 4, footY + 2, 8, 6, 1.5);          // near chairs
      }
      break;
    }
    case "safe": {
      // Treasury safe — heavy metal block with a gold dial.
      box(g, x, footY, 36, 8, 30, C.metalTop, 0x2a323f);
      g.fillStyle(0x11151f, 1);
      g.fillRoundedRect(x - 13, footY - 28, 26, 24, 2);
      g.fillStyle(C.gold, 1);
      g.fillCircle(x + 4, footY - 16, 4);
      g.fillStyle(0x11151f, 1);
      g.fillCircle(x + 4, footY - 16, 1.6);
      g.lineStyle(1, C.gold, 0.8);
      g.strokeRoundedRect(x - 13, footY - 28, 26, 24, 2);
      break;
    }
    case "sofa": {
      // IR lounge sofa — navy with cushion highlights.
      box(g, x, footY, 58, 12, 9, 0x28344a, 0x1a2334);
      g.fillStyle(0x30405c, 1);
      g.fillRoundedRect(x - 28, footY - 9 - 12 - 8, 56, 10, 3); // backrest
      for (let i = -1; i <= 1; i++) {
        g.fillStyle(0x37496a, 1);
        g.fillRoundedRect(x + i * 18 - 8, footY - 9 - 12 + 1, 16, 6, 2);
      }
      break;
    }
    case "reception": {
      // Reception desk — wide counter with a gold front band + name plate glow.
      box(g, x, footY, 64, 8, 15, C.deskTop, C.deskFront);
      g.fillStyle(C.gold, 0.9);
      g.fillRect(x - 32, footY - 8, 64, 2);
      g.fillStyle(accent, 0.85);
      g.fillRoundedRect(x - 12, footY - 15 - 8 - 4, 24, 4, 1);
      break;
    }
    case "plant": {
      // Corner accent plant — pot + layered leaves.
      g.fillStyle(0x000000, 0.2);
      g.fillEllipse(x, footY + 1, 16, 5);
      box(g, x, footY, 12, 4, 8, C.woodTop, C.wood);
      g.fillStyle(C.leaf, 1);
      g.fillEllipse(x, footY - 16, 16, 16);
      g.fillEllipse(x - 5, footY - 22, 9, 12);
      g.fillEllipse(x + 5, footY - 21, 9, 11);
      g.fillStyle(C.leafHi, 0.7);
      g.fillEllipse(x - 3, footY - 19, 5, 7);
      break;
    }
  }
}

/** Multiply an 0xRRGGBB color's brightness by f. */
function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const gc = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (gc << 8) | b;
}
