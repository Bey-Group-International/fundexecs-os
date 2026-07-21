// The environment realism engine for the Virtual Office.
//
// A sibling to `officeProps.ts` (props) and `vectorAvatar.ts` (characters):
// where those draw the things IN the office, this module draws the SPACE
// itself — rich floor materials, walls that stand up off the floor and cast
// shadows, exterior windows, and a final global lighting pass. The goal is for
// the top-down office to read as a real, lit room rather than a flat diagram.
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
 * Draw a rich floor material into the room rect. The caller is responsible for
 * clipping (e.g. a rounded-rect clip) before calling; this function only fills
 * within [x, x+w] × [y, y+h]. Tasteful and low-contrast: `surface` sets the
 * base tint, `accent` is used sparingly. Lit from the TOP-LEFT throughout.
 */
export function drawFloorMaterial(
  ctx: CanvasRenderingContext2D,
  opts: FloorMaterialOptions,
): void {
  const { floor, x, y, w, h, accent, surface } = opts;
  if (w <= 0 || h <= 0) return;
  ctx.save();

  // A gentle top-left → bottom-right base wash unifies every material with the
  // scene light before the per-material texture goes on top.
  const wash = ctx.createLinearGradient(x, y, x + w, y + h);
  wash.addColorStop(0, lighten(surface, 0.06));
  wash.addColorStop(1, darken(surface, 0.06));
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
  return Math.max(16, Math.min(30, h / 6));
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
  const plankBase = mix(surface, hexToRgb("#c08a52"), 0.28);
  let row = 0;
  for (let py = y; py < y + h; py += ph, row++) {
    const bh = Math.min(ph, y + h - py);
    // Alternate plank tone slightly so rows read individually.
    const tone = row % 2 === 0 ? lighten(plankBase, 0.04) : darken(plankBase, 0.03);
    const g = ctx.createLinearGradient(0, py, 0, py + bh);
    g.addColorStop(0, lighten(tone, 0.05));
    g.addColorStop(1, darken(tone, 0.06));
    ctx.fillStyle = g;
    ctx.fillRect(x, py, w, bh);

    // Seam between rows (dark, top-left-lit lip just below it).
    ctx.strokeStyle = rgba("#000000", 0.14);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, py + bh - 0.5);
    ctx.lineTo(x + w, py + bh - 0.5);
    ctx.stroke();
    ctx.strokeStyle = rgba("#ffffff", 0.05);
    ctx.beginPath();
    ctx.moveTo(x, py + 0.5);
    ctx.lineTo(x + w, py + 0.5);
    ctx.stroke();

    // Grain — a few faint length-wise strokes per plank, deterministic.
    ctx.strokeStyle = rgba(darken(plankBase, 0.3), 0.1);
    ctx.lineWidth = 1;
    const grains = 3;
    for (let gI = 0; gI < grains; gI++) {
      const gy = py + bh * (0.25 + 0.2 * gI + 0.06 * hash(row * 7 + gI));
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.stroke();
    }

    // Vertical board breaks, staggered per row.
    ctx.strokeStyle = rgba("#000000", 0.1);
    const boardW = Math.max(60, w / 5);
    const offset = (row % 2) * boardW * 0.5;
    for (let bx = x + offset; bx < x + w; bx += boardW) {
      ctx.beginPath();
      ctx.moveTo(bx + 0.5, py);
      ctx.lineTo(bx + 0.5, py + bh);
      ctx.stroke();
    }
  }

  // Soft sheen band — a diagonal top-left highlight sweeping across the floor.
  const sheen = ctx.createLinearGradient(x, y, x + w * 0.7, y + h);
  sheen.addColorStop(0, rgba("#ffffff", 0.08));
  sheen.addColorStop(0.35, rgba("#ffffff", 0.02));
  sheen.addColorStop(0.5, rgba(accent, 0.03));
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
  // Two-tone pile: base plus a subtly tinted alternate, then flecks on top.
  const base = mix(surface, hexToRgb(accent), 0.1);
  const alt = lighten(base, 0.03);
  const band = 8;
  for (let iy = 0; iy * band < h; iy++) {
    for (let ix = 0; ix * band < w; ix++) {
      if ((ix + iy) % 2 === 0) continue;
      ctx.fillStyle = rgba(alt, 0.5);
      ctx.fillRect(
        x + ix * band,
        y + iy * band,
        Math.min(band, w - ix * band),
        Math.min(band, h - iy * band),
      );
    }
  }

  // Flecked pile — tiny light/dark specks, deterministic placement.
  const step = 6;
  let i = 0;
  for (let py = y + 3; py < y + h; py += step) {
    for (let px = x + 3; px < x + w; px += step, i++) {
      const r = hash(i * 1.7);
      const jx = (hash(i * 3.1) - 0.5) * 2.2;
      const jy = (hash(i * 5.3) - 0.5) * 2.2;
      if (r < 0.5) {
        ctx.fillStyle = rgba("#ffffff", 0.05);
      } else {
        ctx.fillStyle = rgba("#000000", 0.05);
      }
      ctx.fillRect(px + jx, py + jy, 1.4, 1.4);
    }
  }

  // Top-left ambient brighten so the pile catches the key light.
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, rgba("#ffffff", 0.05));
  g.addColorStop(1, rgba("#000000", 0.04));
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
  const size = Math.max(20, Math.min(34, Math.min(w, h) / 4));
  const base = mix(surface, hexToRgb(accent), 0.06);

  // Fill each tile with a faint top-left-lit gradient so tiles read as raised.
  for (let iy = 0; iy * size < h; iy++) {
    for (let ix = 0; ix * size < w; ix++) {
      const tx = x + ix * size;
      const ty = y + iy * size;
      const tw = Math.min(size, x + w - tx);
      const th = Math.min(size, y + h - ty);
      const checker = (ix + iy) % 2 === 0;
      const tone = checker ? lighten(base, 0.03) : darken(base, 0.02);
      const g = ctx.createLinearGradient(tx, ty, tx + tw, ty + th);
      g.addColorStop(0, lighten(tone, 0.05));
      g.addColorStop(1, darken(tone, 0.05));
      ctx.fillStyle = g;
      ctx.fillRect(tx, ty, tw, th);
      // Specular corner — a small bright glint at the tile's top-left.
      ctx.fillStyle = rgba("#ffffff", 0.14);
      ctx.fillRect(tx + 1.5, ty + 1.5, Math.min(3, tw), Math.min(3, th));
    }
  }

  // Grout grid — recessed dark lines with a thin bottom-right lit lip.
  ctx.strokeStyle = rgba("#000000", 0.16);
  ctx.lineWidth = 1;
  for (let gx = x + size; gx < x + w; gx += size) {
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
    ctx.stroke();
  }
  for (let gy = y + size; gy < y + h; gy += size) {
    ctx.beginPath();
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
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
  // Base slab with a gentle radial polish centered toward the top-left.
  const base = lighten(surface, 0.04);
  const polish = ctx.createRadialGradient(
    x + w * 0.32,
    y + h * 0.28,
    Math.min(w, h) * 0.05,
    x + w * 0.5,
    y + h * 0.5,
    Math.max(w, h) * 0.85,
  );
  polish.addColorStop(0, lighten(base, 0.08));
  polish.addColorStop(1, darken(base, 0.05));
  ctx.fillStyle = polish;
  ctx.fillRect(x, y, w, h);

  // Flowing veins — smooth diagonal curves, deterministic, low-contrast.
  const veinCount = Math.max(3, Math.round((w + h) / 120));
  for (let v = 0; v < veinCount; v++) {
    const startY = y + h * hash(v * 9.2);
    ctx.strokeStyle =
      v % 3 === 0 ? rgba(accent, 0.08) : rgba(darken(surface, 0.4), 0.12);
    ctx.lineWidth = v % 2 === 0 ? 1.4 : 0.8;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    const segs = 5;
    for (let s = 1; s <= segs; s++) {
      const px = x + (w * s) / segs;
      const drift = (hash(v * 4.4 + s) - 0.5) * h * 0.4;
      const cpx = x + (w * (s - 0.5)) / segs;
      const cpy = startY + (hash(v * 2.1 + s) - 0.5) * h * 0.5;
      ctx.quadraticCurveTo(cpx, cpy, px, startY + drift + (h * s) / segs * 0.12);
    }
    ctx.stroke();
  }

  // Polish sheen — a broad top-left highlight sweep.
  const sheen = ctx.createLinearGradient(x, y, x + w, y + h);
  sheen.addColorStop(0, rgba("#ffffff", 0.1));
  sheen.addColorStop(0.4, rgba("#ffffff", 0.02));
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
  const size = Math.max(20, Math.min(30, Math.min(w, h) / 5));
  // Fine grid lines.
  ctx.strokeStyle = rgba(accent, 0.1);
  ctx.lineWidth = 1;
  for (let gx = x + size; gx < x + w; gx += size) {
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
    ctx.stroke();
  }
  for (let gy = y + size; gy < y + h; gy += size) {
    ctx.beginPath();
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
    ctx.stroke();
  }
  // Brighter node dots at intersections every other cell.
  ctx.fillStyle = rgba(accent, 0.16);
  let iy = 0;
  for (let gy = y + size; gy < y + h; gy += size, iy++) {
    let ix = 0;
    for (let gx = x + size; gx < x + w; gx += size, ix++) {
      if ((ix + iy) % 2 !== 0) continue;
      ctx.fillRect(gx - 1, gy - 1, 2, 2);
    }
  }
  // Subtle top-left vignette to seat the grid in the scene light.
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, rgba("#ffffff", 0.03));
  g.addColorStop(1, rgba("#000000", 0.04));
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
}

