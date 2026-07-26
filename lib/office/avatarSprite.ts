// lib/office/avatarSprite.ts
// Procedural 16-bit pixel-art character generator. Draws a member's AvatarConfig
// as a walk-cycle sprite ATLAS matching the FundExecs persona atlases
// (public/assets/fundexecs/characters/*/walk.png): a 768×1024 sheet of 256px
// cells, 3 walk frames (columns) × 4 facings (rows: down, up, left, right). This
// replaces the old flat-vector paper-doll so the member's avatar reads in the
// exact same idiom as the AI staff on the office floor.
//
// Everything is drawn from ~a 64×64 native pixel grid scaled ×4 → hard 16-bit
// pixels. Pure + deterministic (same config → same atlas). The draw path only
// needs a Canvas2D-like sink (fillStyle + fillRect), so it runs in the browser
// for real rendering and against a mock in tests.

import {
  hairHex,
  outfitHex,
  skinHex,
  type AvatarConfig,
} from "@/lib/office/avatarConfig";

// Atlas geometry — mirrors the persona walk.png sheets exactly.
export const NATIVE = 64; // native pixels per cell edge
export const CELL = 256; // rendered cell edge
export const UNIT = CELL / NATIVE; // 4 device px per native pixel
export const COLS = 3; // walk frames
export const ROWS = 4; // facings
export const ATLAS_W = COLS * CELL; // 768
export const ATLAS_H = ROWS * CELL; // 1024

/** Row index per facing — must match map.html's `dir` (0 down,1 up,2 left,3 right). */
export const DIR = { down: 0, up: 1, left: 2, right: 3 } as const;
export type Facing = keyof typeof DIR;

