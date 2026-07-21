// The environment realism engine for the Virtual Office.
//
// A sibling to `officeProps.ts` (props) and `vectorAvatar.ts` (characters):
// where those draw the things IN the office, this module draws the SPACE
// itself — rich floor materials, walls that stand up off the floor and cast
// shadows, exterior windows, institutional signage, and a final cinematic
// lighting pass. The goal is for the top-down office to read as a real, lit
// INSTITUTIONAL room — an investment-bank executive floor rather than a flat
// diagram: hushed navy/charcoal surfaces, warm brass accents, restraint.
//
// LIGHT DIRECTION CONVENTION
// --------------------------
// There is ONE key light for the whole scene, and it comes from the TOP-LEFT
// (as if a window sits above and to the left of the floor plan). Consequences,
// applied consistently by every function here AND matching the shading language
// already used by `officeProps.ts` (top-lit gradients, top rim lights):
//   • Surfaces are LIGHTER at their top-left and DARKER toward the bottom-right.
//   • Cast shadows fall to the BOTTOM-RIGHT of whatever throws them.
//   • Raised edges catch a highlight on their top-left lip.
//   • The global lighting pass brightens the top-left of the floor and cools /
//     darkens the bottom-right, with soft ambient occlusion pooled in corners.
// {@link LIGHT} encodes this as a unit-ish direction (pointing the way the light
// travels: rightward and downward), so shadow offsets are `+LIGHT.x, +LIGHT.y`.
//
// Everything is plain Canvas 2D (no assets, no SDK), React-free, and cheap
// enough to run inside the render loop. Coordinates are in PIXELS unless noted;
// the caller converts TILE space via `TILE` and clips floor draws to the room.
import type { OfficeRoom } from "@/lib/office/layout";
import type { Wall, FloorStyle } from "@/lib/office/walls";

// ---------------------------------------------------------------------------
// Light convention + color helpers (mirror officeProps.ts / vectorAvatar.ts).
// ---------------------------------------------------------------------------

/**
 * The scene key light, expressed as the direction the light TRAVELS: to the
 * right and down. Shadows are therefore cast by offsetting a shape by
 * `(+LIGHT.x, +LIGHT.y)`, and lit edges sit on the opposite (top-left) side.
 */
export const LIGHT = { x: 0.7, y: 0.7 } as const;

/** Shared outline tone, matching the prop engine so walls sit with the props. */
const OUTLINE = "rgba(17, 22, 34, 0.5)";

/**
 * A small institutional brass palette — the one warm accent family the premium
 * office is allowed. Used for wall base trim, glass-partition frames, room
 * plaques, the hub crest, and the reception wordmark. Deliberately muted
 * (aged / brushed brass, not gold leaf) so it reads as hardware, not bling.
 */
export const BRASS = {
  /** Deep shadowed brass — engraving recesses, undersides. */
  dark: "#6b4f1d",
  /** The base tone of a brushed-brass surface. */
  base: "#a9822f",
  /** A polished mid brass for lit faces. */
  mid: "#c49a45",
  /** A bright catch-light on the top-left lip of brass hardware. */
  light: "#e6c56d",
  /** The hottest specular glint (used sparingly). */
  highlight: "#f6e6ad",
} as const;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.padStart(6, "0").slice(0, 6);
  return [
    parseInt(v.slice(0, 2), 16) || 0,
    parseInt(v.slice(2, 4), 16) || 0,
    parseInt(v.slice(4, 6), 16) || 0,
  ];
}