/**
 * Draw a wall AABB as a solid that STANDS UP off the floor, lit from the
 * top-left. Three layers, back-to-front:
 *   1. a soft floor-level cast shadow offset to the bottom-right,
 *   2. a front (south) face ~`WALL_HEIGHT` tiles tall, shaded lighter at the top
 *      and darker at the base, and
 *   3. a top cap (the wall's footprint) with a lit top-left edge + thin outline.
 * Returns nothing.
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

  ctx.save();

  // 1. Cast shadow — the wall's cap footprint, projected to the bottom-right.
  if (floorShadow) {
    const sx = LIGHT.x * tile * 0.7;
    const sy = LIGHT.y * tile * 0.7;
    ctx.fillStyle = rgba("#000000", 0.22);
    ctx.fillRect(wx + sx, wy + sy, ww, wh);
    // Feather the leading (bottom-right) edge so the shadow reads soft.
    const feather = ctx.createLinearGradient(
      wx + sx,
      wy + sy,
      wx + sx + sx,
      wy + sy + sy,
    );
    feather.addColorStop(0, rgba("#000000", 0.12));
    feather.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = feather;
    ctx.fillRect(wx + sx, wy + wh + sy - 2, ww + sx, sy + 3);
    ctx.fillRect(wx + ww + sx - 2, wy + sy, sx + 3, wh + sy);
  }

  // 2. Front (south) face — the visible "height" below the cap, top-lit.
  const faceTop = wy + wh;
  const faceGrad = ctx.createLinearGradient(0, faceTop, 0, faceTop + height);
  faceGrad.addColorStop(0, lighten(darken(color, 0.18), 0.06));
  faceGrad.addColorStop(1, darken(color, 0.5));
  ctx.fillStyle = faceGrad;
  ctx.fillRect(wx, faceTop, ww, height);
  // Base contact darkening where the face meets the floor.
  ctx.fillStyle = rgba("#000000", 0.18);
  ctx.fillRect(wx, faceTop + height - 2, ww, 2);

  // 3. Top cap — the footprint, lit brightest at its top-left.
  const capGrad = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  capGrad.addColorStop(0, lighten(color, 0.18));
  capGrad.addColorStop(1, darken(color, 0.1));
  ctx.fillStyle = capGrad;
  ctx.fillRect(wx, wy, ww, wh);

  // Lit top-left lip on the cap.
  ctx.strokeStyle = rgba("#ffffff", 0.28);
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

  // Frame.
  const frameW = Math.max(2, Math.min(w, h) * 0.12);
  ctx.strokeStyle = "#e7ecf1";
  ctx.lineWidth = frameW;
  ctx.strokeRect(x + frameW / 2, y + frameW / 2, w - frameW, h - frameW);

  // Mullions — vertical + horizontal bars sized to the pane's aspect.
  ctx.lineWidth = Math.max(1.5, frameW * 0.5);
  const vBars = Math.max(1, Math.round(w / Math.max(h, 1)) );
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
 * Final overlay pass, drawn LAST (over floors, walls, props, and characters'
 * feet but tuned to stay subtle so nothing washes out). Three subtle layers:
 *   1. a directional key-light gradient — brighter warm top-left, cooler
 *      bottom-right,
 *   2. soft per-room ambient occlusion darkening room corners, and
 *   3. a mild global vignette.
 */
