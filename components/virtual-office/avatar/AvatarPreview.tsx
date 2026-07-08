"use client";

import { useEffect, useRef } from "react";
import type { AvatarSpec } from "./avatarPalette";

/**
 * A static, front-facing preview of an executive avatar rendered to a
 * `<canvas>` — a pure Canvas2D port of the in-game {@link ExecutiveAvatar}
 * floor figure (front idle pose only; no Phaser dependency).
 *
 * The drawing logic below is copied verbatim from `ExecutiveAvatar`'s front +
 * coin methods, with `this.spec` → `spec`, `this._shade` → `shade`,
 * `this.eyesClosed` → `false`, `this.animState` → `"idle_breathing"`, and the
 * Phaser Graphics API replaced by the small {@link CanvasGraphics} adapter that
 * mimics the subset those methods use.
 */

// ── Canvas2D adapter for the Phaser Graphics subset the front pose uses ──────

type Point = { x: number; y: number };

class CanvasGraphics {
  private ctx: CanvasRenderingContext2D;
  private fill = "rgba(0,0,0,1)";
  private stroke = "rgba(0,0,0,1)";
  private lineW = 1;
  private pendingGrad: { top: number; bottom: number; alpha: number } | null = null;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  private rgba(color: number, alpha: number): string {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /** Resolve the fill for the next shape, consuming any pending gradient. */
  private resolveFill(yTop: number, yBottom: number): string | CanvasGradient {
    if (!this.pendingGrad) return this.fill;
    const { top, bottom, alpha } = this.pendingGrad;
    this.pendingGrad = null;
    const grad = this.ctx.createLinearGradient(0, yTop, 0, yBottom);
    grad.addColorStop(0, this.rgba(top, alpha));
    grad.addColorStop(1, this.rgba(bottom, alpha));
    return grad;
  }

  fillStyle(color: number, alpha = 1) {
    this.fill = this.rgba(color, alpha);
  }

  /** Record a pending vertical gradient (top = tl, bottom = bl). */
  fillGradientStyle(tl: number, _tr: number, bl: number, _br: number, alpha = 1) {
    this.pendingGrad = { top: tl, bottom: bl, alpha };
  }

  fillRect(x: number, y: number, w: number, h: number) {
    this.ctx.fillStyle = this.resolveFill(y, y + h);
    this.ctx.fillRect(x, y, w, h);
  }

  fillRoundedRect(x: number, y: number, w: number, h: number, r: number) {
    this.ctx.fillStyle = this.resolveFill(y, y + h);
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, w, h, r);
    this.ctx.fill();
  }

  fillCircle(x: number, y: number, r: number) {
    this.ctx.fillStyle = this.resolveFill(y - r, y + r);
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  /** w, h are full extents → radii w/2, h/2. */
  fillEllipse(x: number, y: number, w: number, h: number) {
    this.ctx.fillStyle = this.resolveFill(y - h / 2, y + h / 2);
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    this.ctx.fillStyle = this.resolveFill(Math.min(y1, y2, y3), Math.max(y1, y2, y3));
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.lineTo(x3, y3);
    this.ctx.closePath();
    this.ctx.fill();
  }

  fillPoints(points: Point[], closed: boolean) {
    let yTop = Infinity;
    let yBottom = -Infinity;
    for (const p of points) {
      if (p.y < yTop) yTop = p.y;
      if (p.y > yBottom) yBottom = p.y;
    }
    this.ctx.fillStyle = this.resolveFill(yTop, yBottom);
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) this.ctx.lineTo(points[i].x, points[i].y);
    if (closed) this.ctx.closePath();
    this.ctx.fill();
  }

  lineStyle(width: number, color: number, alpha = 1) {
    this.lineW = width;
    this.stroke = this.rgba(color, alpha);
  }