// A minimal 2D sink so the generator is testable without a real canvas. The
// fillStyle type matches CanvasRenderingContext2D's (a real ctx is a valid sink)
// while the generator only ever assigns color strings to it.
export interface PixelSink {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

// ── color ────────────────────────────────────────────────────────────────────
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = c(((n >> 16) & 255) + 255 * amt);
  const g = c(((n >> 8) & 255) + 255 * amt);
  const b = c((n & 255) + 255 * amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

interface Palette {
  skin: string; skinSh: string; skinHi: string;
  hair: string; hairSh: string; hairHi: string;
  fit: string; fitSh: string; fitHi: string;
  shirt: string; shirtSh: string;
  ink: string; // near-black outline
  shoe: string;
}
function paletteFor(c: AvatarConfig): Palette {
  const skin = skinHex(c), hair = hairHex(c), fit = outfitHex(c);
  return {
    skin, skinSh: shade(skin, -0.13), skinHi: shade(skin, 0.09),
    hair, hairSh: shade(hair, -0.16), hairHi: shade(hair, 0.1),
    fit, fitSh: shade(fit, -0.15), fitHi: shade(fit, 0.09),
    shirt: "#e9edf3", shirtSh: "#b9c2cf",
    ink: "#181019",
    shoe: "#141017",
  };
}

// ── painter: native-grid rectangles, with optional horizontal mirror ─────────
class Painter {
  constructor(
    private sink: PixelSink,
    private ox: number,
    private oy: number,
    private unit: number,
    private flip: boolean,
  ) {}
  // Fill native rect (x,y,w,h). Coordinates are the 64-grid; mirror flips x.
  r(x: number, y: number, w: number, h: number, color: string) {
    const nx = this.flip ? NATIVE - (x + w) : x;
    this.sink.fillStyle = color;
    this.sink.fillRect(this.ox + nx * this.unit, this.oy + y * this.unit, w * this.unit, h * this.unit);
  }
  // Outlined block: 1-native-px ink border with an inset fill.
  blk(x: number, y: number, w: number, h: number, fill: string, ink: string) {
    this.r(x, y, w, h, ink);
    if (w > 2 && h > 2) this.r(x + 1, y + 1, w - 2, h - 2, fill);
  }
}

// Head band geometry shared by all facings (a tapered oval, chibi proportions).
const HEAD = { top: 4, h: 24, cx: 32 }; // occupies y 4..28
const HEAD_BANDS: [number, number, number][] = [
  // [yOffsetFromTop, halfWidth, height]
  [0, 8, 3],
  [3, 11, 4],
  [7, 12, 12],
  [19, 10, 3],
];

function drawHeadOval(p: Painter, pal: Palette, fill: string) {
  const { top, cx } = HEAD;
  for (const [dy, hw, h] of HEAD_BANDS) {
    p.blk(cx - hw, top + dy, hw * 2, h, fill, pal.ink);
  }
}

// ── hair ─────────────────────────────────────────────────────────────────────
function drawHairBack(p: Painter, c: AvatarConfig, pal: Palette) {
  const { top, cx } = HEAD;
  if (c.hair === "bald") return;
  if (c.hair === "long") p.r(cx - 12, top + 4, 24, 26, pal.hairSh);
  else if (c.hair === "ponytail") p.r(cx + 8, top + 2, 6, 20, pal.hairSh);
  else if (c.hair === "bun") p.blk(cx - 5, top - 2, 10, 7, pal.hair, pal.ink);
}
function drawHairFront(p: Painter, c: AvatarConfig, pal: Palette, side: boolean) {
  const { top, cx } = HEAD;
  if (c.hair === "bald") return;
  const cap = (fill: string) => {
    p.r(cx - 11, top + 1, 22, 6, fill);      // crown
    p.r(cx - 11, top + 5, 4, 8, fill);        // left temple
    p.r(cx + 7, top + 5, 4, 8, fill);         // right temple
  };
  if (c.hair === "buzz") { p.r(cx - 10, top + 1, 20, 4, pal.hairSh); return; }
  cap(pal.hair);
  p.r(cx - 11, top, 22, 2, pal.ink);          // top outline
  if (c.hair === "short") { p.r(cx - 9, top + 6, 18, 2, pal.hair); }
  else if (c.hair === "side") { p.r(cx - 9, top + 6, 6, 3, pal.hairHi); p.r(cx - 3, top + 6, 12, 2, pal.hair); }
  else if (c.hair === "curly") {
    for (let i = -10; i <= 8; i += 6) p.r(cx + i, top - 1, 5, 4, pal.hair);
  } else if (c.hair === "long") {
    if (!side) { p.r(cx - 12, top + 6, 3, 16, pal.hair); p.r(cx + 9, top + 6, 3, 16, pal.hair); }
    else p.r(cx + 6, top + 6, 4, 16, pal.hairSh);
  } else if (c.hair === "ponytail" || c.hair === "bun") {
    p.r(cx - 9, top + 6, 18, 2, pal.hair);
  }
}

// ── facial hair (down / side) ─────────────────────────────────────────────────
function drawFacialHair(p: Painter, c: AvatarConfig, pal: Palette) {
  if (c.facialHair === "none") return;
  const { top, cx } = HEAD;
  const jawY = top + 18;
  if (c.facialHair === "stubble") { p.r(cx - 8, jawY, 16, 4, pal.hairSh); return; }
  if (c.facialHair === "moustache") { p.r(cx - 5, top + 16, 10, 2, pal.hair); return; }
  if (c.facialHair === "goatee") { p.r(cx - 5, top + 16, 10, 2, pal.hair); p.r(cx - 3, jawY + 1, 6, 4, pal.hair); return; }
  // full beard: chin + sideburns framing the jaw, leaving a mouth gap
  p.r(cx - 8, jawY, 16, 3, pal.hair);           // chin
  p.r(cx - 9, top + 11, 3, 9, pal.hairSh);      // left sideburn
  p.r(cx + 6, top + 11, 3, 9, pal.hairSh);      // right sideburn
}

// ── face features ─────────────────────────────────────────────────────────────
function drawFaceDown(p: Painter, c: AvatarConfig, pal: Palette) {
  const { top, cx } = HEAD;
  const eyeY = top + 12;
  // brows
  if (c.expression === "focused") { p.r(cx - 7, eyeY - 3, 4, 1, pal.ink); p.r(cx + 3, eyeY - 3, 4, 1, pal.ink); }
  // eyes
  p.r(cx - 6, eyeY, 2, 3, pal.ink);
  p.r(cx + 4, eyeY, 2, 3, pal.ink);
  // nose hint
  p.r(cx - 1, eyeY + 4, 2, 1, pal.skinSh);
  // mouth
  const my = eyeY + 7;
  if (c.expression === "smile") { p.r(cx - 3, my, 6, 1, pal.ink); p.r(cx - 4, my - 1, 1, 1, pal.ink); p.r(cx + 3, my - 1, 1, 1, pal.ink); }
  else if (c.expression === "focused") p.r(cx - 2, my, 4, 1, pal.ink);
  else p.r(cx - 3, my, 6, 1, pal.ink);
}
function drawFaceSide(p: Painter, c: AvatarConfig, pal: Palette) {
  const { top, cx } = HEAD;
  const eyeY = top + 12;
  // profile: single eye toward the front (mirrored automatically for right)
  if (c.expression === "focused") p.r(cx + 1, eyeY - 3, 4, 1, pal.ink);
  p.r(cx + 3, eyeY, 2, 3, pal.ink);
  // nose bump on the front edge
  p.r(cx + 8, eyeY + 1, 2, 3, pal.skin);
  p.r(cx + 8, eyeY, 1, 1, pal.ink);
  const my = eyeY + 7;
  if (c.expression === "smile") p.r(cx + 2, my - 1, 5, 1, pal.ink);
  else p.r(cx + 2, my, 4, 1, pal.ink);
}

// ── accessories ────────────────────────────────────────────────────────────────
function drawGlasses(p: Painter, c: AvatarConfig, pal: Palette, side: boolean) {
  if (c.accessory !== "glasses" && c.accessory !== "sunglasses") return;
  const { top, cx } = HEAD;
  const eyeY = top + 11;
  const dark = c.accessory === "sunglasses";
  // A thin lens frame that lets the eye read through (clear glasses); sunglasses
  // fill the lens dark instead.
  const frame = (x: number, y: number, w: number, h: number) => {
    if (dark) { p.r(x, y, w, h, "#15181f"); return; }
    p.r(x, y, w, 1, pal.ink); p.r(x, y + h - 1, w, 1, pal.ink);
    p.r(x, y, 1, h, pal.ink); p.r(x + w - 1, y, 1, h, pal.ink);
  };
  if (side) { frame(cx + 2, eyeY, 6, 4); return; }
  frame(cx - 8, eyeY, 6, 4);
  frame(cx + 2, eyeY, 6, 4);
  p.r(cx - 2, eyeY + 1, 4, 1, dark ? "#15181f" : pal.ink); // bridge
}
function drawHeadset(p: Painter, c: AvatarConfig, side: boolean) {
  if (c.accessory !== "headset") return;
  const { top, cx } = HEAD;
  p.r(cx - 12, top + 1, 2, 10, "#20242e"); // left band arm
  p.r(cx - 13, top + 9, 4, 5, "#20242e");  // ear cup
  if (!side) { p.r(cx + 10, top + 1, 2, 10, "#20242e"); p.r(cx + 9, top + 9, 4, 5, "#20242e"); }
  p.r(cx - 12, top - 1, 24, 2, "#2b303c");  // headband
  // mic boom
  p.r(cx - 13, top + 14, 6, 1, "#20242e");
  p.r(cx - 7, top + 14, 1, 3, "#20242e");
}

// ── body: torso + arms + legs, per facing + walk frame ───────────────────────
const BUILD: Record<string, number> = { slim: 20, regular: 24, broad: 28 };

// legIndex: -1 left-forward, 0 neutral, +1 right-forward (from walk frame)
function legPhase(frame: number): number { return frame === 0 ? -1 : frame === 2 ? 1 : 0; }

function drawBodyFrontBack(p: Painter, c: AvatarConfig, pal: Palette, back: boolean, frame: number) {
  const cx = HEAD.cx;
  const w = BUILD[c.body] ?? BUILD.regular;
  const x0 = cx - w / 2;
  const torsoTop = 27, torsoBot = 45;
  const isDress = c.outfit === "dress";

  // legs / skirt
  const ph = legPhase(frame);
  if (isDress) {
    p.blk(cx - w / 2 - 1, 44, w + 2, 9, pal.fit, pal.ink); // skirt flare
    // bare lower legs
    p.blk(cx - 6, 52, 5, 7, pal.skin, pal.ink);
    p.blk(cx + 1, 52, 5, 7, pal.skin, pal.ink);
    p.r(cx - 6, 58, 5, 2, pal.shoe); p.r(cx + 1, 58, 5, 2, pal.shoe);
  } else {
    const lh = 14;
    p.blk(cx - 7, 45 + (ph < 0 ? 1 : 0), 6, lh - (ph < 0 ? 1 : 0), pal.fit, pal.ink);
    p.blk(cx + 1, 45 + (ph > 0 ? 1 : 0), 6, lh - (ph > 0 ? 1 : 0), pal.fit, pal.ink);
    p.r(cx - 7, 57, 6, 3, pal.shoe);
    p.r(cx + 1, 57, 6, 3, pal.shoe);
  }

  // torso (jacket / top)
  p.blk(x0, torsoTop, w, torsoBot - torsoTop, pal.fit, pal.ink);
  // side shading
  p.r(x0 + 1, torsoTop + 1, 2, torsoBot - torsoTop - 2, pal.fitSh);
  p.r(cx + w / 2 - 3, torsoTop + 1, 2, torsoBot - torsoTop - 2, pal.fitHi);

  if (!back) {
    // front details by outfit
    if (c.outfit === "suit" || c.outfit === "blazer" || c.outfit === "shirt") {
      // shirt V / placket
      p.r(cx - 3, torsoTop + 1, 6, 14, c.outfit === "shirt" ? pal.fit : pal.shirt);
      if (c.outfit !== "shirt") {
        p.r(cx - 5, torsoTop, 3, 8, pal.fitSh); // left lapel
        p.r(cx + 2, torsoTop, 3, 8, pal.fitSh); // right lapel
      } else {
        p.r(cx - 3, torsoTop, 6, 2, pal.shirtSh); // collar
      }
      if (c.outfit === "suit") { p.r(cx - 1, torsoTop + 1, 2, 12, "#b3402f"); } // tie
    } else if (c.outfit === "turtleneck") {
      p.r(cx - 4, torsoTop - 1, 8, 3, pal.fitHi); // rolled neck
    } else if (c.outfit === "hoodie") {
      p.r(cx - 1, torsoTop, 2, 16, pal.fitSh); // zip
      p.r(cx - 4, torsoTop - 1, 8, 2, pal.fitSh); // collar
    }
    if (c.accessory === "lanyard") {
      p.r(cx - 5, torsoTop, 1, 9, "#c94b3b"); p.r(cx + 4, torsoTop, 1, 9, "#c94b3b");
      p.blk(cx - 3, torsoTop + 8, 6, 5, "#e8edf5", pal.ink);
    }
  }

  // neck
  p.r(cx - 3, 25, 6, 3, pal.skin);
  // arms (sleeves + hands)
  p.blk(x0 - 4, torsoTop + 1, 5, 15, pal.fit, pal.ink);
  p.blk(cx + w / 2 - 1, torsoTop + 1, 5, 15, pal.fit, pal.ink);
  p.r(x0 - 3, torsoTop + 14, 3, 3, pal.skin);
  p.r(cx + w / 2, torsoTop + 14, 3, 3, pal.skin);
}

function drawBodySide(p: Painter, c: AvatarConfig, pal: Palette, frame: number) {
  const cx = HEAD.cx;
  const w = Math.round((BUILD[c.body] ?? BUILD.regular) * 0.7);
  const x0 = cx - w / 2 + 1;
  const torsoTop = 27, torsoBot = 45;
  const ph = legPhase(frame);
  const isDress = c.outfit === "dress";

  // legs in profile: front leg swings +x, back leg -x
  if (isDress) {
    p.blk(cx - w / 2, 44, w + 2, 9, pal.fit, pal.ink);
    p.blk(cx - 1 + ph, 52, 5, 7, pal.skin, pal.ink);
    p.r(cx - 2 + ph, 58, 7, 2, pal.shoe);
  } else {
    p.blk(cx - 4 - ph, 45, 6, 14, pal.fitSh, pal.ink); // back leg
    p.blk(cx - 1 + ph, 45, 6, 14, pal.fit, pal.ink);    // front leg
    p.r(cx - 5 - ph, 57, 7, 3, pal.shoe);
    p.r(cx - 1 + ph, 57, 8, 3, pal.shoe);
  }

  // torso
  p.blk(x0, torsoTop, w, torsoBot - torsoTop, pal.fit, pal.ink);
  p.r(x0 + w - 3, torsoTop + 1, 2, torsoBot - torsoTop - 2, pal.fitHi);
  if (c.outfit === "suit") p.r(cx + 2, torsoTop + 2, 2, 9, "#b3402f");
  // neck + one arm swinging
  p.r(cx - 1, 25, 5, 3, pal.skin);
  const armX = cx - 2 + (ph > 0 ? 2 : -1);
  p.blk(armX, torsoTop + 1, 5, 15, pal.fitSh, pal.ink);
  p.r(armX + 1, torsoTop + 14, 3, 3, pal.skin);
}

/** Draw one atlas frame for a facing at (ox,oy) with the given native-pixel unit. */
export function drawAvatarFrame(
  sink: PixelSink,
  config: AvatarConfig,
  facing: Facing,
  frame: number,
  unit = UNIT,
  ox = 0,
  oy = 0,
) {
  const pal = paletteFor(config);
  const flip = facing === "right";
  const p = new Painter(sink, ox, oy, unit, flip);

  if (facing === "up") {
    drawHairBack(p, config, pal);
    drawBodyFrontBack(p, config, pal, true, frame);
    drawHeadOval(p, pal, config.hair === "bald" ? pal.skin : pal.hair); // back of head = hair
    drawHairFront(p, config, pal, false);
  } else if (facing === "down") {
    drawHairBack(p, config, pal);
    drawBodyFrontBack(p, config, pal, false, frame);
    drawHeadOval(p, pal, pal.skin);
    drawFacialHair(p, config, pal);
    drawFaceDown(p, config, pal);
    drawGlasses(p, config, pal, false);
    drawHeadset(p, config, false);
    drawHairFront(p, config, pal, false);
  } else {
    // left (and right via mirror)
    drawHairBack(p, config, pal);
    drawBodySide(p, config, pal, frame);
    drawHeadOval(p, pal, pal.skin);
    drawFacialHair(p, config, pal);
    drawFaceSide(p, config, pal);
    drawGlasses(p, config, pal, true);
    drawHeadset(p, config, true);
    drawHairFront(p, config, pal, true);
  }
}

const FACINGS: Facing[] = ["down", "up", "left", "right"];

/** Draw the full 3×4 atlas onto a Canvas2D context sized ATLAS_W×ATLAS_H. */
export function drawAvatarAtlas(ctx: PixelSink, config: AvatarConfig) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      drawAvatarFrame(ctx, config, FACINGS[row], col, UNIT, col * CELL, row * CELL);
    }
  }
}

/**
 * Render the atlas to a PNG data URL. Browser-only (needs a real canvas);
 * returns "" if no canvas is available so callers can fall back gracefully.
 */
export function avatarAtlasDataURL(config: AvatarConfig): string {
  if (typeof document === "undefined") return "";
  const cv = document.createElement("canvas");
  cv.width = ATLAS_W;
  cv.height = ATLAS_H;
  const ctx = cv.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = false;
  drawAvatarAtlas(ctx, config);
  return cv.toDataURL("image/png");
}