function mix(hex: string, target: [number, number, number], amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = Math.max(0, Math.min(1, amt));
  const m = (a: number, bb: number) => Math.round(a + (bb - a) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(m(r, target[0]))}${toHex(m(g, target[1]))}${toHex(m(b, target[2]))}`;
}

const lighten = (hex: string, amt: number) => mix(hex, [255, 255, 255], amt);
const darken = (hex: string, amt: number) => mix(hex, [0, 0, 0], amt);
/** Warm a color toward brass — the house accent temperature. */
const warm = (hex: string, amt: number) => mix(hex, hexToRgb(BRASS.base), amt);

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// A tiny seeded hash → deterministic "randomness" for grain/fleck placement, so
// every client renders identical floors (no Math.random in the draw path).
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------------------
// 1. Floor materials.
// ---------------------------------------------------------------------------

export interface FloorMaterialOptions {
  floor: FloorStyle;
  /** Room rect in PIXELS (top-left origin). The caller clips to the room. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Room accent (hex) — used sparingly for tint / seams. */
  accent: string;
  /** Base surface tint (hex) — the material's ground color. */
  surface: string;
}

/**
 * Draw a rich, INSTITUTIONAL floor material into the room rect. The caller is
 * responsible for clipping (e.g. a rounded-rect clip) before calling; this
 * function only fills within [x, x+w] × [y, y+h]. Everything here is muted and
 * low-contrast — dark hardwood, polished marble, large-format stone, dense
 * executive carpet, or a refined tech pinstripe — lit from the TOP-LEFT.
 */
export function drawFloorMaterial(
  ctx: CanvasRenderingContext2D,
  opts: FloorMaterialOptions,
): void {
  const { floor, x, y, w, h, accent, surface } = opts;
  if (w <= 0 || h <= 0) return;
  ctx.save();

  // A gentle, slightly-warm top-left → bottom-right base wash unifies every
  // material with the scene light before the per-material texture goes on top.
  const wash = ctx.createLinearGradient(x, y, x + w, y + h);
  wash.addColorStop(0, warm(lighten(surface, 0.05), 0.04));
  wash.addColorStop(1, darken(surface, 0.08));
  ctx.fillStyle = wash;
  ctx.fillRect(x, y, w, h);

  switch (floor) {
    case "wood":
      drawWood(ctx, x, y, w, h, surface, accent);
      break;
    case "carpet":
      drawCarpet(ctx, x, y, w, h, surface, accent);
      break;
    case "tile":
      drawTile(ctx, x, y, w, h, surface, accent);
      break;
    case "marble":
      drawMarble(ctx, x, y, w, h, surface, accent);
      break;
    default:
      drawTechGrid(ctx, x, y, w, h, surface, accent);
      break;
  }

  ctx.restore();
}

/** A single plank width scales with room size but stays in a readable band. */
function plankHeight(h: number): number {
  return Math.max(18, Math.min(34, h / 5));
}

function drawWood(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  surface: string,
  accent: string,
): void {
  const ph = plankHeight(h);
  // Dark, warm hardwood — walnut/wenge, not honey oak. Long planks.
  const plankBase = mix(darken(surface, 0.05), hexToRgb("#5a3d24"), 0.5);
  let row = 0;
  for (let py = y; py < y + h; py += ph, row++) {
    const bh = Math.min(ph, y + h - py);
    // Alternate plank tone very slightly so rows read individually but stay hushed.
    const tone = row % 2 === 0 ? lighten(plankBase, 0.035) : darken(plankBase, 0.035);
    const g = ctx.createLinearGradient(0, py, 0, py + bh);
    g.addColorStop(0, lighten(tone, 0.05));
    g.addColorStop(0.5, tone);
    g.addColorStop(1, darken(tone, 0.07));
    ctx.fillStyle = g;
    ctx.fillRect(x, py, w, bh);

    // Seam between rows (dark recess, with a thin top-left-lit lip just below).
    ctx.strokeStyle = rgba("#000000", 0.22);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, py + bh - 0.5);
    ctx.lineTo(x + w, py + bh - 0.5);
    ctx.stroke();
    ctx.strokeStyle = rgba("#ffffff", 0.045);
    ctx.beginPath();
    ctx.moveTo(x, py + 0.5);
    ctx.lineTo(x + w, py + 0.5);
    ctx.stroke();

    // Rich fine grain — several faint length-wise strokes per plank, wavering
    // deterministically so the timber reads as figured, not printed.
    const grains = 6;
    for (let gI = 0; gI < grains; gI++) {
      const gy = py + bh * (0.12 + 0.13 * gI + 0.05 * hash(row * 7.3 + gI));
      const dark = gI % 2 === 0;
      ctx.strokeStyle = dark
        ? rgba(darken(plankBase, 0.4), 0.14)
        : rgba(lighten(plankBase, 0.18), 0.07);
      ctx.lineWidth = dark ? 0.9 : 0.7;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      const steps = 4;
      for (let s = 1; s <= steps; s++) {
        const gx = x + (w * s) / steps;
        const wobble = (hash(row * 3.1 + gI * 1.7 + s) - 0.5) * bh * 0.18;
        ctx.lineTo(gx, gy + wobble);
      }
      ctx.stroke();
    }

    // Vertical board breaks, staggered per row (long-plank butt joints).
    ctx.strokeStyle = rgba("#000000", 0.14);
    ctx.lineWidth = 1;
    const boardW = Math.max(80, w / 4);
    const offset = (row % 2) * boardW * 0.5;
    for (let bx = x + offset; bx < x + w; bx += boardW) {
      ctx.beginPath();
      ctx.moveTo(bx + 0.5, py);
      ctx.lineTo(bx + 0.5, py + bh);
      ctx.stroke();
    }
  }

  // Low warm sheen — a restrained diagonal top-left highlight, satin not gloss.
  const sheen = ctx.createLinearGradient(x, y, x + w * 0.65, y + h);
  sheen.addColorStop(0, rgba("#ffedcf", 0.06));
  sheen.addColorStop(0.4, rgba("#ffffff", 0.015));
  sheen.addColorStop(0.55, rgba(accent, 0.02));
  sheen.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);
}

function drawCarpet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  surface: string,
  accent: string,
): void {
  // Dense executive loop carpet — a deep, desaturated base with a VERY subtle
  // two-tone tick woven through it. The accent barely tints the base.
  const base = mix(darken(surface, 0.04), hexToRgb(accent), 0.06);
  const alt = lighten(base, 0.022);
  const band = 6;
  for (let iy = 0; iy * band < h; iy++) {
    for (let ix = 0; ix * band < w; ix++) {
      if ((ix + iy) % 2 === 0) continue;
      ctx.fillStyle = rgba(alt, 0.55);
      ctx.fillRect(
        x + ix * band,
        y + iy * band,
        Math.min(band, w - ix * band),
        Math.min(band, h - iy * band),
      );
    }
  }

  // Fine looped pile — tight, low-contrast light/dark specks, deterministic.
  const step = 5;
  let i = 0;
  for (let py = y + 2.5; py < y + h; py += step) {
    for (let px = x + 2.5; px < x + w; px += step, i++) {
      const r = hash(i * 1.7);
      const jx = (hash(i * 3.1) - 0.5) * 1.8;
      const jy = (hash(i * 5.3) - 0.5) * 1.8;
      ctx.fillStyle = r < 0.5 ? rgba("#ffffff", 0.035) : rgba("#000000", 0.05);
      ctx.fillRect(px + jx, py + jy, 1.3, 1.3);
    }
  }

  // Top-left ambient brighten so the pile catches the key light, warm side up.
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, rgba("#ffe8c8", 0.04));
  g.addColorStop(1, rgba("#000000", 0.05));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  surface: string,
  accent: string,
): void {
  // Large-format stone / porcelain — big slabs, fine grout, subtle specular.
  const size = Math.max(34, Math.min(56, Math.min(w, h) / 3));
  const base = mix(lighten(surface, 0.03), hexToRgb(accent), 0.04);

  for (let iy = 0; iy * size < h; iy++) {
    for (let ix = 0; ix * size < w; ix++) {
      const tx = x + ix * size;
      const ty = y + iy * size;
      const tw = Math.min(size, x + w - tx);
      const th = Math.min(size, y + h - ty);
      // Slabs alternate only faintly — sophisticated, not a checkerboard.
      const checker = (ix + iy) % 2 === 0;
      const tone = checker ? lighten(base, 0.02) : darken(base, 0.02);
      const g = ctx.createLinearGradient(tx, ty, tx + tw, ty + th);
      g.addColorStop(0, lighten(tone, 0.045));
      g.addColorStop(1, darken(tone, 0.055));
      ctx.fillStyle = g;
      ctx.fillRect(tx, ty, tw, th);

      // Faint stone mottling within the slab (deterministic clouds).
      const clouds = 3;
      for (let c = 0; c < clouds; c++) {
        const seed = (ix * 13.1 + iy * 7.7 + c) * 1.3;
        const cxp = tx + tw * (0.2 + 0.6 * hash(seed));
        const cyp = ty + th * (0.2 + 0.6 * hash(seed + 1.4));
        ctx.fillStyle =
          c % 2 === 0 ? rgba("#ffffff", 0.02) : rgba("#000000", 0.025);
        ctx.beginPath();
        ctx.ellipse(cxp, cyp, tw * 0.22, th * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Subtle specular corner — a soft glint at the slab's top-left.
      const spec = ctx.createLinearGradient(tx, ty, tx + tw * 0.5, ty + th * 0.5);
      spec.addColorStop(0, rgba("#ffffff", 0.1));
      spec.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = spec;
      ctx.fillRect(tx, ty, tw, th);
    }
  }

  // Fine grout — a recessed dark line with a thin bottom-right lit lip.
  for (let gx = x + size; gx < x + w; gx += size) {
    ctx.strokeStyle = rgba("#000000", 0.14);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
    ctx.stroke();
    ctx.strokeStyle = rgba("#ffffff", 0.04);
    ctx.beginPath();
    ctx.moveTo(gx + 1.5, y);
    ctx.lineTo(gx + 1.5, y + h);
    ctx.stroke();
  }
  for (let gy = y + size; gy < y + h; gy += size) {
    ctx.strokeStyle = rgba("#000000", 0.14);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
    ctx.stroke();
    ctx.strokeStyle = rgba("#ffffff", 0.04);
    ctx.beginPath();
    ctx.moveTo(x, gy + 1.5);
    ctx.lineTo(x + w, gy + 1.5);
    ctx.stroke();
  }
}

function drawMarble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  surface: string,
  accent: string,
): void {
  // Polished marble slab with a gentle radial polish centred toward the top-left.
  const base = warm(lighten(surface, 0.05), 0.03);
  const polish = ctx.createRadialGradient(
    x + w * 0.32,
    y + h * 0.26,
    Math.min(w, h) * 0.04,
    x + w * 0.5,
    y + h * 0.5,
    Math.max(w, h) * 0.9,
  );
  polish.addColorStop(0, lighten(base, 0.07));
  polish.addColorStop(0.6, base);
  polish.addColorStop(1, darken(base, 0.07));
  ctx.fillStyle = polish;
  ctx.fillRect(x, y, w, h);

  // Soft flowing veins — smooth diagonal curves in two weights, low-contrast.
  const veinCount = Math.max(3, Math.round((w + h) / 130));
  for (let v = 0; v < veinCount; v++) {
    const startY = y + h * hash(v * 9.2);
    const goldVein = v % 3 === 0;
    ctx.strokeStyle = goldVein
      ? rgba(BRASS.base, 0.07)
      : rgba(darken(surface, 0.5), 0.1);
    ctx.lineWidth = v % 2 === 0 ? 1.3 : 0.7;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    const segs = 6;
    for (let s = 1; s <= segs; s++) {
      const px = x + (w * s) / segs;
      const drift = (hash(v * 4.4 + s) - 0.5) * h * 0.35;
      const cpx = x + (w * (s - 0.5)) / segs;
      const cpy = startY + (hash(v * 2.1 + s) - 0.5) * h * 0.45;
      ctx.quadraticCurveTo(cpx, cpy, px, startY + drift + ((h * s) / segs) * 0.1);
    }
    ctx.stroke();
    // Feathered hairline shadowing the main vein for depth.
    ctx.strokeStyle = rgba("#000000", 0.04);
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  // Faint reflection sweep — a broad soft diagonal band as if a window overhead
  // reflects in the polish. Kept low so it never washes out props above it.
  const refl = ctx.createLinearGradient(x, y, x + w, y + h * 0.4);
  refl.addColorStop(0, "rgba(0,0,0,0)");
  refl.addColorStop(0.32, rgba("#ffffff", 0.07));
  refl.addColorStop(0.42, rgba("#ffffff", 0.12));
  refl.addColorStop(0.52, rgba("#ffffff", 0.05));
  refl.addColorStop(0.7, "rgba(0,0,0,0)");
  ctx.fillStyle = refl;
  ctx.fillRect(x, y, w, h);

  // Overall polish sheen — a broad top-left highlight.
  const sheen = ctx.createLinearGradient(x, y, x + w, y + h);
  sheen.addColorStop(0, rgba("#fff6e6", 0.08));
  sheen.addColorStop(0.4, rgba("#ffffff", 0.015));
  sheen.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);
}

function drawTechGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  surface: string,
  accent: string,
): void {
  // Refined tech pinstripe — a fine, hushed pinstripe field rather than a bright
  // neon grid. Thin double lines with a whisper of accent, brass node ticks.
  const size = Math.max(24, Math.min(34, Math.min(w, h) / 5));
  const strokeMuted = rgba(mix(accent, hexToRgb(surface), 0.55), 0.16);
  for (let gx = x + size; gx < x + w; gx += size) {
    ctx.strokeStyle = strokeMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
    ctx.stroke();
    // Companion pinstripe — a hair to the right, fainter.
    ctx.strokeStyle = rgba(accent, 0.05);
    ctx.beginPath();
    ctx.moveTo(gx + 2.5, y);
    ctx.lineTo(gx + 2.5, y + h);
    ctx.stroke();
  }
  for (let gy = y + size; gy < y + h; gy += size) {
    ctx.strokeStyle = strokeMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
    ctx.stroke();
  }
  // Small brass node ticks at intersections every other cell.
  ctx.fillStyle = rgba(BRASS.base, 0.2);
  let iy = 0;
  for (let gy = y + size; gy < y + h; gy += size, iy++) {
    let ix = 0;
    for (let gx = x + size; gx < x + w; gx += size, ix++) {
      if ((ix + iy) % 2 !== 0) continue;
      ctx.fillRect(gx - 0.5, gy - 0.5, 1.5, 1.5);
    }
  }
  // Warm top-left vignette to seat the field in the scene light.
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, rgba("#ffedcf", 0.03));
  g.addColorStop(1, rgba("#000000", 0.05));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

// ---------------------------------------------------------------------------
// 2. Raised walls.
// ---------------------------------------------------------------------------

/**
 * How tall a wall stands, in TILE units. Exported so the renderer can depth-sort
 * correctly (a wall's drawn top extends `WALL_HEIGHT` tiles above its AABB, and
 * its cast shadow reaches below/right of the AABB base).
 */
export const WALL_HEIGHT = 0.55;

export interface RaisedWallOptions {
  wall: Wall;
  /** Pixels per tile. */
  tile: number;
  /** Wall body color (hex). */
  color: string;
  /** Draw the floor-level cast shadow (default true). */
  floorShadow?: boolean;
  /**
   * Render this segment as a GLASS partition (translucent tinted pane with
   * mullions + a brass frame) instead of a solid paneled wall. For meeting
   * rooms / pods / lounges. Equivalent to calling {@link drawGlassPartition}.
   */
  glass?: boolean;
  /** Accent (hex) tinting the glass + brass frame; defaults to a cool teal. */
  accent?: string;
}

/**
 * Draw a wall AABB as a solid that STANDS UP off the floor, lit from the
 * top-left, with an INSTITUTIONAL paneled / wainscot finish: a recessed panel
 * field on the front face, a thin BRASS base trim where it meets the floor, and
 * a soft top highlight along the cap. Three layers, back-to-front:
 *   1. a soft floor-level cast shadow offset to the bottom-right,
 *   2. a front (south) face ~`WALL_HEIGHT` tiles tall (paneled + brass trim), and
 *   3. a top cap (the wall's footprint) with a lit top-left edge + thin outline.
 *
 * If `glass` is set, the segment is drawn as a glass partition instead (see
 * {@link drawGlassPartition}). Returns nothing.
 */
export function drawRaisedWall(
  ctx: CanvasRenderingContext2D,
  opts: RaisedWallOptions,
): void {
  const { wall, tile, color } = opts;
  const floorShadow = opts.floorShadow ?? true;
  const wx = wall.x * tile;
  const wy = wall.y * tile;
  const ww = wall.w * tile;
  const wh = wall.h * tile;
  const height = WALL_HEIGHT * tile;

  if (opts.glass) {
    drawGlassPartition(ctx, {
      x: wx,
      y: wy,
      w: ww,
      h: wh + height,
      accent: opts.accent ?? "#7fb0c4",
      tile,
      floorShadow,
    });
    return;
  }

  ctx.save();

  // 1. Cast shadow — the wall's cap footprint, projected to the bottom-right.
  if (floorShadow) {
    const sx = LIGHT.x * tile * 0.7;
    const sy = LIGHT.y * tile * 0.7;
    ctx.fillStyle = rgba("#000000", 0.24);
    ctx.fillRect(wx + sx, wy + sy, ww, wh);
    // Feather the leading (bottom-right) edge so the shadow reads soft.
    const feather = ctx.createLinearGradient(
      wx + sx,
      wy + sy,
      wx + sx + sx,
      wy + sy + sy,
    );
    feather.addColorStop(0, rgba("#000000", 0.13));
    feather.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = feather;
    ctx.fillRect(wx + sx, wy + wh + sy - 2, ww + sx, sy + 3);
    ctx.fillRect(wx + ww + sx - 2, wy + sy, sx + 3, wh + sy);
  }

  // 2. Front (south) face — the visible "height" below the cap, top-lit.
  const faceTop = wy + wh;
  const faceGrad = ctx.createLinearGradient(0, faceTop, 0, faceTop + height);
  faceGrad.addColorStop(0, lighten(darken(color, 0.16), 0.07));
  faceGrad.addColorStop(0.55, darken(color, 0.28));
  faceGrad.addColorStop(1, darken(color, 0.52));
  ctx.fillStyle = faceGrad;
  ctx.fillRect(wx, faceTop, ww, height);

  // Wainscot: a recessed rail line across the face + inset panel boxes. Only
  // when the segment is wide/tall enough to read; skip on thin nubs.
  const horizontal = ww >= wh;
  if (horizontal && ww > tile * 1.2 && height > 6) {
    // A recessed dado rail near the top of the face.
    const railY = faceTop + height * 0.26;
    ctx.strokeStyle = rgba("#000000", 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wx, railY);
    ctx.lineTo(wx + ww, railY);
    ctx.stroke();
    ctx.strokeStyle = rgba("#ffffff", 0.06);
    ctx.beginPath();
    ctx.moveTo(wx, railY + 1);
    ctx.lineTo(wx + ww, railY + 1);
    ctx.stroke();

    // Inset panels along the lower field.
    const panelTop = railY + height * 0.14;
    const panelBot = faceTop + height * 0.86;
    const panelH = panelBot - panelTop;
    if (panelH > 4) {
      const pw = Math.max(tile * 0.9, tile * 1.4);
      const count = Math.max(1, Math.round(ww / pw));
      const gap = Math.min(4, ww / (count * 6));
      const cellW = ww / count;
      for (let i = 0; i < count; i++) {
        const bx = wx + i * cellW + gap;
        const bw = cellW - gap * 2;
        if (bw <= 2) continue;
        // Recessed inset: dark on top-left, light on bottom-right (bevel).
        ctx.strokeStyle = rgba("#000000", 0.24);
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, panelTop + 0.5, bw - 1, panelH - 1);
        ctx.strokeStyle = rgba("#ffffff", 0.055);
        ctx.beginPath();
        ctx.moveTo(bx + 1.5, panelTop + panelH - 1);
        ctx.lineTo(bx + bw - 1, panelTop + panelH - 1);
        ctx.moveTo(bx + bw - 1, panelTop + panelH - 1);
        ctx.lineTo(bx + bw - 1, panelTop + 1.5);
        ctx.stroke();
      }
    }
  }

  // Thin BRASS base trim where the face meets the floor (skirting hardware).
  const trimH = Math.max(1.5, height * 0.09);
  const trim = ctx.createLinearGradient(0, faceTop + height - trimH, 0, faceTop + height);
  trim.addColorStop(0, BRASS.light);
  trim.addColorStop(0.5, BRASS.base);
  trim.addColorStop(1, BRASS.dark);
  ctx.fillStyle = trim;
  ctx.fillRect(wx, faceTop + height - trimH, ww, trimH);
  // Contact shadow just under the trim.
  ctx.fillStyle = rgba("#000000", 0.2);
  ctx.fillRect(wx, faceTop + height - 1, ww, 1);

  // 3. Top cap — the footprint, lit brightest at its top-left.
  const capGrad = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  capGrad.addColorStop(0, lighten(color, 0.2));
  capGrad.addColorStop(1, darken(color, 0.12));
  ctx.fillStyle = capGrad;
  ctx.fillRect(wx, wy, ww, wh);

  // Soft top highlight — a bright lit top-left lip on the cap.
  ctx.strokeStyle = rgba("#ffffff", 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(wx + 0.5, wy + wh);
  ctx.lineTo(wx + 0.5, wy + 0.5);
  ctx.lineTo(wx + ww, wy + 0.5);
  ctx.stroke();

  // Thin outline around the cap.
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(wx + 0.5, wy + 0.5, ww - 1, wh - 1);

  ctx.restore();
}

export interface GlassPartitionOptions {
  /** Partition rect in PIXELS (the full standing pane, cap included). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Accent (hex) tinting the glass + brass frame. */
  accent: string;
  /** Pixels per tile — scales frame + mullion weights. Defaults to `h`. */
  tile?: number;
  /** Draw a soft floor-level cast shadow (default true). */
  floorShadow?: boolean;
}

/**
 * Draw a GLASS-WALLED partition: a translucent tinted pane with slim vertical
 * mullions, a brushed-BRASS frame, and a diagonal reflection streak — the look
 * of a glassed-in meeting room / pod / executive lounge. Lit from the top-left
 * like everything else. `x,y,w,h` is the full standing pane in pixels.
 */
export function drawGlassPartition(
  ctx: CanvasRenderingContext2D,
  opts: GlassPartitionOptions,
): void {
  const { x, y, w, h, accent } = opts;
  if (w <= 0 || h <= 0) return;
  const tile = opts.tile ?? h;
  const floorShadow = opts.floorShadow ?? true;
  const horizontal = w >= h;
  ctx.save();

  // Soft cast shadow to the bottom-right.
  if (floorShadow) {
    const sx = LIGHT.x * tile * 0.5;
    const sy = LIGHT.y * tile * 0.5;
    ctx.fillStyle = rgba("#000000", 0.16);
    ctx.fillRect(x + sx, y + sy, w, h);
  }

  // Frame thickness scales with tile but stays slim.
  const fw = Math.max(2, Math.min(tile * 0.14, Math.min(w, h) * 0.4));

  // Translucent tinted pane — cool tint of the accent, brighter at the top-left.
  const tint = mix(accent, [210, 226, 234], 0.4);
  const pane = ctx.createLinearGradient(x, y, x + w, y + h);
  pane.addColorStop(0, rgba(lighten(tint, 0.14), 0.34));
  pane.addColorStop(0.5, rgba(tint, 0.26));
  pane.addColorStop(1, rgba(darken(tint, 0.12), 0.3));
  ctx.fillStyle = pane;
  ctx.fillRect(x, y, w, h);

  // Diagonal reflection streak across the pane (a bright band + a faint echo).
  const streak = ctx.createLinearGradient(x, y, x + w, y + h);
  streak.addColorStop(0, "rgba(0,0,0,0)");
  streak.addColorStop(0.28, rgba("#ffffff", 0.05));
  streak.addColorStop(0.38, rgba("#ffffff", 0.22));
  streak.addColorStop(0.44, rgba("#ffffff", 0.06));
  streak.addColorStop(0.62, rgba("#ffffff", 0.11));
  streak.addColorStop(0.7, "rgba(0,0,0,0)");
  ctx.fillStyle = streak;
  ctx.fillRect(x, y, w, h);

  // Slim mullions dividing the pane along its long axis.
  ctx.strokeStyle = rgba(lighten(accent, 0.1), 0.4);
  ctx.lineWidth = Math.max(1, fw * 0.35);
  const span = horizontal ? w : h;
  const seg = Math.max(tile * 1.4, span / 6);
  const divs = Math.max(1, Math.round(span / seg) - 1);
  for (let i = 1; i <= divs; i++) {
    const t = (span * i) / (divs + 1);
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(x + t, y + fw);
      ctx.lineTo(x + t, y + h - fw);
    } else {
      ctx.moveTo(x + fw, y + t);
      ctx.lineTo(x + w - fw, y + t);
    }
    ctx.stroke();
    // Bright hairline on the top-left side of each mullion.
    ctx.strokeStyle = rgba("#ffffff", 0.12);
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(x + t - 1, y + fw);
      ctx.lineTo(x + t - 1, y + h - fw);
    } else {
      ctx.moveTo(x + fw, y + t - 1);
      ctx.lineTo(x + w - fw, y + t - 1);
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(lighten(accent, 0.1), 0.4);
    ctx.lineWidth = Math.max(1, fw * 0.35);
  }

  // Brushed-brass frame around the whole pane, lit top-left.
  const frame = ctx.createLinearGradient(x, y, x + w, y + h);
  frame.addColorStop(0, BRASS.light);
  frame.addColorStop(0.5, BRASS.base);
  frame.addColorStop(1, BRASS.dark);
  ctx.strokeStyle = frame;
  ctx.lineWidth = fw;
  ctx.strokeRect(x + fw / 2, y + fw / 2, w - fw, h - fw);
  // Bright inner lip on the top-left of the frame.
  ctx.strokeStyle = rgba(BRASS.highlight, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + fw, y + h - fw);
  ctx.lineTo(x + fw, y + fw);
  ctx.lineTo(x + w - fw, y + fw);
  ctx.stroke();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 3. Windows.
// ---------------------------------------------------------------------------

export interface WindowOptions {
  /** Pane rect in PIXELS. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Daylight glow color (hex). Defaults to a soft sky blue. */
  daylight?: string;
}

/**
 * Draw a window pane with a frame, mullions, and a soft daylight glow spilling
 * in from the top-left (matching the scene key light). Optional decor used on
 * exterior walls.
 */
export function drawWindow(
  ctx: CanvasRenderingContext2D,
  opts: WindowOptions,
): void {
  const { x, y, w, h } = opts;
  if (w <= 0 || h <= 0) return;
  const daylight = opts.daylight ?? "#bfe3f5";
  ctx.save();

  // Sky pane — brighter at the top.
  const sky = ctx.createLinearGradient(x, y, x, y + h);
  sky.addColorStop(0, lighten(daylight, 0.12));
  sky.addColorStop(1, lighten(daylight, 0.32));
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);

  // Daylight glow — a top-left radial spill onto the pane.
  const glow = ctx.createRadialGradient(
    x + w * 0.28,
    y + h * 0.24,
    0,
    x + w * 0.28,
    y + h * 0.24,
    Math.max(w, h) * 0.9,
  );
  glow.addColorStop(0, rgba("#ffffff", 0.5));
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  // Frame — brushed brass, matching the institutional hardware family.
  const frameW = Math.max(2, Math.min(w, h) * 0.12);
  const frame = ctx.createLinearGradient(x, y, x + w, y + h);
  frame.addColorStop(0, BRASS.light);
  frame.addColorStop(0.5, BRASS.base);
  frame.addColorStop(1, BRASS.dark);
  ctx.strokeStyle = frame;
  ctx.lineWidth = frameW;
  ctx.strokeRect(x + frameW / 2, y + frameW / 2, w - frameW, h - frameW);

  // Mullions — vertical + horizontal bars sized to the pane's aspect.
  ctx.strokeStyle = BRASS.base;
  ctx.lineWidth = Math.max(1.5, frameW * 0.5);
  const vBars = Math.max(1, Math.round(w / Math.max(h, 1)));
  for (let i = 1; i <= vBars; i++) {
    const bx = x + (w * i) / (vBars + 1);
    ctx.beginPath();
    ctx.moveTo(bx, y + frameW);
    ctx.lineTo(bx, y + h - frameW);
    ctx.stroke();
  }
  if (h > w * 0.6) {
    const by = y + h / 2;
    ctx.beginPath();
    ctx.moveTo(x + frameW, by);
    ctx.lineTo(x + w - frameW, by);
    ctx.stroke();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 4. Global lighting pass.
// ---------------------------------------------------------------------------

export interface SceneLightingOptions {
  /** Full canvas size in PIXELS. */
  width: number;
  height: number;
  /** Rooms (TILE space) for per-room corner ambient occlusion. */
  rooms: OfficeRoom[];
  /** Pixels per tile (defaults to deriving nothing; rooms are scaled by this). */
  tile?: number;
}

/**
 * Final CINEMATIC grade, drawn LAST (over floors, walls, props, and characters'
 * feet but tuned to stay subtle so nothing washes out). A quiet, premium,
 * executive mood in five soft layers:
 *   1. a gentle global contrast lift (deepen darks, lift the warm mids),
 *   2. a directional key-light gradient — warm top-left, cooler/deeper
 *      bottom-right,
 *   3. soft per-room corner ambient occlusion,
 *   4. a filmic vignette, and
 *   5. a whisper-thin warm bloom in the top-left.
 */
export function applySceneLighting(
  ctx: CanvasRenderingContext2D,
  opts: SceneLightingOptions,
): void {
  const { width, height, rooms } = opts;
  const tile = opts.tile ?? 26;
  ctx.save();

  // 1. Global contrast lift — deepen the shadows with a soft-light darken, then
  //    lift the warm midtones. Both very gentle so characters stay legible.
  ctx.globalCompositeOperation = "multiply";
  const deepen = ctx.createLinearGradient(0, 0, width, height);
  deepen.addColorStop(0, "rgba(236, 232, 224, 1)");
  deepen.addColorStop(0.5, "rgba(224, 224, 228, 1)");
  deepen.addColorStop(1, "rgba(196, 202, 214, 1)");
  ctx.fillStyle = deepen;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = "screen";
  const lift = ctx.createLinearGradient(0, 0, width, height);
  lift.addColorStop(0, "rgba(60, 48, 28, 1)");
  lift.addColorStop(0.5, "rgba(20, 20, 24, 1)");
  lift.addColorStop(1, "rgba(6, 8, 14, 1)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = "source-over";

  // 2. Directional key light — warm top-left, cooler / deeper bottom-right.
  const key = ctx.createLinearGradient(0, 0, width, height);
  key.addColorStop(0, "rgba(255, 240, 208, 0.12)");
  key.addColorStop(0.5, "rgba(255, 255, 255, 0.0)");
  key.addColorStop(1, "rgba(24, 40, 68, 0.16)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, width, height);

  // 3. Per-room ambient occlusion — pool soft shadow into each room's corners
  //    (an inner radial that is transparent at the center, darker at the edges).
  for (const room of rooms) {
    const rx = room.x * tile;
    const ry = room.y * tile;
    const rw = room.w * tile;
    const rh = room.h * tile;
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    const rad = Math.max(rw, rh) * 0.72;
    const ao = ctx.createRadialGradient(cx, cy, rad * 0.52, cx, cy, rad);
    ao.addColorStop(0, "rgba(0,0,0,0)");
    ao.addColorStop(1, "rgba(8, 10, 18, 0.16)");
    ctx.fillStyle = ao;
    ctx.fillRect(rx, ry, rw, rh);
  }

  // 4. Filmic vignette — a soft darkening toward the canvas edges, cooler.
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.44,
    Math.min(width, height) * 0.34,
    width * 0.5,
    height * 0.52,
    Math.max(width, height) * 0.78,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.7, "rgba(6, 8, 16, 0.08)");
  vignette.addColorStop(1, "rgba(4, 6, 12, 0.24)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  // 5. Whisper-thin warm bloom in the top-left corner — the key light source.
  const bloom = ctx.createRadialGradient(
    width * 0.16,
    height * 0.12,
    0,
    width * 0.16,
    height * 0.12,
    Math.max(width, height) * 0.5,
  );
  bloom.addColorStop(0, "rgba(255, 238, 200, 0.08)");
  bloom.addColorStop(1, "rgba(255, 238, 200, 0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 5. Institutional signage.
// ---------------------------------------------------------------------------

/** Fill a rect with a top-left-lit brushed-brass gradient. */
function brassFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): CanvasGradient {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, BRASS.light);
  g.addColorStop(0.45, BRASS.mid);
  g.addColorStop(0.55, BRASS.base);
  g.addColorStop(1, BRASS.dark);
  return g;
}

/** Fine horizontal brushed striations across a brass rect (deterministic). */
function brushLines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const step = Math.max(1.5, h / 14);
  let i = 0;
  for (let ly = y + step * 0.5; ly < y + h; ly += step, i++) {
    ctx.strokeStyle =
      i % 2 === 0 ? rgba(BRASS.highlight, 0.1) : rgba(BRASS.dark, 0.12);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, ly);
    ctx.lineTo(x + w, ly);
    ctx.stroke();
  }
}

export interface RoomPlaqueOptions {
  /** Top-left of the plaque in PIXELS. */
  x: number;
  y: number;
  /** Engraved room name. */
  label: string;
  /** Room accent (hex) — a hairline keyline under the plaque. */
  accent: string;
  /** Optional plaque width in PIXELS (auto-sized to the label otherwise). */
  w?: number;
  /** Optional plaque height in PIXELS (defaults to a compact bar). */
  h?: number;
}

/**
 * Draw a brushed-BRASS room plaque with an engraved (beveled) room name — a
 * small door-side nameplate. Lit from the top-left; the engraving is cut with a
 * dark recess and a bottom-right catch-light so the letters read as incised.
 */
export function drawRoomPlaque(
  ctx: CanvasRenderingContext2D,
  opts: RoomPlaqueOptions,
): void {
  const { x, y, label, accent } = opts;
  const h = opts.h ?? 18;
  ctx.save();

  ctx.font = `600 ${Math.round(h * 0.5)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const text = (label ?? "").toUpperCase();
  const textW = ctx.measureText(text).width;
  const padX = h * 0.7;
  const w = opts.w ?? Math.max(h * 2.4, textW + padX * 2);
  const r = Math.min(3, h / 3);

  // Drop shadow beneath the plaque.
  ctx.fillStyle = rgba("#000000", 0.28);
  roundRectPath(ctx, x + 1.2, y + 1.6, w, h, r);
  ctx.fill();

  // Brass body.
  ctx.fillStyle = brassFill(ctx, x, y, w, h);
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();

  // Brushed striations, clipped to the plaque.
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  brushLines(ctx, x, y, w, h);
  // Beveled outer rim: bright top-left, dark bottom-right.
  ctx.strokeStyle = rgba(BRASS.highlight, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 1, y + h - 1);
  ctx.lineTo(x + 1, y + 1);
  ctx.lineTo(x + w - 1, y + 1);
  ctx.stroke();
  ctx.strokeStyle = rgba(BRASS.dark, 0.5);
  ctx.beginPath();
  ctx.moveTo(x + w - 1, y + 1);
  ctx.lineTo(x + w - 1, y + h - 1);
  ctx.lineTo(x + 1, y + h - 1);
  ctx.stroke();
  ctx.restore();

  // Thin outline + accent keyline underneath.
  ctx.strokeStyle = rgba(BRASS.dark, 0.7);
  ctx.lineWidth = 1;
  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();
  ctx.strokeStyle = rgba(accent, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + r, y + h + 1.5);
  ctx.lineTo(x + w - r, y + h + 1.5);
  ctx.stroke();

  // Engraved label — dark recess, offset bottom-right catch-light, dark face.
  const cx = x + w / 2;
  const cy = y + h / 2 + 0.5;
  ctx.fillStyle = rgba(BRASS.highlight, 0.4);
  ctx.fillText(text, cx + 0.6, cy + 0.7);
  ctx.fillStyle = rgba("#2a1e08", 0.9);
  ctx.fillText(text, cx, cy);

  ctx.restore();
}

export interface HubCrestOptions {
  /** Center of the crest in PIXELS. */
  cx: number;
  cy: number;
  /** Outer radius in PIXELS. */
  r: number;
  /** Accent (hex) for the inner field tint. */
  accent: string;
  /** Optional monogram letter engraved in the center (defaults to "F"). */
  monogram?: string;
}

/**
 * Draw a small institutional emblem — a brushed-brass medallion with a dark
 * inner field, a fine concentric ring, and an engraved monogram. A quiet
 * house-crest mark for reception floors / hub centers.
 */
export function drawHubCrest(
  ctx: CanvasRenderingContext2D,
  opts: HubCrestOptions,
): void {
  const { cx, cy, r, accent } = opts;
  if (r <= 0) return;
  const mono = (opts.monogram ?? "F").slice(0, 1).toUpperCase();
  ctx.save();

  // Cast shadow.
  ctx.fillStyle = rgba("#000000", 0.3);
  ctx.beginPath();
  ctx.arc(cx + 1, cy + 1.6, r, 0, Math.PI * 2);
  ctx.fill();

  // Outer brass ring.
  const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, BRASS.light);
  ring.addColorStop(0.5, BRASS.base);
  ring.addColorStop(1, BRASS.dark);
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Bright top-left rim + dark bottom-right rim (beveled edge).
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.strokeStyle = rgba(BRASS.highlight, 0.6);
  ctx.beginPath();
  ctx.arc(cx, cy, r - ctx.lineWidth * 0.5, Math.PI * 0.9, Math.PI * 1.9);
  ctx.stroke();
  ctx.strokeStyle = rgba(BRASS.dark, 0.6);
  ctx.beginPath();
  ctx.arc(cx, cy, r - ctx.lineWidth * 0.5, Math.PI * -0.1, Math.PI * 0.9);
  ctx.stroke();

  // Inner dark field, tinted with the accent.
  const innerR = r * 0.66;
  const field = ctx.createRadialGradient(
    cx - innerR * 0.3,
    cy - innerR * 0.3,
    innerR * 0.1,
    cx,
    cy,
    innerR,
  );
  const fieldBase = mix("#141821", hexToRgb(accent), 0.22);
  field.addColorStop(0, lighten(fieldBase, 0.1));
  field.addColorStop(1, darken(fieldBase, 0.2));
  ctx.fillStyle = field;
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fill();

  // Fine concentric brass keyline inside the field.
  ctx.strokeStyle = rgba(BRASS.base, 0.5);
  ctx.lineWidth = Math.max(0.75, r * 0.03);
  ctx.beginPath();
  ctx.arc(cx, cy, innerR * 0.86, 0, Math.PI * 2);
  ctx.stroke();

  // Engraved monogram, brass with a dark recess.
  ctx.font = `700 ${Math.round(innerR * 1.15)}px ui-serif, Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = rgba("#000000", 0.5);
  ctx.fillText(mono, cx + 0.6, cy + 1.2);
  ctx.fillStyle = brassFill(ctx, cx - innerR, cy - innerR, innerR * 2, innerR * 2);
  ctx.fillText(mono, cx, cy + 0.4);

  ctx.restore();
}

export interface WordmarkOptions {
  /** Top-left anchor in PIXELS. */
  x: number;
  y: number;
  /** The reception wordmark text. */
  text: string;
  /** Overall scale multiplier (1 ≈ a ~22px cap height). */
  scale?: number;
  /** Optional accent (hex) for the underline flourish. */
  accent?: string;
}

/**
 * Draw an elegant reception wordmark — a spaced, brass-on-shadow serif set of
 * letters with a fine underline flourish. Restrained and executive; sits on a
 * lobby wall or reception desk face.
 */
export function drawWordmark(
  ctx: CanvasRenderingContext2D,
  opts: WordmarkOptions,
): void {
  const { x, y, text } = opts;
  const scale = opts.scale ?? 1;
  const accent = opts.accent ?? BRASS.base;
  const cap = 22 * scale;
  ctx.save();

  ctx.font = `600 ${Math.round(cap)}px ui-serif, Georgia, "Times New Roman", serif`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  // Letter-spaced draw for an institutional feel.
  const tracking = cap * 0.18;
  const chars = [...(text ?? "")];
  let penX = x;
  const baseY = y + cap;
  for (const ch of chars) {
    // Soft drop shadow.
    ctx.fillStyle = rgba("#000000", 0.35);
    ctx.fillText(ch, penX + 0.8, baseY + 1);
    // Brass face via a vertical gradient per glyph.
    const grad = ctx.createLinearGradient(penX, baseY - cap, penX, baseY);
    grad.addColorStop(0, BRASS.highlight);
    grad.addColorStop(0.5, BRASS.mid);
    grad.addColorStop(1, BRASS.dark);
    ctx.fillStyle = grad;
    ctx.fillText(ch, penX, baseY);
    penX += ctx.measureText(ch).width + tracking;
  }
  const totalW = penX - tracking - x;

  // Underline flourish — a thin brass rule flanked by tapered accent ticks.
  const ry = baseY + cap * 0.28;
  ctx.strokeStyle = brassFill(ctx, x, ry - 1, totalW, 2);
  ctx.lineWidth = Math.max(1, cap * 0.05);
  ctx.beginPath();
  ctx.moveTo(x + cap * 0.1, ry);
  ctx.lineTo(x + totalW - cap * 0.1, ry);
  ctx.stroke();
  ctx.fillStyle = rgba(accent, 0.7);
  ctx.beginPath();
  ctx.arc(x, ry, cap * 0.05, 0, Math.PI * 2);
  ctx.arc(x + totalW, ry, cap * 0.05, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Local rounded-rect path helper (kept private to the signage layer). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
