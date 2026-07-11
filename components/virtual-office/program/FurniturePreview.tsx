"use client";

import { useEffect, useRef } from "react";
import type { PieceType } from "@/lib/office/furnitureTypes";

/**
 * A static preview of a placeable furniture piece rendered to a `<canvas>` — a
 * pure Canvas2D port of {@link officeEnvironment.drawPiece} (plus its `box` and
 * `monitor` primitives), so the space editor's palette and property panel show
 * the *actual* piece the Phaser floor will draw, not a stand-in icon.
 *
 * The drawing logic below is copied verbatim from `officeEnvironment`'s
 * `drawPiece` / `box` / `monitor` / `shade`, with the Phaser Graphics API
 * replaced by the small {@link CanvasGraphics} adapter that mimics the subset
 * those functions use. Keep the two in lockstep: any change to a piece's look
 * in `officeEnvironment` must be mirrored here at identical coordinates.
 */

// ── Palette (mirrors officeEnvironment C) ─────────────────────────────────────
const C = {
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

/** Multiply an 0xRRGGBB color's brightness by f. Mirrors officeEnvironment.shade. */
function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const gc = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (gc << 8) | b;
}

// ── Canvas2D adapter for the Phaser Graphics subset drawPiece uses ────────────

class CanvasGraphics {
  private ctx: CanvasRenderingContext2D;
  private fill = "rgba(0,0,0,1)";
  private stroke = "rgba(0,0,0,1)";
  private lineW = 1;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  private rgba(color: number, alpha: number): string {
    return `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${alpha})`;
  }

  fillStyle(color: number, alpha = 1) {
    this.fill = this.rgba(color, alpha);
  }

  lineStyle(width: number, color: number, alpha = 1) {
    this.lineW = width;
    this.stroke = this.rgba(color, alpha);
  }

  fillRect(x: number, y: number, w: number, h: number) {
    this.ctx.fillStyle = this.fill;
    this.ctx.fillRect(x, y, w, h);
  }

  fillRoundedRect(x: number, y: number, w: number, h: number, r: number) {
    this.ctx.fillStyle = this.fill;
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, w, h, r);
    this.ctx.fill();
  }

  strokeRoundedRect(x: number, y: number, w: number, h: number, r: number) {
    this.ctx.strokeStyle = this.stroke;
    this.ctx.lineWidth = this.lineW;
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, w, h, r);
    this.ctx.stroke();
  }

  fillCircle(x: number, y: number, r: number) {
    this.ctx.fillStyle = this.fill;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  /** w, h are full extents → radii w/2, h/2. */
  fillEllipse(x: number, y: number, w: number, h: number) {
    this.ctx.fillStyle = this.fill;
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }
}

// ── Piece primitives (verbatim ports of officeEnvironment.box / monitor) ──────

/** A light-from-above extruded block: front face + top cap + soft shadow. */
function box(
  g: CanvasGraphics,
  cx: number, footY: number, w: number, capDepth: number, height: number,
  topColor: number, frontColor: number,
) {
  const x0 = cx - w / 2;
  g.fillStyle(0x000000, 0.12);
  g.fillEllipse(cx + w * 0.05, footY + 2.5, w * 1.28, capDepth * 1.2);
  g.fillStyle(0x000000, 0.3);
  g.fillEllipse(cx + w * 0.06, footY + 1.5, w * 1.02, capDepth * 0.82);
  for (let i = 0; i < 3; i++) {
    g.fillStyle(shade(frontColor, 0.6), 0.13 - i * 0.04);
    g.fillRect(x0 + 1.5, footY + 1 + i * 1.4, w - 3, 1.4);
  }
  g.fillStyle(frontColor, 1);
  g.fillRect(x0, footY - height, w, height);
  g.fillStyle(shade(frontColor, 0.7), 0.55);
  g.fillRect(x0, footY - height * 0.42, w, height * 0.42);
  g.fillStyle(shade(frontColor, 1.18), 0.26);
  g.fillRect(x0, footY - height * 0.86, w, Math.max(1, height * 0.16));
  g.fillStyle(shade(frontColor, 1.3), 0.6);
  g.fillRect(x0, footY - height, 1.4, height);
  g.fillStyle(shade(frontColor, 0.5), 0.7);
  g.fillRect(cx + w / 2 - 1.4, footY - height, 1.4, height);
  g.fillStyle(topColor, 1);
  g.fillRect(x0, footY - height - capDepth, w, capDepth);
  g.fillStyle(shade(topColor, 1.25), 0.8);
  g.fillRect(x0, footY - height - capDepth, w, 1.2);
  g.fillStyle(shade(topColor, 1.5), 0.32);
  g.fillRect(x0 + w * 0.14, footY - height - capDepth, w * 0.3, Math.max(1, capDepth * 0.5));
}

/** A small monitor sitting on a desktop, screen facing the viewer. */
function monitor(g: CanvasGraphics, cx: number, topY: number, accent: number) {
  g.fillStyle(C.monitorFrame, 1);
  g.fillRoundedRect(cx - 6, topY - 9, 12, 9, 1);
  g.fillStyle(accent, 0.9);
  g.fillRect(cx - 4.6, topY - 7.6, 9.2, 6.2);
  g.fillStyle(shade(accent, 1.4), 0.8);
  g.fillRect(cx - 4.6, topY - 7.6, 9.2, 1.4);
  g.fillStyle(C.legDark, 1);
  g.fillRect(cx - 1, topY - 1, 2, 2);
}

