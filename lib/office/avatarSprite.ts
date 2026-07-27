// lib/office/avatarSprite.ts
// Procedural 16-bit pixel-art character generator with a 2.5D/3D feel — built to
// sit convincingly beside the FundExecs persona sprites
// (public/assets/fundexecs/characters/*/walk.png). It emits a walk-cycle ATLAS
// in the persona layout: a 768×1024 sheet of 256px cells, 3 walk frames
// (columns) × 4 facings (rows: down, up, left, right).
//
// Volume comes from three cues borrowed from the persona art: a top-left key
// light with 3-tone cel shading + dithered gradients, occlusion at the joins
// (under jaw, under arms, inseam), and a light RIM-OUTLINE halo around the
// silhouette. Drawn on a 128px native grid (×2 → 256) for rounded forms.
//
// The part drawing (drawAvatarFrameParts) only needs a Canvas2D-like sink, so it
// is pure + deterministic and unit-testable without a real canvas. The rim halo
// is a canvas-only compositing pass layered on top by drawAvatarFrame /
// drawAvatarAtlas.

import {
  hairHex,
  outfitHex,
  skinHex,
  type AvatarConfig,
} from "@/lib/office/avatarConfig";

// Atlas geometry — mirrors the persona walk.png sheets exactly.
export const NATIVE = 128; // native pixels per cell edge
export const CELL = 256; // rendered cell edge
export const UNIT = CELL / NATIVE; // 2 device px per native pixel
export const COLS = 3; // walk frames
export const ROWS = 4; // facings
export const ATLAS_W = COLS * CELL; // 768
export const ATLAS_H = ROWS * CELL; // 1024

/** Row index per facing — must match map.html's `dir` (0 down,1 up,2 left,3 right). */
export const DIR = { down: 0, up: 1, left: 2, right: 3 } as const;
export type Facing = keyof typeof DIR;