  strokeCircle(x: number, y: number, r: number) {
    this.ctx.strokeStyle = this.stroke;
    this.ctx.lineWidth = this.lineW;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  strokeEllipse(x: number, y: number, w: number, h: number) {
    this.ctx.strokeStyle = this.stroke;
    this.ctx.lineWidth = this.lineW;
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  beginPath() {
    this.ctx.beginPath();
  }

  moveTo(x: number, y: number) {
    this.ctx.moveTo(x, y);
  }

  lineTo(x: number, y: number) {
    this.ctx.lineTo(x, y);
  }

  arc(x: number, y: number, r: number, startRad: number, endRad: number, anticlockwise = false) {
    this.ctx.arc(x, y, r, startRad, endRad, anticlockwise);
  }

  strokePath() {
    this.ctx.strokeStyle = this.stroke;
    this.ctx.lineWidth = this.lineW;
    this.ctx.stroke();
  }
}

// ── Shared helper ────────────────────────────────────────────────────────────

/** Multiply an 0xRRGGBB color's brightness by f. */
function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const gc = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (gc << 8) | b;
}

/** Shoulder half-width for the torso top, by build. */
function shoulder(s: AvatarSpec): number {
  switch (s.build) {
    case "slim":
      return 6.2;
    case "broad":
      return 8;
    default:
      return 7;
  }
}

// ── Executive front (idle) ───────────────────────────────────────────────────

/** Shared head/hair/face block, offset by (ox, oy). Eyes open. */
function drawHead(g: CanvasGraphics, s: AvatarSpec, ox: number, oy: number) {
  const skinLo = shade(s.skin, 0.82);
  // Neck with an ambient-occlusion shadow just under the jaw.
  g.fillStyle(shade(s.skin, 0.88), 1);
  g.fillRect(ox - 1.8, oy - 9, 3.6, 3.6);
  g.fillStyle(skinLo, 0.55);
  g.fillRect(ox - 1.8, oy - 9, 3.6, 1.4);
  // Ears
  g.fillStyle(shade(s.skin, 0.94), 1);
  g.fillEllipse(ox - 4.7, oy - 12.6, 2, 3.2);
  g.fillEllipse(ox + 4.7, oy - 12.6, 2, 3.2);
  // Head base
  g.fillStyle(s.skin, 1);
  g.fillEllipse(ox, oy - 13, 9.5, 11);
  // Forehead highlight (top-lit) + jaw / right-cheek shading for volume.
  g.fillStyle(shade(s.skin, 1.12), 0.5);
  g.fillEllipse(ox - 1, oy - 15, 6, 4);
  g.fillStyle(skinLo, 0.45);
  g.fillEllipse(ox, oy - 9.6, 7, 3.4); // jaw
  g.fillEllipse(ox + 2.9, oy - 12, 3.2, 6); // cheek
  // Lit cheek plane on the key-light (left) side — rounder facial volume.
  g.fillStyle(shade(s.skin, 1.16), 0.32);
  g.fillEllipse(ox - 2.7, oy - 12.2, 3.4, 4.4);
  // Hair
  if (s.hairStyle !== "bald") {
    g.fillStyle(s.hair, 1);
    g.fillEllipse(ox, oy - 15.6, 10, 7.2);
    g.fillRect(ox - 5, oy - 15.6, 10, 2.6);
    // Sideburns framing the face.
    g.fillEllipse(ox - 4.5, oy - 15, 1.6, 3.4);
    g.fillEllipse(ox + 4.5, oy - 15, 1.6, 3.4);
    if (s.hairStyle === "textured") {
      g.fillStyle(shade(s.hair, 1.35), 0.5);
      g.fillEllipse(ox - 2.4, oy - 17.2, 4.2, 2.2);
      g.fillStyle(shade(s.hair, 0.7), 0.4);
      g.fillEllipse(ox + 2.6, oy - 15.6, 3, 2);
    } else if (s.hairStyle === "tied") {
      g.fillStyle(s.hair, 1);
      g.fillCircle(ox, oy - 18.6, 2.2); // top knot
      g.fillStyle(shade(s.hair, 1.3), 0.4);
      g.fillEllipse(ox - 1.6, oy - 17.4, 3, 1.5);
    } else {
      g.fillStyle(shade(s.hair, 1.32), 0.5); // sheen
      g.fillEllipse(ox - 2, oy - 17.4, 3.6, 1.7);
    }
    // Hairline shadow where hair meets the forehead.
    g.fillStyle(shade(s.hair, 0.7), 0.4);
    g.fillEllipse(ox, oy - 16.4, 8.6, 1.4);
  }
  // Brows
  g.fillStyle(shade(s.hair, 0.85), 0.85);
  g.fillRect(ox - 3.2, oy - 13.7, 2.4, 0.7);
  g.fillRect(ox + 0.8, oy - 13.7, 2.4, 0.7);
  // Eyes — open, with a catchlight.
  g.fillStyle(0x2a2320, 1);
  g.fillEllipse(ox - 2, oy - 12.4, 1.5, 1.7);
  g.fillEllipse(ox + 2, oy - 12.4, 1.5, 1.7);
  g.fillStyle(0xf4f0e8, 0.85);
  g.fillCircle(ox - 2.4, oy - 12.8, 0.4);
  g.fillCircle(ox + 1.6, oy - 12.8, 0.4);
  // Nose shadow to the shaded side.
  g.fillStyle(skinLo, 0.5);
  g.fillTriangle(ox + 0.3, oy - 12.4, ox + 0.3, oy - 10.6, ox + 1.4, oy - 10.8);
  // Nose-bridge highlight — a defined, lit ridge.
  g.fillStyle(shade(s.skin, 1.12), 0.3);
  g.fillRect(ox - 0.5, oy - 13, 0.7, 2.6);
  // Facial hair — hair-colored, under the mouth so lips read on top. Mirrors
  // ExecutiveAvatar._drawFacialHairFront exactly (same coordinates).
  const fh = s.facialHair ?? "none";
  if (fh !== "none") {
    const beardHair = shade(s.hair, 0.92);
    if (fh === "stubble") {
      g.fillStyle(beardHair, 0.3);
      g.fillEllipse(ox, oy - 9.4, 8.4, 4.8);
    } else if (fh === "beard") {
      g.fillStyle(beardHair, 1);
      g.fillEllipse(ox, oy - 8.8, 8.4, 5.6);
      g.fillRect(ox - 4.6, oy - 13.4, 1.5, 4.6);
      g.fillRect(ox + 3.1, oy - 13.4, 1.5, 4.6);
      g.fillStyle(shade(s.hair, 1.2), 0.4);
      g.fillEllipse(ox, oy - 10.8, 6.2, 1.6);
    }
    if (fh === "beard" || fh === "mustache") {
      g.fillStyle(beardHair, 1);
      g.fillEllipse(ox, oy - 10.7, 3.8, 1.2);
    }
  }
  // Mouth
  g.fillStyle(shade(s.skin, 0.66), 0.6);
  g.fillRect(ox - 1.5, oy - 10, 3, 0.7);
  // Lower-lip highlight — a touch of life beneath the mouth.
  g.fillStyle(shade(s.skin, 1.1), 0.35);
  g.fillRect(ox - 1, oy - 9.4, 2, 0.45);
  // Eyewear — over the eyes. Mirrors ExecutiveAvatar._drawGlassesFront.
  if ((s.glasses ?? "none") !== "none") {
    const frame = 0x241f1b;
    g.fillStyle(0xbfe0f0, 0.12);
    g.fillCircle(ox - 2, oy - 12.4, 1.7);
    g.fillCircle(ox + 2, oy - 12.4, 1.7);
    g.lineStyle(0.7, frame, 0.95);
    g.strokeCircle(ox - 2, oy - 12.4, 2.1);
    g.strokeCircle(ox + 2, oy - 12.4, 2.1);
    g.fillStyle(frame, 0.9);
    g.fillRect(ox - 0.3, oy - 12.7, 0.6, 0.5);
    g.fillRect(ox - 4.9, oy - 12.7, 0.9, 0.4);
    g.fillRect(ox + 4, oy - 12.7, 0.9, 0.4);
  }
}

/** Front-view arms — walk/idle branch (arms at the sides). */
function drawFrontArms(g: CanvasGraphics, s: AvatarSpec, swing: number) {
  const sleeve = s.suit;
  g.fillStyle(sleeve, 1);
  g.fillRoundedRect(-8, -5 + swing * 0.4, 3.2, 11, 1.6);
  g.fillRoundedRect(4.8, -5 - swing * 0.4, 3.2, 11, 1.6);
  g.fillStyle(s.skin, 1);
  g.fillCircle(-6.4, 6 + swing * 0.4, 1.7);
  g.fillCircle(6.4, 6 - swing * 0.4, 1.7);
}

/** Front view (facing down / toward the viewer), idle. */
function drawFront(g: CanvasGraphics, s: AvatarSpec) {
  const swing = 0;
  const sw = shoulder(s);

  // Legs — soft vertical gradient (lit at the thigh, shaded at the cuff).
  const legHi = shade(s.trouser, 1.18);
  const legLo = shade(s.trouser, 0.82);
  g.fillGradientStyle(legHi, legHi, legLo, legLo, 1);
  g.fillRect(-4.5, 6 - Math.max(0, swing), 3.5, 9 + Math.abs(swing) * 0.4);
  g.fillGradientStyle(legHi, legHi, legLo, legLo, 1);
  g.fillRect(1, 6 - Math.max(0, -swing), 3.5, 9 + Math.abs(swing) * 0.4);
  // Shoes — dark leather with a specular toe highlight.
  g.fillStyle(0x14110d, 1);
  g.fillEllipse(-2.7, 15 - Math.max(0, swing), 4.4, 2.4);
  g.fillEllipse(2.7, 15 - Math.max(0, -swing), 4.4, 2.4);
  g.fillStyle(0x3c362c, 0.9);
  g.fillEllipse(-3.3, 14.5 - Math.max(0, swing), 1.7, 0.9);
  g.fillEllipse(2.1, 14.5 - Math.max(0, -swing), 1.7, 0.9);

  // Arms — idle pose.
  drawFrontArms(g, s, swing);

  // Torso — tapered blazer with a directional gradient (lit upper-left →
  // deeper waist) for real volume.
  const suitHi = shade(s.suit, 1.35);
  const suitMid = shade(s.suit, 1.08);
  const suitLo = shade(s.suit, 0.7);
  g.fillGradientStyle(suitHi, suitMid, suitLo, shade(s.suit, 0.85), 1);
  g.fillPoints(
    [
      { x: -sw, y: -6 },
      { x: sw, y: -6 },
      { x: 5.5, y: 7 },
      { x: -5.5, y: 7 },
    ],
    true,
  );
  // Waist ambient occlusion for a grounded torso.
  g.fillStyle(shade(s.suit, 0.55), 0.3);
  g.fillTriangle(-5.5, 7, 5.5, 7, 0, 2.5);

  // Shirt V with a soft chest gradient.
  const shHi = shade(s.shirt, 1.06);
  const shLo = shade(s.shirt, 0.82);
  g.fillGradientStyle(shHi, shHi, shLo, shLo, 1);
  g.fillTriangle(-2.6, -6, 2.6, -6, 0, 2.5);
  // Collar edges
  g.fillStyle(shade(s.shirt, 0.86), 1);
  g.fillTriangle(-2.6, -6, -1.2, -6, -1.9, -2.6);
  g.fillTriangle(2.6, -6, 1.2, -6, 1.9, -2.6);
  // Lapels — shaded plane + a lit outer edge.
  g.fillStyle(shade(s.suit, 0.8), 1);
  g.fillTriangle(-3.2, -6, -0.4, -6, -2.2, 1);
  g.fillTriangle(3.2, -6, 0.4, -6, 2.2, 1);
  g.lineStyle(0.4, shade(s.suit, 1.4), 0.7);
  g.beginPath();
  g.moveTo(-3.2, -6);
  g.lineTo(-2.2, 1);
  g.strokePath();
  g.beginPath();
  g.moveTo(3.2, -6);
  g.lineTo(2.2, 1);
  g.strokePath();
  // Pocket square — a small folded accent on the left chest.
  g.fillStyle(shade(s.accent, 1.1), 0.95);
  g.fillTriangle(-4.6, -2.2, -3.2, -2.2, -3.9, -3.6);
  // Tie with a knot and a highlighted center ridge.
  g.fillStyle(s.accent, 1);
  g.fillTriangle(-1.1, -5, 1.1, -5, 0, 4);
  g.fillStyle(shade(s.accent, 1.25), 0.8);
  g.fillTriangle(-0.4, -4.6, 0.4, -4.6, 0, 3.4);
  g.fillStyle(shade(s.accent, 1.15), 1);
  g.fillTriangle(-1.3, -5.2, 1.3, -5.2, 0, -3);

  drawHead(g, s, 0, 0);
}

// ── Earn — the gold-coin mascot (front, idle) ───────────────────────────────

const COIN_LIMB = 0x15120b; // near-black arms/legs
const COIN_GLOVE = 0xf4f0e8; // white gloves/shoes
const COIN_RIM = 0xa96e12;
const COIN_BASE = 0xf2c12a;
const COIN_SHADE = 0xcf941c;
const COIN_HI = 0xf9d24e;
const COIN_SPEC = 0xfff0b4;
const COIN_RING = 0xc98a18;

/** The coin disc with real volume: deep-amber rim, bright-gold base, etc. */
function coinBody(
  g: CanvasGraphics,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ring: boolean,
) {
  g.fillStyle(COIN_RIM, 1);
  g.fillEllipse(cx, cy, rx * 2 + 2.6, ry * 2 + 2.6);
  g.fillStyle(COIN_BASE, 1);
  g.fillEllipse(cx, cy, rx * 2, ry * 2);
  g.fillStyle(COIN_SHADE, 0.55);
  g.fillEllipse(cx, cy + ry * 0.52, rx * 1.5, ry * 0.9); // lower shadow band
  g.fillStyle(COIN_HI, 0.9);
  g.fillEllipse(cx, cy - ry * 0.4, rx * 1.36, ry * 0.78); // upper highlight
  g.fillStyle(COIN_SPEC, 0.75);
  g.fillEllipse(cx - rx * 0.42, cy - ry * 0.5, rx * 0.5, ry * 0.32); // glint
  if (ring) {
    g.lineStyle(1.2, COIN_RING, 0.7);
    g.strokeEllipse(cx, cy, rx * 2 - 4.6, ry * 2 - 4.6);
  }
}

/** Coin face — eyes open + a simple smile arc (non-presenting). */
function drawCoinFace(g: CanvasGraphics, cx: number, cy: number, dx: number) {
  const ex = 3.2;
  const eyeY = cy - 1.4;
  g.fillStyle(0x241a12, 1);
  g.fillEllipse(cx - ex + dx, eyeY, 2.5, 3.2);
  g.fillEllipse(cx + ex + dx, eyeY, 2.5, 3.2);
  g.fillStyle(0xf7f3ea, 0.9);
  g.fillCircle(cx - ex - 0.5 + dx, eyeY - 0.9, 0.7);
  g.fillCircle(cx + ex - 0.5 + dx, eyeY - 0.9, 0.7);
  // Simple smile.
  g.lineStyle(1.5, 0x4a2f14, 1);
  g.beginPath();
  g.arc(cx + dx * 0.6, cy + 1.9, 3.4, 0.15 * Math.PI, 0.85 * Math.PI, false);
  g.strokePath();
}

/** Two little legs + white shoes. */
function drawCoinLegs(g: CanvasGraphics, swing: number) {
  const lL = Math.max(0, swing) * 0.6;
  const lR = Math.max(0, -swing) * 0.6;
  g.fillStyle(COIN_LIMB, 1);
  g.fillRoundedRect(-4.6, 3 - lL, 3.1, 9, 1.4);
  g.fillRoundedRect(1.5, 3 - lR, 3.1, 9, 1.4);
  g.fillStyle(COIN_GLOVE, 1);
  g.fillEllipse(-3.0, 12.6 - lL, 4.6, 2.7);
  g.fillEllipse(3.0, 12.6 - lR, 4.6, 2.7);
  g.fillStyle(0xcbc6b8, 1);
  g.fillEllipse(-3.0, 13.4 - lL, 3.4, 1.2);
  g.fillEllipse(3.0, 13.4 - lR, 3.4, 1.2);
}

/** Front-facing arms/gloves — walk/idle branch (gloves at the sides). */
function drawCoinArms(g: CanvasGraphics, swing: number) {
  const A = COIN_LIMB;
  const W = COIN_GLOVE;
  g.fillStyle(A, 1);
  g.fillRoundedRect(-12, -7 + swing * 0.4, 3, 7, 1.4);
  g.fillRoundedRect(9, -7 - swing * 0.4, 3, 7, 1.4);
  g.fillStyle(W, 1);
  g.fillCircle(-11.4, -0.4 + swing * 0.5, 2.3);
  g.fillCircle(11.4, -0.4 - swing * 0.5, 2.3);
}

/** Front, idle coin mascot. */
function drawCoinFront(g: CanvasGraphics) {
  const swing = 0;
  drawCoinLegs(g, swing);
  coinBody(g, 0, -7, 11, 11, true);
  drawCoinFace(g, 0, -8, 0);
  drawCoinArms(g, swing);
}

// ── Component ────────────────────────────────────────────────────────────────

export function AvatarPreview({ spec, size = 48 }: { spec: AvatarSpec; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    // Center the ~34px-tall figure (head y≈-17, feet y≈+15) with a small margin.
    ctx.translate(size / 2, size * 0.62);
    const scale = size / 40;
    ctx.scale(scale, scale);

    const g = new CanvasGraphics(ctx);
    if (spec.coin) drawCoinFront(g);
    else drawFront(g, spec);

    ctx.restore();
  }, [spec, size]);

  return <canvas ref={canvasRef} width={size} height={size} />;
}