/** Verbatim port of officeEnvironment.drawPiece — draws at foot point (x, footY). */
function drawPiece(g: CanvasGraphics, type: PieceType, x: number, footY: number, accent: number) {
  switch (type) {
    case "desk": {
      box(g, x, footY, 46, 7, 12, C.deskTop, C.deskFront);
      monitor(g, x - 10, footY - 12 - 7, accent);
      monitor(g, x + 10, footY - 12 - 7, accent);
      break;
    }
    case "console": {
      box(g, x, footY, 60, 8, 13, C.deskTop, C.deskFront);
      monitor(g, x - 18, footY - 13 - 8, accent);
      monitor(g, x, footY - 13 - 8, accent);
      monitor(g, x + 18, footY - 13 - 8, accent);
      g.fillStyle(C.gold, 0.9);
      g.fillRect(x - 30, footY - 3, 60, 1.4);
      break;
    }
    case "screens": {
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
      box(g, x, footY, 150, 12, 9, C.woodTop, C.wood);
      g.fillStyle(C.gold, 0.5);
      g.fillRect(x - 66, footY - 9 - 12 + 5.5, 132, 1);
      for (let i = -3; i <= 3; i++) {
        g.fillStyle(C.metal, 1);
        g.fillRoundedRect(x + i * 20 - 4, footY - 9 - 12 - 6, 8, 6, 1.5);
        g.fillRoundedRect(x + i * 20 - 4, footY + 2, 8, 6, 1.5);
      }
      break;
    }
    case "safe": {
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
      box(g, x, footY, 58, 12, 9, 0x28344a, 0x1a2334);
      g.fillStyle(0x30405c, 1);
      g.fillRoundedRect(x - 28, footY - 9 - 12 - 8, 56, 10, 3);
      for (let i = -1; i <= 1; i++) {
        g.fillStyle(0x37496a, 1);
        g.fillRoundedRect(x + i * 18 - 8, footY - 9 - 12 + 1, 16, 6, 2);
      }
      break;
    }
    case "reception": {
      box(g, x, footY, 64, 8, 15, C.deskTop, C.deskFront);
      g.fillStyle(C.gold, 0.9);
      g.fillRect(x - 32, footY - 8, 64, 2);
      g.fillStyle(accent, 0.85);
      g.fillRoundedRect(x - 12, footY - 15 - 8 - 4, 24, 4, 1);
      break;
    }
    case "coffee": {
      box(g, x, footY, 34, 7, 12, C.deskTop, C.deskFront);
      const sy = footY - 12 - 7;
      g.fillStyle(0x11151f, 1);
      g.fillRoundedRect(x - 8, sy - 12, 16, 12, 1.5);
      g.fillStyle(shade(0x11151f, 1.6), 1);
      g.fillRect(x - 8, sy - 12, 16, 1.4);
      g.fillStyle(shade(accent, 1.2), 0.9);
      g.fillRect(x - 6, sy - 8, 12, 1.4);
      g.fillStyle(0x2a2620, 1);
      g.fillRect(x - 1.4, sy - 3, 2.8, 3);
      g.fillStyle(0xe8eef5, 1);
      g.fillCircle(x - 12, sy + 1.5, 1.6);
      g.fillStyle(shade(accent, 1.1), 1);
      g.fillCircle(x + 12, sy + 1.5, 1.6);
      break;
    }
    case "plant": {
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

// ── Framing: per-type world bounds around the foot point (0,0) ────────────────
// Each entry frames the piece's drawn extent (width + top/bottom in world px)
// so wildly different sizes (a 150-wide table vs a 12-wide plant) each fill the
// thumbnail nicely. A little slack is baked in for shadows and highlights.
const FRAME: Record<PieceType, { w: number; top: number; bottom: number }> = {
  desk: { w: 52, top: -30, bottom: 5 },
  console: { w: 66, top: -33, bottom: 5 },
  screens: { w: 58, top: -32, bottom: 4 },
  shelf: { w: 34, top: -44, bottom: 4 },
  table: { w: 160, top: -30, bottom: 11 },
  safe: { w: 40, top: -42, bottom: 4 },
  reception: { w: 70, top: -30, bottom: 4 },
  coffee: { w: 40, top: -34, bottom: 4 },
  sofa: { w: 64, top: -32, bottom: 4 },
  plant: { w: 28, top: -32, bottom: 4 },
};

/**
 * Render a furniture piece to a fixed-size canvas, auto-framed to fill it.
 * `accent` tints screens/glows/trim (defaults to gold, the editor's accent).
 */
export function FurniturePreview({
  type,
  width = 56,
  height = 44,
  accent = C.gold,
}: {
  type: PieceType;
  width?: number;
  height?: number;
  accent?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const frame = FRAME[type];
    const pad = 4;
    const worldH = frame.bottom - frame.top;
    const scale = Math.min((width - pad * 2) / frame.w, (height - pad * 2) / worldH);
    // Map world x=0 → horizontal center, and the world's vertical mid → canvas mid.
    const cy = height / 2 - scale * (frame.top + frame.bottom) / 2;
    ctx.translate(width / 2, cy);
    ctx.scale(scale, scale);

    const g = new CanvasGraphics(ctx);
    drawPiece(g, type, 0, 0, accent);
  }, [type, width, height, accent]);

  return (
    <canvas
      ref={ref}
      style={{ width, height, display: "block" }}
      aria-hidden="true"
    />
  );
}