// A minimal 2D sink so the generator is testable without a real canvas. The
// fillStyle type matches CanvasRenderingContext2D's (a real ctx is a valid sink).
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
  skin: string; skinSh: string; skinHi: string; skinDp: string;
  hair: string; hairSh: string; hairHi: string;
  fit: string; fitSh: string; fitHi: string; fitDp: string;
  shirt: string; shirtSh: string;
  ink: string; rim: string; shoe: string; shoeHi: string;
}
function paletteFor(c: AvatarConfig): Palette {
  const skin = skinHex(c), hair = hairHex(c), fit = outfitHex(c);
  return {
    skin, skinSh: shade(skin, -0.12), skinHi: shade(skin, 0.1), skinDp: shade(skin, -0.24),
    hair, hairSh: shade(hair, -0.16), hairHi: shade(hair, 0.14),
    fit, fitSh: shade(fit, -0.14), fitHi: shade(fit, 0.12), fitDp: shade(fit, -0.28),
    shirt: "#eef2f7", shirtSh: "#c2ccd8",
    ink: shade(fit, -0.62) === fit ? "#161018" : "#171019",
    rim: "#f3efe6",
    shoe: "#181820", shoeHi: "#33333f",
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
  // Checkerboard dither between two tones — a classic 16-bit gradient.
  dither(x: number, y: number, w: number, h: number, a: string, b: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.r(x + i, y + j, 1, 1, (i + j) & 1 ? a : b);
  }
}

const CX = 64;

// ── head ─────────────────────────────────────────────────────────────────────
const HEAD = { top: 10, cx: CX };
// [dyFromTop, halfWidth, height] — a rounded oval with crown + tapered jaw.
const HEAD_BANDS: [number, number, number][] = [
  [0, 14, 3], [3, 18, 3], [6, 21, 3], [9, 23, 4],
  [13, 24, 20], [33, 23, 3], [36, 21, 3], [39, 17, 4], [43, 12, 3],
];

function drawHeadOval(p: Painter, pal: Palette, fill: string) {
  const { top, cx } = HEAD;
  // Outline only the SILHOUETTE, not each band: draw a dark base 1px larger, then
  // the fill on top. Stacked fills leave no internal horizontal lines (the old
  // per-band blk() drew ink between every band → a venetian-blind face).
  for (const [dy, hw, h] of HEAD_BANDS) p.r(cx - hw - 1, top + dy, hw * 2 + 2, h, pal.ink);
  const f = HEAD_BANDS[0], l = HEAD_BANDS[HEAD_BANDS.length - 1];
  p.r(cx - f[1] - 1, top + f[0] - 1, f[1] * 2 + 2, 1, pal.ink); // top cap
  p.r(cx - l[1] - 1, top + l[0] + l[2], l[1] * 2 + 2, 1, pal.ink); // bottom cap
  for (const [dy, hw, h] of HEAD_BANDS) p.r(cx - hw, top + dy, hw * 2, h, fill);
}

function drawHeadShade(p: Painter, pal: Palette, facing: Facing) {
  const { top, cx } = HEAD;
  if (facing === "up") { p.r(cx - 18, top + 34, 36, 6, pal.hairSh); return; }
  // Restrained shading: a subtle top-left highlight + a thin shaded right edge,
  // kept minimal so it reads clean at this size (no busy face smudge).
  p.r(cx - 15, top + 10, 8, 3, pal.skinHi); // forehead highlight
  p.r(cx + 14, top + 12, 3, 20, pal.skinSh); // thin right-side shadow
  p.r(cx - 13, top + 41, 26, 2, pal.skinSh); // soft under-jaw (below the mouth)
}

// Ears (down + side).
function drawEars(p: Painter, pal: Palette, side: boolean) {
  const { top, cx } = HEAD;
  const ey = top + 22;
  if (side) { p.blk(cx - 4, ey, 6, 9, pal.skin, pal.ink); p.r(cx - 3, ey + 2, 2, 3, pal.skinSh); return; }
  p.blk(cx - 25, ey, 6, 9, pal.skin, pal.ink); p.r(cx - 24, ey + 2, 2, 3, pal.skinSh);
  p.blk(cx + 19, ey, 6, 9, pal.skin, pal.ink); p.r(cx + 22, ey + 2, 2, 3, pal.skinSh);
}

// ── hair ─────────────────────────────────────────────────────────────────────
function drawHairBack(p: Painter, c: AvatarConfig, pal: Palette) {
  const { top, cx } = HEAD;
  if (c.hair === "bald") return;
  if (c.hair === "long") p.blk(cx - 26, top + 8, 52, 52, pal.hairSh, pal.ink);
  else if (c.hair === "ponytail") { p.blk(cx + 16, top + 4, 12, 40, pal.hairSh, pal.ink); p.r(cx + 18, top + 8, 4, 30, pal.hair); }
  else if (c.hair === "bun") p.blk(cx - 11, top - 6, 22, 12, pal.hair, pal.ink);
  else if (c.hair === "afro") p.blk(cx - 28, top - 10, 56, 40, pal.hairSh, pal.ink); // big rounded mass behind the head
}
function drawHairFront(p: Painter, c: AvatarConfig, pal: Palette, side: boolean) {
  const { top, cx } = HEAD;
  if (c.hair === "bald") return;
  if (c.hair === "buzz") { p.r(cx - 21, top + 2, 42, 8, pal.hairSh); p.r(cx - 16, top + 3, 20, 3, pal.hair); return; }
  if (c.hair === "afro") {
    // rounded voluminous cloud of hair around the crown
    p.blk(cx - 26, top - 8, 52, 24, pal.hair, pal.ink);
    p.r(cx - 26, top + 12, 6, 12, pal.hair); p.r(cx + 20, top + 12, 6, 12, pal.hair);
    for (const dx of [-24, -14, -4, 8, 18]) p.blk(cx + dx, top - 11, 10, 8, pal.hair, pal.ink);
    p.r(cx - 18, top - 4, 16, 4, pal.hairHi);
    return;
  }
  if (c.hair === "spiky") {
    p.blk(cx - 22, top + 1, 44, 12, pal.hair, pal.ink);
    for (const dx of [-20, -12, -4, 4, 12, 18]) { p.r(cx + dx, top - 6, 4, 8, pal.hair); p.r(cx + dx + 1, top - 8, 2, 4, pal.hair); }
    p.r(cx - 18, top + 2, 16, 3, pal.hairHi);
    return;
  }
  // scalp cap — rounded crown (narrower top band over a wider base)
  p.blk(cx - 20, top - 3, 40, 6, pal.hair, pal.ink);
  p.blk(cx - 24, top + 2, 48, 12, pal.hair, pal.ink);
  p.r(cx - 24, top + 12, 6, 14, pal.hair); // left temple
  p.r(cx + 18, top + 12, 6, 14, pal.hair); // right temple
  p.r(cx - 16, top + 1, 12, 3, pal.hairHi); // crown sheen (subtle, top-left)
  if (c.hair === "short") p.r(cx - 20, top + 12, 40, 4, pal.hair);
  else if (c.hair === "side") { p.r(cx - 8, top + 12, 26, 5, pal.hairHi); p.r(cx - 20, top + 12, 12, 4, pal.hair); }
  else if (c.hair === "curly") { for (let i = -22; i <= 16; i += 8) p.blk(cx + i, top - 3, 11, 10, pal.hair, pal.ink); p.r(cx - 18, top + 2, 14, 3, pal.hairHi); }
  else if (c.hair === "long") { if (!side) { p.r(cx - 26, top + 12, 6, 34, pal.hair); p.r(cx + 20, top + 12, 6, 34, pal.hair); } else p.r(cx + 14, top + 12, 8, 32, pal.hairSh); }
  else p.r(cx - 20, top + 12, 40, 3, pal.hair); // bun/ponytail front
}

// ── facial hair (down / side) ────────────────────────────────────────────────
function drawFacialHair(p: Painter, c: AvatarConfig, pal: Palette) {
  if (c.facialHair === "none") return;
  const { top, cx } = HEAD;
  const jawY = top + 36;
  if (c.facialHair === "stubble") { p.dither(cx - 16, top + 30, 32, 10, pal.hairSh, pal.skin); return; }
  if (c.facialHair === "moustache") { p.r(cx - 9, top + 30, 18, 4, pal.hair); return; }
  if (c.facialHair === "goatee") { p.r(cx - 8, top + 30, 16, 3, pal.hair); p.blk(cx - 6, jawY - 1, 12, 8, pal.hair, pal.ink); return; }
  // full beard: chin + sideburns, mouth gap
  p.r(cx - 15, jawY - 2, 30, 6, pal.hair);
  p.r(cx - 16, top + 22, 5, 16, pal.hairSh);
  p.r(cx + 11, top + 22, 5, 16, pal.hairSh);
  p.r(cx - 12, jawY + 3, 24, 3, pal.hairSh);
}

// ── face features ─────────────────────────────────────────────────────────────
function eye(p: Painter, pal: Palette, x: number, y: number) {
  p.r(x, y, 8, 8, pal.ink);          // socket / lash
  p.r(x + 1, y + 1, 6, 5, "#fbfcfe"); // white
  p.r(x + 4, y + 1, 3, 5, pal.ink);   // pupil (looking forward-ish)
  p.r(x + 5, y + 2, 1, 1, "#cfe0ff"); // catchlight
}
function drawFaceDown(p: Painter, c: AvatarConfig, pal: Palette) {
  const { top, cx } = HEAD;
  const eyeY = top + 20;
  const ink = pal.ink;
  // brows
  if (c.expression === "focused") { p.r(cx - 15, eyeY - 5, 9, 2, ink); p.r(cx - 6, eyeY - 4, 2, 2, ink); p.r(cx + 6, eyeY - 5, 9, 2, ink); p.r(cx + 4, eyeY - 4, 2, 2, ink); }
  else { p.r(cx - 15, eyeY - 5, 9, 2, ink); p.r(cx + 6, eyeY - 5, 9, 2, ink); }
  eye(p, pal, cx - 14, eyeY);
  eye(p, pal, cx + 6, eyeY);
  // nose (small, no wide base)
  p.r(cx - 1, eyeY + 8, 2, 4, pal.skinSh);
  // mouth
  const my = eyeY + 18;
  if (c.expression === "smile") { p.r(cx - 7, my, 14, 2, ink); p.r(cx - 9, my - 2, 2, 2, ink); p.r(cx + 7, my - 2, 2, 2, ink); p.r(cx - 5, my + 2, 10, 1, "#c8776f"); }
  else if (c.expression === "focused") p.r(cx - 5, my, 10, 2, ink);
  else { p.r(cx - 6, my, 12, 2, ink); }
}
function drawFaceSide(p: Painter, c: AvatarConfig, pal: Palette) {
  const { top, cx } = HEAD;
  const eyeY = top + 20;
  const ink = pal.ink;
  if (c.expression === "focused") p.r(cx + 2, eyeY - 5, 9, 2, ink);
  else p.r(cx + 3, eyeY - 5, 8, 2, ink);
  // single forward eye
  p.r(cx + 5, eyeY, 6, 7, ink); p.r(cx + 6, eyeY + 1, 3, 4, "#fbfcfe"); p.r(cx + 8, eyeY + 1, 2, 4, ink);
  // nose bump on the front edge
  p.r(cx + 16, eyeY + 4, 4, 6, pal.skin); p.r(cx + 18, eyeY + 4, 2, 5, pal.skinSh); p.r(cx + 19, eyeY + 3, 1, 1, ink);
  const my = eyeY + 18;
  if (c.expression === "smile") p.r(cx + 6, my - 1, 10, 2, ink);
  else p.r(cx + 6, my, 9, 2, ink);
}

// ── eyewear (10), drawn over the face ────────────────────────────────────────
function drawEyewear(p: Painter, c: AvatarConfig, pal: Palette, side: boolean) {
  const e = c.eyewear;
  if (e === "none") return;
  const { top, cx } = HEAD;
  const eyeY = top + 19;
  const ink = pal.ink;
  const clear = (x: number, y: number, w: number, h: number) => { p.r(x, y, w, 1, ink); p.r(x, y + h - 1, w, 1, ink); p.r(x, y, 1, h, ink); p.r(x + w - 1, y, 1, h, ink); };
  const dark = (x: number, y: number, w: number, h: number, col = "#15181f") => { p.r(x, y, w, h, col); p.r(x + 1, y + 1, w - 2, 2, "#2a3040"); };
  const round = (x: number, y: number) => { p.r(x + 1, y, 10, 1, ink); p.r(x + 1, y + 8, 10, 1, ink); p.r(x, y + 1, 1, 7, ink); p.r(x + 11, y + 1, 1, 7, ink); };

  if (side) {
    if (e === "sunglasses" || e === "aviators" || e === "goggles") dark(cx + 4, eyeY, 11, 9);
    else if (e === "visor") { p.r(cx + 2, eyeY + 1, 15, 5, "#39d0e0"); p.r(cx + 2, eyeY + 1, 15, 1, "#a7f0f7"); }
    else if (e === "eyepatch") { p.blk(cx + 4, eyeY - 1, 11, 10, ink, ink); p.r(cx + 4, top + 8, 13, 2, ink); }
    else if (e === "round" || e === "monocle") round(cx + 4, eyeY);
    else clear(cx + 4, eyeY, 11, e === "readers" ? 6 : 9);
    return;
  }

  if (e === "glasses" || e === "readers") { const yy = e === "readers" ? eyeY + 3 : eyeY, hh = e === "readers" ? 6 : 9; clear(cx - 16, yy, 12, hh); clear(cx + 4, yy, 12, hh); p.r(cx - 4, yy + 2, 8, 2, ink); }
  else if (e === "round") { round(cx - 16, eyeY); round(cx + 5, eyeY); p.r(cx - 4, eyeY + 3, 9, 1, ink); }
  else if (e === "sunglasses") { dark(cx - 16, eyeY, 12, 9); dark(cx + 4, eyeY, 12, 9); p.r(cx - 4, eyeY + 2, 8, 2, "#15181f"); }
  else if (e === "aviators") { const av = (x: number) => { p.r(x, eyeY, 12, 6, "#1a2230"); p.r(x + 1, eyeY + 6, 10, 3, "#1a2230"); p.r(x + 1, eyeY + 1, 10, 2, "#39506e"); }; av(cx - 16); av(cx + 4); p.r(cx - 4, eyeY + 1, 8, 2, "#caa64a"); }
  else if (e === "monocle") { clear(cx + 4, eyeY, 11, 9); p.r(cx + 9, eyeY + 9, 1, 12, "#8a8f98"); }
  else if (e === "goggles") { dark(cx - 17, eyeY - 1, 13, 11, "#26506a"); dark(cx + 4, eyeY - 1, 13, 11, "#26506a"); p.r(cx - 6, eyeY + 2, 10, 3, "#3a2f22"); p.r(cx - 24, eyeY, 3, 4, ink); p.r(cx + 21, eyeY, 3, 4, ink); }
  else if (e === "visor") { p.r(cx - 18, eyeY + 1, 36, 6, "#39d0e0"); p.r(cx - 18, eyeY + 1, 36, 1, "#a7f0f7"); p.r(cx - 18, eyeY + 1, 2, 6, "#1b8f9c"); p.r(cx + 16, eyeY + 1, 2, 6, "#1b8f9c"); }
  else if (e === "eyepatch") { p.blk(cx + 4, eyeY - 1, 12, 11, ink, ink); p.r(cx - 16, top + 7, 32, 2, ink); }
}

// ── headwear (10), drawn over the hair (some hide the hair top) ───────────────
function drawHeadwear(p: Painter, c: AvatarConfig, pal: Palette, facing: Facing) {
  const h = c.headwear;
  if (h === "none") return;
  const { top, cx } = HEAD;
  const side = facing === "left" || facing === "right";
  const back = facing === "up";
  if (h === "cap") {
    p.blk(cx - 22, top - 4, 44, 12, "#243b63", pal.ink);
    p.r(cx - 18, top - 2, 20, 3, "#33518a");
    if (back) p.r(cx - 6, top + 6, 12, 3, "#1c2e4a");
    else if (side) p.r(cx + 14, top + 6, 20, 4, "#1c2e4a");
    else p.r(cx - 20, top + 7, 40, 4, "#1c2e4a");
  } else if (h === "beanie") {
    p.blk(cx - 22, top - 6, 44, 18, "#3a4657", pal.ink);
    p.dither(cx - 20, top - 4, 40, 8, "#46536a", "#3a4657");
    p.r(cx - 22, top + 8, 44, 5, "#2c3543");
  } else if (h === "fedora") {
    p.r(cx - 30, top + 6, 60, 4, "#4a3520");
    if (!back) p.r(cx - 28, top + 8, 56, 2, "#2a1e12");
    p.blk(cx - 18, top - 8, 36, 16, "#5a4326", pal.ink);
    p.r(cx - 18, top + 2, 36, 3, "#2a1e12");
  } else if (h === "beret") {
    p.blk(cx - 20, top - 6, 42, 12, "#8a2f3a", pal.ink);
    p.r(cx - 16, top - 4, 20, 3, "#a5424e");
    if (!back) p.r(cx + 18, top - 8, 5, 4, "#8a2f3a");
  } else if (h === "headband") {
    p.r(cx - 24, top + 4, 48, 5, "#c94b3b"); p.r(cx - 24, top + 4, 48, 1, "#e07160");
  } else if (h === "headphones") {
    p.r(cx - 26, top - 2, 52, 4, "#2b303c");
    p.blk(cx - 30, top + 18, 9, 14, "#20242e", pal.ink);
    if (!side) p.blk(cx + 21, top + 18, 9, 14, "#20242e", pal.ink);
  } else if (h === "hardhat") {
    p.blk(cx - 22, top - 6, 44, 16, "#e8b23a", pal.ink);
    p.r(cx - 3, top - 6, 6, 16, "#c9962a");
    p.r(cx - 26, top + 8, 52, 4, "#d7a233");
  } else if (h === "sunvisor") {
    p.r(cx - 22, top + 2, 44, 5, "#2f7d55");
    if (!back) p.r(cx - 24, top + 6, 48, 4, "#3a996a");
  } else if (h === "crown") {
    p.r(cx - 18, top - 2, 36, 7, "#e6b422");
    for (const dx of [-16, -8, 0, 8, 14]) p.r(cx + dx, top - 10, 4, 9, "#e6b422");
    p.r(cx - 2, top - 13, 4, 4, "#f2d24a");
    p.r(cx - 16, top, 32, 2, "#b8901a");
    if (!back) { p.r(cx - 10, top + 1, 3, 3, "#b3402f"); p.r(cx + 7, top + 1, 3, 3, "#2f6fb3"); }
  }
}

// ── worn accessories (10) — neck / chest / wrist / ears ──────────────────────
function drawAccessory(p: Painter, c: AvatarConfig, pal: Palette, side: boolean) {
  const a = c.accessories;
  if (a === "none") return;
  const { top, cx } = HEAD;
  const tT = 58; // torsoTop
  const w = BUILD[c.body] ?? BUILD.regular;
  if (a === "lanyard") {
    p.r(cx - 10, tT, 2, 18, "#c94b3b"); if (!side) p.r(cx + 8, tT, 2, 18, "#c94b3b");
    p.blk(cx - 6, tT + 16, 12, 10, "#e8edf5", pal.ink); p.r(cx - 4, tT + 19, 8, 2, "#98a2b3");
  } else if (a === "badge") {
    p.r(cx + 6, tT + 6, 3, 4, "#8a8f98"); p.blk(cx + 2, tT + 9, 12, 10, "#e8edf5", pal.ink);
    p.r(cx + 4, tT + 12, 8, 2, "#4f8bc7"); p.r(cx + 4, tT + 15, 6, 1, "#98a2b3");
  } else if (a === "scarf") {
    p.blk(cx - 9, 50, 18, 8, "#b3402f", pal.ink); p.r(cx - 9, 54, 18, 1, "#8f2f22");
    p.r(cx + 2, 57, 5, 16, "#b3402f"); p.r(cx + 3, 57, 3, 15, "#c85b48");
  } else if (a === "necklace") {
    p.r(cx - 6, 57, 12, 1, "#e6c34a"); p.r(cx - 5, 58, 10, 1, "#caa64a"); p.blk(cx - 1, 59, 3, 3, "#e6c34a", "#b8901a");
  } else if (a === "tie_clip") {
    p.r(cx - 3, tT + 16, 6, 2, "#caa64a"); p.r(cx - 3, tT + 16, 6, 1, "#f2d24a");
  } else if (a === "lapel_pin") {
    p.r(cx - 8, tT + 5, 3, 3, "#c94b3b"); p.r(cx - 8, tT + 5, 1, 1, "#f2d24a");
  } else if (a === "suspenders") {
    p.r(cx - 9, tT + 2, 3, 34, "#4a3520"); if (!side) p.r(cx + 6, tT + 2, 3, 34, "#4a3520");
    p.r(cx - 9, tT + 3, 1, 32, "#6a5030"); if (!side) p.r(cx + 6, tT + 3, 1, 32, "#6a5030");
    p.r(cx - 9, tT + 18, 3, 2, "#caa64a"); if (!side) p.r(cx + 6, tT + 18, 3, 2, "#caa64a"); // clips
  } else if (a === "watch") {
    if (side) { p.r(cx - 2, tT + 30, 6, 2, "#20242e"); }
    else { p.r(cx + w / 2 - 1, tT + 30, 7, 2, "#20242e"); p.r(cx + w / 2 + 1, tT + 30, 2, 2, "#4f8bc7"); }
  } else if (a === "earrings") {
    if (side) p.r(cx - 3, top + 30, 2, 3, "#e6c34a");
    else { p.r(cx - 23, top + 30, 2, 3, "#e6c34a"); p.r(cx + 21, top + 30, 2, 3, "#e6c34a"); }
  }
}

// ── body ─────────────────────────────────────────────────────────────────────
const BUILD: Record<string, number> = { slim: 36, regular: 42, broad: 50 };
function legPhase(frame: number): number { return frame === 0 ? -1 : frame === 2 ? 1 : 0; }

// Held prop, carried in the (screen-)right hand for down/side; mirrored for the
// left/right facings by the painter automatically.
function drawProp(p: Painter, c: AvatarConfig, pal: Palette, hx: number, hy: number) {
  switch (c.holding) {
    case "briefcase":
      p.blk(hx - 8, hy, 18, 14, "#5a4326", pal.ink);
      p.r(hx - 8, hy + 5, 18, 2, "#3f2f1a");
      p.r(hx - 2, hy - 3, 6, 4, "#3f2f1a"); // handle
      p.r(hx + 5, hy + 2, 2, 2, "#c9a24b"); // latch
      break;
    case "coffee":
      p.blk(hx - 4, hy, 12, 14, "#f3ede2", pal.ink);
      p.r(hx - 4, hy + 3, 12, 3, "#b7412f"); // sleeve
      p.r(hx - 2, hy - 3, 8, 3, "#e7e0d2"); // lid
      p.r(hx, hy - 6, 3, 3, "#c9c2b4"); // steam/tab
      break;
    case "tablet":
      p.blk(hx - 6, hy - 4, 16, 20, "#20242e", pal.ink);
      p.r(hx - 4, hy - 2, 12, 14, "#3a6ea5");
      p.dither(hx - 4, hy - 2, 12, 6, "#4f8bc7", "#3a6ea5");
      break;
    case "phone":
      p.blk(hx - 3, hy - 2, 9, 16, "#20242e", pal.ink);
      p.r(hx - 1, hy, 5, 10, "#4f8bc7");
      break;
    default:
      break;
  }
}

function shadeTorso(p: Painter, pal: Palette, x0: number, top: number, w: number, h: number, back: boolean) {
  p.r(x0 + 5, top + 5, w - 10, 3, pal.fitHi); // shoulder highlight (below the shoulder step)
  p.r(x0 + 3, top + 5, 5, h - 10, pal.fitHi); // chest-left key light
  p.dither(x0 + 8, top + 6, 5, h - 12, pal.fitHi, pal.fit);
  p.r(x0 + w - 6, top + 4, 4, h - 7, pal.fitSh); // right side shadow
  p.dither(x0 + w - 10, top + 6, 4, h - 12, pal.fitSh, pal.fit);
  p.r(x0 + 2, top + h - 4, w - 4, 3, pal.fitSh); // hem shadow
  if (!back) { p.r(x0, top + 2, 3, 8, pal.fitSh); p.r(x0 + w - 3, top + 2, 3, 8, pal.fitSh); } // underarm occlusion
}

function drawBodyFrontBack(p: Painter, c: AvatarConfig, pal: Palette, back: boolean, frame: number) {
  const cx = CX;
  const w = BUILD[c.body] ?? BUILD.regular;
  const x0 = cx - w / 2;
  const torsoTop = 58, torsoH = 40, torsoBot = torsoTop + torsoH;
  const isDress = c.outfit === "dress";
  const ph = legPhase(frame);

  // legs / skirt
  if (isDress) {
    p.blk(cx - w / 2 - 2, torsoBot - 2, w + 4, 18, pal.fit, pal.ink);
    p.r(cx - 2, torsoBot, 4, 16, pal.fitSh);
    p.blk(cx - 12, torsoBot + 14, 10, 10, pal.skin, pal.ink);
    p.blk(cx + 2, torsoBot + 14, 10, 10, pal.skin, pal.ink);
    p.blk(cx - 13, torsoBot + 22, 12, 5, pal.shoe, pal.ink);
    p.blk(cx + 1, torsoBot + 22, 12, 5, pal.shoe, pal.ink);
  } else {
    const lh = 24;
    p.blk(cx - 13, torsoBot - 2 + (ph < 0 ? 2 : 0), 12, lh - (ph < 0 ? 2 : 0), pal.fit, pal.ink);
    p.blk(cx + 1, torsoBot - 2 + (ph > 0 ? 2 : 0), 12, lh - (ph > 0 ? 2 : 0), pal.fit, pal.ink);
    p.r(cx - 2, torsoBot, 1, lh - 4, pal.fitSh); p.r(cx + 1, torsoBot, 1, lh - 4, pal.fitSh); // inseam
    p.r(cx - 12, torsoBot, 2, lh - 6, pal.fitHi); // outer leg light
    p.blk(cx - 14, torsoBot + lh - 4, 14, 6, pal.shoe, pal.ink);
    p.blk(cx, torsoBot + lh - 4, 14, 6, pal.shoe, pal.ink);
    p.r(cx - 13, torsoBot + lh - 3, 5, 1, pal.shoeHi); p.r(cx + 1, torsoBot + lh - 3, 5, 1, pal.shoeHi);
  }

  // torso with sloped (stepped) shoulders
  p.blk(x0 + 4, torsoTop, w - 8, 5, pal.fit, pal.ink);
  p.blk(x0, torsoTop + 4, w, torsoH - 4, pal.fit, pal.ink);
  shadeTorso(p, pal, x0, torsoTop, w, torsoH, back);

  if (!back) {
    const o = c.outfit;
    if (o === "suit" || o === "blazer" || o === "shirt" || o === "vest") {
      // shirt panel (vest shows a darker vest over the shirt)
      p.blk(cx - 7, torsoTop + 2, 14, 28, o === "shirt" ? pal.fit : pal.shirt, pal.ink);
      if (o === "suit" || o === "blazer") { p.r(cx - 10, torsoTop, 6, 16, pal.fitSh); p.r(cx + 4, torsoTop, 6, 16, pal.fitSh); }
      else if (o === "shirt") p.r(cx - 7, torsoTop, 14, 4, pal.shirtSh);
      if (o === "vest") { p.r(cx - 6, torsoTop + 6, 12, 24, pal.fitDp); p.r(cx - 2, torsoTop + 4, 4, 22, "#b3402f"); p.r(cx - 5, torsoTop + 6, 10, 2, pal.fitSh); p.r(cx + 3, torsoTop + 10, 1, 14, "#caa64a"); }
      if (o === "suit") { p.r(cx - 2, torsoTop + 2, 4, 24, "#b3402f"); p.r(cx - 3, torsoTop + 24, 6, 4, "#8f2f22"); }
    } else if (o === "polo") { p.blk(cx - 6, torsoTop + 1, 12, 8, pal.fitHi, pal.ink); p.r(cx - 1, torsoTop + 2, 2, 10, pal.fitSh); p.r(cx - 3, torsoTop + 4, 2, 2, pal.shirtSh); p.r(cx + 1, torsoTop + 7, 2, 2, pal.shirtSh); }
    else if (o === "tee") { p.r(cx - 6, torsoTop, 12, 3, pal.fitSh); p.r(cx - 5, torsoTop + 1, 10, 2, pal.fit); }
    else if (o === "turtleneck") { p.r(cx - 8, torsoTop - 2, 16, 6, pal.fitHi); p.r(cx - 8, torsoTop - 2, 16, 2, pal.fitSh); }
    else if (o === "sweater") { p.r(cx - 8, torsoTop - 1, 16, 4, pal.fitSh); p.dither(cx - (w / 2 - 2), torsoTop + 6, w - 4, 4, pal.fitHi, pal.fit); p.r(cx - 9, torsoBot - 6, 18, 3, pal.fitSh); }
    else if (o === "hoodie") { p.r(cx - 2, torsoTop, 4, torsoH - 6, pal.fitSh); p.r(cx - 9, torsoTop - 2, 18, 4, pal.fitSh); p.r(cx - 12, torsoTop + 4, 4, 10, pal.fitHi); }
  }

  // neck
  p.blk(cx - 6, 50, 12, 10, pal.skin, pal.ink);
  p.r(cx - 6, 50, 12, 3, pal.skinSh);

  // arms + hands — tucked against the torso so the shoulders don't read broad
  p.blk(x0 - 4, torsoTop + 6, 8, 28, pal.fit, pal.ink);
  p.blk(cx + w / 2 - 4, torsoTop + 6, 8, 28, pal.fit, pal.ink);
  p.r(x0 - 4, torsoTop + 7, 2, 22, pal.fitHi);
  p.r(cx + w / 2 + 2, torsoTop + 7, 2, 22, pal.fitSh);
  p.blk(x0 - 3, torsoTop + 32, 7, 7, pal.skin, pal.ink);
  p.blk(cx + w / 2 - 3, torsoTop + 32, 7, 7, pal.skin, pal.ink);
  if (c.holding !== "none") drawProp(p, c, pal, cx + w / 2, torsoTop + 36);
}

function drawBodySide(p: Painter, c: AvatarConfig, pal: Palette, frame: number) {
  const cx = CX;
  const w = Math.round((BUILD[c.body] ?? BUILD.regular) * 0.66);
  const x0 = cx - w / 2 + 2;
  const torsoTop = 58, torsoH = 40, torsoBot = torsoTop + torsoH;
  const ph = legPhase(frame);
  const isDress = c.outfit === "dress";

  if (isDress) {
    p.blk(cx - w / 2, torsoBot - 2, w + 4, 18, pal.fit, pal.ink);
    p.blk(cx - 2 + ph * 3, torsoBot + 14, 10, 10, pal.skin, pal.ink);
    p.blk(cx - 4 + ph * 3, torsoBot + 22, 15, 5, pal.shoe, pal.ink);
  } else {
    const lh = 24;
    p.blk(cx - 8 - ph * 3, torsoBot - 2, 12, lh, pal.fitSh, pal.ink); // back leg
    p.blk(cx - 2 + ph * 3, torsoBot - 2, 12, lh, pal.fit, pal.ink);   // front leg
    p.blk(cx - 10 - ph * 3, torsoBot + lh - 4, 16, 6, pal.shoe, pal.ink);
    p.blk(cx - 2 + ph * 3, torsoBot + lh - 4, 17, 6, pal.shoe, pal.ink);
    p.r(cx - 1 + ph * 3, torsoBot + lh - 3, 6, 1, pal.shoeHi);
  }

  p.blk(x0, torsoTop, w, torsoH, pal.fit, pal.ink);
  p.r(x0 + 2, torsoTop + 2, w - 4, 3, pal.fitHi);
  p.r(x0 + w - 5, torsoTop + 4, 3, torsoH - 8, pal.fitSh);
  p.dither(x0 + w - 9, torsoTop + 6, 4, torsoH - 12, pal.fitSh, pal.fit);
  p.r(x0 + 2, torsoBot - 4, w - 4, 3, pal.fitSh);
  if (c.outfit === "suit") p.r(cx + 4, torsoTop + 3, 3, 18, "#b3402f");

  // neck + one visible arm swinging
  p.blk(cx - 2, 50, 10, 10, pal.skin, pal.ink);
  const armX = cx - 4 + (ph > 0 ? 5 : -2);
  p.blk(armX, torsoTop + 2, 9, 30, pal.fitSh, pal.ink);
  p.blk(armX + 1, torsoTop + 30, 7, 7, pal.skin, pal.ink);
  if (c.holding !== "none") drawProp(p, c, pal, armX + 4, torsoTop + 34);
}

/** Draw one atlas frame's PARTS (no rim halo) — pure + sink-based, for tests. */
export function drawAvatarFrameParts(
  sink: PixelSink,
  config: AvatarConfig,
  facing: Facing,
  frame: number,
  unit = UNIT,
  ox = 0,
  oy = 0,
) {
  const pal = paletteFor(config);
  const p = new Painter(sink, ox, oy, unit, facing === "right");

  if (facing === "up") {
    drawHairBack(p, config, pal);
    drawBodyFrontBack(p, config, pal, true, frame);
    drawHeadOval(p, pal, config.hair === "bald" ? pal.skin : pal.hair);
    if (config.hair === "bald") drawHeadShade(p, pal, "up");
    drawHairFront(p, config, pal, false);
    drawHeadwear(p, config, pal, "up");
    drawAccessory(p, config, pal, false);
  } else if (facing === "down") {
    drawHairBack(p, config, pal);
    drawBodyFrontBack(p, config, pal, false, frame);
    drawEars(p, pal, false);
    drawHeadOval(p, pal, pal.skin);
    drawHeadShade(p, pal, "down");
    drawFacialHair(p, config, pal);
    drawFaceDown(p, config, pal);
    drawEyewear(p, config, pal, false);
    drawHairFront(p, config, pal, false);
    drawHeadwear(p, config, pal, "down");
    drawAccessory(p, config, pal, false);
  } else {
    drawHairBack(p, config, pal);
    drawBodySide(p, config, pal, frame);
    drawEars(p, pal, true);
    drawHeadOval(p, pal, pal.skin);
    drawHeadShade(p, pal, "left");
    drawFacialHair(p, config, pal);
    drawFaceSide(p, config, pal);
    drawEyewear(p, config, pal, true);
    drawHairFront(p, config, pal, true);
    drawHeadwear(p, config, pal, facing);
    drawAccessory(p, config, pal, true);
  }
}

const FACINGS: Facing[] = ["down", "up", "left", "right"];

// ── canvas layer: rim halo + composite ───────────────────────────────────────
type Ctx2D = CanvasRenderingContext2D;
type Canvas = HTMLCanvasElement;

function makeCanvas(w: number, h: number): Canvas | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  return cv;
}