export function applySceneLighting(
  ctx: CanvasRenderingContext2D,
  opts: SceneLightingOptions,
): void {
  const { width, height, rooms } = opts;
  const tile = opts.tile ?? 26;
  ctx.save();

  // 1. Directional key light — warm top-left, cool bottom-right.
  const key = ctx.createLinearGradient(0, 0, width, height);
  key.addColorStop(0, "rgba(255, 246, 224, 0.10)");
  key.addColorStop(0.5, "rgba(255, 255, 255, 0.0)");
  key.addColorStop(1, "rgba(40, 60, 90, 0.10)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, width, height);

  // 2. Per-room ambient occlusion — pool soft shadow into each room's corners
  //    (an inner radial that is transparent at the center, darker at the edges).
  for (const room of rooms) {
    const rx = room.x * tile;
    const ry = room.y * tile;
    const rw = room.w * tile;
    const rh = room.h * tile;
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    const rad = Math.max(rw, rh) * 0.72;
    const ao = ctx.createRadialGradient(cx, cy, rad * 0.55, cx, cy, rad);
    ao.addColorStop(0, "rgba(0,0,0,0)");
    ao.addColorStop(1, "rgba(0,0,0,0.14)");
    ctx.fillStyle = ao;
    ctx.fillRect(rx, ry, rw, rh);
  }

  // 3. Global vignette — a mild darkening toward the canvas edges.
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.45,
    Math.min(width, height) * 0.35,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.75,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.16)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}