// Render one 256px cell's parts to its own transparent canvas.
function renderPartsCell(config: AvatarConfig, facing: Facing, frame: number): Canvas | null {
  const cv = makeCanvas(CELL, CELL);
  if (!cv) return null;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  drawAvatarFrameParts(ctx, config, facing, frame, UNIT, 0, 0);
  return cv;
}

// Stamp a light rim outline (silhouette dilated by 1 native px) then the parts.
function compositeWithHalo(dest: Ctx2D, cell: Canvas, ox: number, oy: number, rim: string) {
  const sil = makeCanvas(CELL, CELL);
  if (sil) {
    const sctx = sil.getContext("2d");
    if (sctx) {
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(cell, 0, 0);
      sctx.globalCompositeOperation = "source-in";
      sctx.fillStyle = rim;
      sctx.fillRect(0, 0, CELL, CELL);
      const o = UNIT;
      const offs: [number, number][] = [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]];
      dest.save();
      dest.globalAlpha = 0.9;
      for (const [dx, dy] of offs) dest.drawImage(sil, ox + dx, oy + dy);
      dest.restore();
    }
  }
  dest.drawImage(cell, ox, oy);
}

/** Draw a single framed avatar (with rim halo) into a canvas context at (ox,oy). */
export function drawAvatarFrame(ctx: Ctx2D, config: AvatarConfig, facing: Facing, frame: number, ox = 0, oy = 0) {
  const cell = renderPartsCell(config, facing, frame);
  const pal = paletteFor(config);
  if (!cell) { drawAvatarFrameParts(ctx, config, facing, frame, UNIT, ox, oy); return; }
  compositeWithHalo(ctx, cell, ox, oy, pal.rim);
}

/** Draw the full 3×4 atlas (with rim halo) onto a 768×1024 canvas context. */
export function drawAvatarAtlas(ctx: Ctx2D, config: AvatarConfig) {
  const pal = paletteFor(config);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = renderPartsCell(config, FACINGS[row], col);
      if (cell) compositeWithHalo(ctx, cell, col * CELL, row * CELL, pal.rim);
      else drawAvatarFrameParts(ctx, config, FACINGS[row], col, UNIT, col * CELL, row * CELL);
    }
  }
}

/**
 * Render the atlas to a PNG data URL. Browser-only (needs a real canvas);
 * returns "" if no canvas is available so callers can fall back gracefully.
 */
export function avatarAtlasDataURL(config: AvatarConfig): string {
  const cv = makeCanvas(ATLAS_W, ATLAS_H);
  if (!cv) return "";
  const ctx = cv.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = false;
  drawAvatarAtlas(ctx, config);
  return cv.toDataURL("image/png");
}
