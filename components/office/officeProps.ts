// The premium furniture / prop engine for the Virtual Office.
//
// A sibling to `vectorAvatar.ts`: where that module draws lit, semi-3D
// characters, this one draws the office they live in — desks, couches, rugs,
// plants, screens — as fully procedural, 3D-style-shaded vector props (front-
// facing 2.5D, à la SoWork / Gather). No image or binary assets: every prop is
// Canvas 2D paths + gradients + ambient-occlusion, with a soft contact shadow
// and a subtle outline that reads on light AND dark floors. Kept React-free and
// cheap enough to run inside the render loop's rAF.
//
// COORDINATE CONTRACT (matches `lib/office/layout.ts` + `render.ts`):
//   • All positions are in TILE space; multiply by `tile` for pixels.
//   • A prop occupies a FOOTPRINT whose TOP-LEFT is at (x*tile, y*tile) and
//     whose size is (w*tile, h*tile). `w`/`h` default to PROP_CATALOG[kind].
//   • `rot` (degrees) rotates the piece about the footprint CENTRE.
//   • `accent` tints team-colored pieces (chairs, rugs, panels) where tasteful.
//   • `timeMs` drives a few cheap animations (screen glow, steam, rack LEDs).
import type { OfficeObjectKind } from "@/lib/office/layout";

// ---------------------------------------------------------------------------
// Catalogue — a human label + default footprint (in tiles) for every kind.
// ---------------------------------------------------------------------------

export const PROP_CATALOG: Record<
  OfficeObjectKind,
  { label: string; w: number; h: number }
> = {
  // legacy set
  desk: { label: "Desk", w: 2, h: 1 },
  plant: { label: "Plant", w: 1, h: 1 },
  whiteboard: { label: "Whiteboard", w: 2, h: 0.5 },
  couch: { label: "Couch", w: 3, h: 1 },
  table: { label: "Table", w: 2, h: 2 },
  screen: { label: "Screen", w: 1.5, h: 0.4 },
  // premium catalogue
  chair: { label: "Office Chair", w: 1, h: 1 },
  monitor: { label: "Monitor", w: 1, h: 1 },
  plant_lg: { label: "Large Plant", w: 1, h: 1 },
  armchair: { label: "Armchair", w: 1.5, h: 1.5 },
  coffee_table: { label: "Coffee Table", w: 2, h: 1 },
  meeting_table: { label: "Meeting Table", w: 4, h: 2 },
  tv: { label: "TV", w: 2, h: 0.5 },
  bookshelf: { label: "Bookshelf", w: 2, h: 0.6 },
  rug: { label: "Rug", w: 5, h: 4 },
  rug_round: { label: "Round Rug", w: 4, h: 4 },
  reception_desk: { label: "Reception Desk", w: 4, h: 2 },
  cafe_counter: { label: "Café Counter", w: 4, h: 1.5 },
  coffee_machine: { label: "Coffee Machine", w: 1, h: 1 },
  water_cooler: { label: "Water Cooler", w: 1, h: 1 },
  wall_art: { label: "Wall Art", w: 1.5, h: 0.3 },
  window: { label: "Window", w: 3, h: 0.4 },
  divider: { label: "Divider", w: 0.3, h: 3 },
  pod: { label: "Meeting Pod", w: 3, h: 3 },
  lamp: { label: "Floor Lamp", w: 1, h: 1 },
  server_rack: { label: "Server Rack", w: 2, h: 1 },
  // uploaded branding (logo / poster / wall art) — drawn from `src`
  image: { label: "Image", w: 3, h: 2 },
};

// ---------------------------------------------------------------------------
// Color helpers — operate on "#rrggbb" hex (mirrors vectorAvatar.ts).
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
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

// Shared palette — neutral materials the whole office is built from.
const OUTLINE = "rgba(17, 22, 34, 0.5)";
const WOOD = "#c08a52";
const DARK = "#2a2f3a";
const METAL = "#aeb6bf";
const FABRIC = "#5b6472";
const GLASS = "#8fb3c9";

// ---------------------------------------------------------------------------
// Gradient memo — gradients are the per-prop cost worth caching. Because every
// prop is drawn in a LOCAL frame (origin at footprint top-left, so local coords
// only depend on pixel size), a gradient keyed by kind + size + accent is
// reusable across every instance of that prop. Scoped per-context via a
// WeakMap, exactly like the character engine.
// ---------------------------------------------------------------------------

const gradCaches = new WeakMap<
  CanvasRenderingContext2D,
  Map<string, CanvasGradient>
>();

function memoGrad(
  ctx: CanvasRenderingContext2D,
  key: string,
  build: () => CanvasGradient,
): CanvasGradient {
  let perCtx = gradCaches.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    gradCaches.set(ctx, perCtx);
  }
  const hit = perCtx.get(key);
  if (hit) return hit;
  const grad = build();
  perCtx.set(key, grad);
  return grad;
}

/** A top-lit vertical gradient over [y0, y1] built from a base color. */
function vGrad(
  ctx: CanvasRenderingContext2D,
  key: string,
  y0: number,
  y1: number,
  base: string,
  hi = 0.18,
  lo = 0.2,
): CanvasGradient {
  return memoGrad(ctx, key, () => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, lighten(base, hi));
    g.addColorStop(0.5, base);
    g.addColorStop(1, darken(base, lo));
    return g;
  });
}

// ---------------------------------------------------------------------------
// Path helpers.
// ---------------------------------------------------------------------------

function rr(
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

function ell(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
}

/** Fill a rounded rect with a top-lit gradient + outline + a top rim light. */
function shadedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  base: string,
  key: string,
): void {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = vGrad(ctx, key, y, y + h, base);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Rim light along the top edge.
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(x + r * 0.5, y + 0.75);
  ctx.lineTo(x + w - r * 0.5, y + 0.75);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = rgba("#ffffff", 0.22);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Public seam.
// ---------------------------------------------------------------------------

export interface DrawPropOptions {
  kind: OfficeObjectKind;
  /** Tile-space top-left of the footprint. */
  x: number;
  y: number;
  /** Pixels per tile. */
  tile: number;
  /** Footprint in tiles (defaults from PROP_CATALOG). */
  w?: number;
  h?: number;
  /** Orientation in degrees, about the footprint centre. */
  rot?: number;
  /** Room accent (hex) for tinting team-colored pieces. */
  accent?: string;
  /** Clock in ms for cheap continuous animation. */
  timeMs?: number;
  /** For kind "image": the uploaded asset URL to cover-fit into the footprint. */
  src?: string;
}

/**
 * Draw one premium prop, 3D-shaded, filling the footprint whose TOP-LEFT is at
 * (x*tile, y*tile) and whose size is (w×tile, h×tile). A soft contact shadow is
 * laid beneath it first; `rot` spins the piece about the footprint centre.
 *
 * Everything after the transform setup is drawn in a LOCAL frame with origin at
 * the footprint's top-left and extents [0, pw] × [0, ph] in pixels, which keeps
 * gradient coordinates size-only and therefore memoizable across instances.
 */
export function drawProp(ctx: CanvasRenderingContext2D, opts: DrawPropOptions): void {
  const cat = PROP_CATALOG[opts.kind];
  const w = opts.w ?? cat.w;
  const h = opts.h ?? cat.h;
  const tile = opts.tile;
  const pw = w * tile;
  const ph = h * tile;
  const px = opts.x * tile;
  const py = opts.y * tile;
  const accent = opts.accent ?? "#6b7280";
  const t = opts.timeMs ?? 0;
  const key = `${opts.kind}|${Math.round(pw)}|${Math.round(ph)}|${accent}`;

  ctx.save();
  // Rotate about the footprint centre, then drop into the local top-left frame.
  if (opts.rot) {
    const cx = px + pw / 2;
    const cy = py + ph / 2;
    ctx.translate(cx, cy);
    ctx.rotate((opts.rot * Math.PI) / 180);
    ctx.translate(-pw / 2, -ph / 2);
  } else {
    ctx.translate(px, py);
  }

  drawContactShadow(ctx, pw, ph, key);
  DRAWERS[opts.kind](ctx, pw, ph, accent, t, key, opts.src);

  ctx.restore();
}

/** Soft elliptical contact shadow hugging the base of the footprint. */
function drawContactShadow(
  ctx: CanvasRenderingContext2D,
  pw: number,
  ph: number,
  key: string,
): void {
  const cx = pw / 2;
  const cy = ph * 0.9;
  const rx = pw * 0.52;
  const ry = Math.max(3, ph * 0.2);
  const g = memoGrad(ctx, `${key}:shadow`, () => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    rg.addColorStop(0, "rgba(0,0,0,0.28)");
    rg.addColorStop(0.7, "rgba(0,0,0,0.12)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    return rg;
  });
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = g;
  ell(ctx, cx, cy, rx, rx);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Per-kind drawers. Each receives the LOCAL-frame pixel size (pw, ph), the
// room accent, the clock, and the gradient-cache key prefix.
// ---------------------------------------------------------------------------

type Drawer = (
  ctx: CanvasRenderingContext2D,
  pw: number,
  ph: number,
  accent: string,
  t: number,
  key: string,
  /** Only the "image" drawer consumes this (the uploaded asset URL). */
  src?: string,
) => void;

function drawDesk(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  const top = ph * 0.18;
  const deskH = ph * 0.5;
  // Legs.
  ctx.fillStyle = darken(WOOD, 0.4);
  const legW = Math.max(3, pw * 0.05);
  ctx.fillRect(pw * 0.06, top + deskH * 0.7, legW, ph * 0.34);
  ctx.fillRect(pw - pw * 0.06 - legW, top + deskH * 0.7, legW, ph * 0.34);
  // Desktop slab.
  shadedBox(ctx, pw * 0.03, top, pw * 0.94, deskH, 4, WOOD, `${key}:top`);
  // Fine wood grain running the length of the desktop.
  ctx.strokeStyle = rgba(darken(WOOD, 0.4), 0.1);
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 3; i++) {
    const gy = top + deskH * (0.16 + 0.16 * i);
    ctx.beginPath();
    ctx.moveTo(pw * 0.07, gy);
    ctx.lineTo(pw * 0.9, gy);
    ctx.stroke();
  }
  // Front apron (a shaded band under the surface for depth).
  ctx.fillStyle = rgba("#000000", 0.18);
  ctx.fillRect(pw * 0.03, top + deskH * 0.62, pw * 0.94, deskH * 0.14);
  // Drawer seams.
  ctx.strokeStyle = rgba("#000000", 0.2);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pw * 0.62, top + deskH * 0.14);
  ctx.lineTo(pw * 0.62, top + deskH * 0.55);
  ctx.stroke();
  // A dark leather blotter pad on the desktop.
  ctx.fillStyle = rgba("#20242e", 0.5);
  rr(ctx, pw * 0.28, top + deskH * 0.12, pw * 0.44, deskH * 0.4, 3);
  ctx.fill();
  // Keyboard resting on the pad.
  ctx.fillStyle = rgba("#c8cdd6", 0.8);
  rr(ctx, pw * 0.36, top + deskH * 0.32, pw * 0.28, deskH * 0.14, 2);
  ctx.fill();
  // A slim monitor standing at the back of the desk, screen lit with the accent.
  const mw = pw * 0.34;
  const mh = deskH * 0.34;
  const mx = pw * 0.5 - mw / 2;
  const my = top - mh * 0.5;
  ctx.fillStyle = darken(METAL, 0.3);
  ctx.fillRect(pw * 0.5 - pw * 0.02, top - 1, pw * 0.04, mh * 0.4);
  shadedBox(ctx, mx, my, mw, mh, 2, DARK, `${key}:mon`);
  ctx.fillStyle = memoGrad(ctx, `${key}:monscr`, () => {
    const g = ctx.createLinearGradient(mx, my, mx + mw, my + mh);
    g.addColorStop(0, lighten(accent, 0.1));
    g.addColorStop(1, darken(accent, 0.45));
    return g;
  });
  rr(ctx, mx + mw * 0.08, my + mh * 0.14, mw * 0.84, mh * 0.6, 1.5);
  ctx.fill();
}

function drawChair(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  const cx = pw / 2;
  // 5-star base + gas cylinder.
  ctx.strokeStyle = darken(METAL, 0.3);
  ctx.lineWidth = Math.max(2, pw * 0.05);
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, ph * 0.72);
    ctx.lineTo(cx + Math.cos(a) * pw * 0.28, ph * 0.86 + Math.sin(a) * ph * 0.1);
    ctx.stroke();
  }
  ctx.fillStyle = DARK;
  ctx.fillRect(cx - pw * 0.03, ph * 0.5, pw * 0.06, ph * 0.24);
  // Backrest (accent-tinted mesh).
  shadedBox(ctx, cx - pw * 0.26, ph * 0.06, pw * 0.52, ph * 0.34, 6, mix(accent, [40, 44, 54], 0.35), `${key}:back`);
  // Seat cushion.
  shadedBox(ctx, cx - pw * 0.3, ph * 0.38, pw * 0.6, ph * 0.2, 7, mix(accent, [40, 44, 54], 0.25), `${key}:seat`);
}

function drawMonitor(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, t: number, key: string): void {
  const cx = pw / 2;
  // Stand.
  ctx.fillStyle = darken(METAL, 0.25);
  ctx.fillRect(cx - pw * 0.04, ph * 0.5, pw * 0.08, ph * 0.28);
  shadedBox(ctx, cx - pw * 0.18, ph * 0.74, pw * 0.36, ph * 0.1, 4, METAL, `${key}:foot`);
  // Bezel.
  shadedBox(ctx, cx - pw * 0.42, ph * 0.08, pw * 0.84, ph * 0.46, 4, DARK, `${key}:bezel`);
  // Screen with animated glow.
  const glow = 0.55 + 0.15 * Math.sin(t / 900);
  const sx = cx - pw * 0.37;
  const sy = ph * 0.12;
  const sw = pw * 0.74;
  const sh = ph * 0.38;
  ctx.fillStyle = memoGrad(ctx, `${key}:screen`, () => {
    const g = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
    g.addColorStop(0, lighten(accent, 0.1));
    g.addColorStop(1, darken(accent, 0.45));
    return g;
  });
  rr(ctx, sx, sy, sw, sh, 2);
  ctx.fill();
  ctx.fillStyle = rgba("#ffffff", 0.1 * glow);
  ctx.fillRect(sx, sy, sw, sh * 0.4);
}

function drawWhiteboard(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  // Frame.
  shadedBox(ctx, pw * 0.02, ph * 0.06, pw * 0.96, ph * 0.7, 3, "#cfd6de", `${key}:frame`);
  // Board surface.
  ctx.fillStyle = "#f7f9fb";
  rr(ctx, pw * 0.06, ph * 0.12, pw * 0.88, ph * 0.55, 2);
  ctx.fill();
  // Scribbles.
  ctx.strokeStyle = rgba(accent, 0.75);
  ctx.lineWidth = Math.max(1.4, ph * 0.03);
  ctx.beginPath();
  ctx.moveTo(pw * 0.14, ph * 0.28);
  ctx.lineTo(pw * 0.5, ph * 0.28);
  ctx.moveTo(pw * 0.14, ph * 0.42);
  ctx.lineTo(pw * 0.66, ph * 0.42);
  ctx.stroke();
  ctx.strokeStyle = rgba("#e05252", 0.7);
  ctx.beginPath();
  ctx.moveTo(pw * 0.72, ph * 0.24);
  ctx.lineTo(pw * 0.86, ph * 0.5);
  ctx.stroke();
  // Tray.
  ctx.fillStyle = darken("#cfd6de", 0.2);
  ctx.fillRect(pw * 0.06, ph * 0.7, pw * 0.88, ph * 0.08);
}

function drawCouch(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  const base = mix(FABRIC, hexToRgb(accent), 0.18);
  const top = ph * 0.12;
  // Backrest.
  shadedBox(ctx, pw * 0.02, top, pw * 0.96, ph * 0.4, 10, base, `${key}:back`);
  // Arms.
  shadedBox(ctx, pw * 0.02, top + ph * 0.1, pw * 0.12, ph * 0.66, 9, lighten(base, 0.04), `${key}:arml`);
  shadedBox(ctx, pw * 0.86, top + ph * 0.1, pw * 0.12, ph * 0.66, 9, lighten(base, 0.04), `${key}:armr`);
  // Seat base.
  shadedBox(ctx, pw * 0.1, top + ph * 0.34, pw * 0.8, ph * 0.44, 8, darken(base, 0.06), `${key}:seat`);
  // Seat cushions.
  const cushions = Math.max(2, Math.round(pw / (ph * 0.9)));
  const cw = (pw * 0.76) / cushions;
  for (let i = 0; i < cushions; i++) {
    shadedBox(ctx, pw * 0.12 + i * cw + cw * 0.06, top + ph * 0.3, cw * 0.88, ph * 0.26, 7, lighten(base, 0.06), `${key}:cush`);
  }
}

function drawTable(ctx: CanvasRenderingContext2D, pw: number, ph: number, _a: string, _t: number, key: string): void {
  const cx = pw / 2;
  const cy = ph * 0.52;
  const rx = pw * 0.42;
  const ry = ph * 0.4;
  // Pedestal.
  ctx.fillStyle = darken(WOOD, 0.35);
  ctx.fillRect(cx - pw * 0.05, cy, pw * 0.1, ph * 0.34);
  ell(ctx, cx, ph * 0.9, pw * 0.16, ph * 0.05);
  ctx.fill();
  // Round top with radial sheen.
  ctx.fillStyle = memoGrad(ctx, `${key}:top`, () => {
    const g = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.4, ry * 0.1, cx, cy, rx);
    g.addColorStop(0, lighten(WOOD, 0.22));
    g.addColorStop(0.6, WOOD);
    g.addColorStop(1, darken(WOOD, 0.22));
    return g;
  });
  ell(ctx, cx, cy, rx, ry);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Rim highlight.
  ctx.strokeStyle = rgba("#ffffff", 0.16);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.94, ry * 0.9, 0, Math.PI * 1.05, Math.PI * 1.9);
  ctx.stroke();
  // Concentric grain rings, so the round top reads as a single figured slab.
  ctx.strokeStyle = rgba(darken(WOOD, 0.4), 0.08);
  ctx.lineWidth = 0.7;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * (i / 4), ry * (i / 4), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawScreen(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, t: number, key: string): void {
  // A wall-mounted display (like a small TV).
  shadedBox(ctx, pw * 0.04, ph * 0.08, pw * 0.92, ph * 0.78, 3, DARK, `${key}:bezel`);
  const glow = 0.5 + 0.2 * Math.sin(t / 700);
  ctx.fillStyle = memoGrad(ctx, `${key}:screen`, () => {
    const g = ctx.createLinearGradient(0, ph * 0.14, pw, ph * 0.8);
    g.addColorStop(0, lighten(accent, 0.12));
    g.addColorStop(1, darken(accent, 0.4));
    return g;
  });
  rr(ctx, pw * 0.09, ph * 0.14, pw * 0.82, ph * 0.62, 2);
  ctx.fill();
  ctx.fillStyle = rgba("#ffffff", 0.12 * glow);
  ctx.fillRect(pw * 0.09, ph * 0.14, pw * 0.82, ph * 0.24);
}

function drawTv(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, t: number, key: string): void {
  shadedBox(ctx, pw * 0.02, ph * 0.06, pw * 0.96, ph * 0.74, 3, "#171b22", `${key}:bezel`);
  const glow = 0.5 + 0.22 * Math.sin(t / 650 + 1);
  ctx.fillStyle = memoGrad(ctx, `${key}:screen`, () => {
    const g = ctx.createLinearGradient(0, ph * 0.12, pw, ph * 0.72);
    g.addColorStop(0, lighten(accent, 0.16));
    g.addColorStop(0.5, accent);
    g.addColorStop(1, darken(accent, 0.5));
    return g;
  });
  rr(ctx, pw * 0.05, ph * 0.12, pw * 0.9, ph * 0.6, 2);
  ctx.fill();
  ctx.fillStyle = rgba("#ffffff", 0.14 * glow);
  ctx.fillRect(pw * 0.05, ph * 0.12, pw * 0.9, ph * 0.22);
  // Wall mount / stand nub.
  ctx.fillStyle = DARK;
  ctx.fillRect(pw / 2 - pw * 0.06, ph * 0.78, pw * 0.12, ph * 0.14);
}

function drawPlant(ctx: CanvasRenderingContext2D, pw: number, ph: number, _a: string, _t: number, key: string): void {
  const cx = pw / 2;
  // Pot.
  ctx.fillStyle = vGrad(ctx, `${key}:pot`, ph * 0.6, ph * 0.92, "#c98a5b");
  ctx.beginPath();
  ctx.moveTo(cx - pw * 0.2, ph * 0.62);
  ctx.lineTo(cx + pw * 0.2, ph * 0.62);
  ctx.lineTo(cx + pw * 0.15, ph * 0.9);
  ctx.lineTo(cx - pw * 0.15, ph * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Foliage — overlapping leaf blobs.
  const green = "#3f9d5a";
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.55;
    ell(ctx, cx + Math.cos(a) * pw * 0.16, ph * 0.42 + Math.sin(a) * ph * 0.16, pw * 0.13, ph * 0.2);
    ctx.fillStyle = i % 2 ? lighten(green, 0.12) : darken(green, 0.1);
    ctx.fill();
  }
  ell(ctx, cx, ph * 0.36, pw * 0.16, ph * 0.18);
  ctx.fillStyle = lighten(green, 0.06);
  ctx.fill();
}

function drawPlantLg(ctx: CanvasRenderingContext2D, pw: number, ph: number, _a: string, _t: number, key: string): void {
  const cx = pw / 2;
  // Tall planter.
  shadedBox(ctx, cx - pw * 0.18, ph * 0.58, pw * 0.36, ph * 0.4, 4, "#8b8f98", `${key}:pot`);
  // Trunk.
  ctx.strokeStyle = "#6b4a2f";
  ctx.lineWidth = Math.max(2, pw * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx, ph * 0.6);
  ctx.lineTo(cx, ph * 0.32);
  ctx.stroke();
  // Big fronds.
  const green = "#358a4d";
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i - 3) * 0.42;
    const lx = cx + Math.cos(a) * pw * 0.3;
    const ly = ph * 0.28 + Math.sin(a) * ph * 0.24;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(a + Math.PI / 2);
    ell(ctx, 0, 0, pw * 0.09, ph * 0.2);
    ctx.fillStyle = i % 2 ? lighten(green, 0.14) : darken(green, 0.08);
    ctx.fill();
    ctx.restore();
  }
  ell(ctx, cx, ph * 0.24, pw * 0.18, ph * 0.16);
  ctx.fillStyle = green;
  ctx.fill();
}

function drawArmchair(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  const base = mix(FABRIC, hexToRgb(accent), 0.22);
  const top = ph * 0.12;
  shadedBox(ctx, pw * 0.14, top, pw * 0.72, ph * 0.5, 12, base, `${key}:back`);
  shadedBox(ctx, pw * 0.06, top + ph * 0.16, pw * 0.16, ph * 0.6, 10, lighten(base, 0.05), `${key}:arml`);
  shadedBox(ctx, pw * 0.78, top + ph * 0.16, pw * 0.16, ph * 0.6, 10, lighten(base, 0.05), `${key}:armr`);
  shadedBox(ctx, pw * 0.2, top + ph * 0.36, pw * 0.6, ph * 0.4, 10, lighten(base, 0.08), `${key}:seat`);
}

function drawCoffeeTable(ctx: CanvasRenderingContext2D, pw: number, ph: number, _a: string, _t: number, key: string): void {
  // Legs.
  ctx.fillStyle = darken(WOOD, 0.4);
  const lw = Math.max(2, pw * 0.04);
  ctx.fillRect(pw * 0.1, ph * 0.6, lw, ph * 0.3);
  ctx.fillRect(pw * 0.86, ph * 0.6, lw, ph * 0.3);
  // Glass / wood top.
  ctx.fillStyle = memoGrad(ctx, `${key}:top`, () => {
    const g = ctx.createLinearGradient(0, ph * 0.28, 0, ph * 0.62);
    g.addColorStop(0, rgba(lighten(GLASS, 0.3), 0.9));
    g.addColorStop(1, rgba(darken(GLASS, 0.1), 0.85));
    return g;
  });
  rr(ctx, pw * 0.06, ph * 0.3, pw * 0.88, ph * 0.3, 6);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Reflection streak.
  ctx.strokeStyle = rgba("#ffffff", 0.3);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pw * 0.16, ph * 0.4);
  ctx.lineTo(pw * 0.42, ph * 0.4);
  ctx.stroke();
}

function drawMeetingTable(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  // Surrounding chairs (simple nubs) — top & bottom rows.
  const seats = Math.max(2, Math.round(pw / (ph * 0.55)));
  ctx.fillStyle = mix(accent, [40, 44, 54], 0.4);
  for (let i = 0; i < seats; i++) {
    const sx = pw * 0.14 + ((pw * 0.72) * (i + 0.5)) / seats;
    rr(ctx, sx - pw * 0.05, ph * 0.02, pw * 0.1, ph * 0.16, 4);
    ctx.fill();
    rr(ctx, sx - pw * 0.05, ph * 0.82, pw * 0.1, ph * 0.16, 4);
    ctx.fill();
  }
  // Big rounded table top.
  const x = pw * 0.08;
  const y = ph * 0.2;
  const w = pw * 0.84;
  const hh = ph * 0.6;
  ctx.fillStyle = memoGrad(ctx, `${key}:top`, () => {
    const g = ctx.createLinearGradient(0, y, 0, y + hh);
    g.addColorStop(0, lighten(WOOD, 0.2));
    g.addColorStop(0.5, WOOD);
    g.addColorStop(1, darken(WOOD, 0.24));
    return g;
  });
  rr(ctx, x, y, w, hh, hh / 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Long figured grain running the length of the boardroom top.
  ctx.strokeStyle = rgba(darken(WOOD, 0.4), 0.1);
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 4; i++) {
    const gy = y + hh * (0.22 + 0.16 * i);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.06, gy);
    ctx.lineTo(x + w * 0.94, gy);
    ctx.stroke();
  }
  // Center inlay + rim light.
  ctx.strokeStyle = rgba("#ffffff", 0.16);
  ctx.lineWidth = 1;
  rr(ctx, x + w * 0.04, y + hh * 0.12, w * 0.92, hh * 0.3, hh * 0.15);
  ctx.stroke();
}

function drawBookshelf(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  shadedBox(ctx, 0, ph * 0.04, pw, ph * 0.92, 3, darken(WOOD, 0.2), `${key}:case`);
  const shelves = 2;
  const palette = ["#d05a5a", "#5a8fd0", "#e0b64a", "#5ac08a", accent, "#9a6fd0"];
  for (let s = 0; s < shelves; s++) {
    const sy = ph * 0.1 + (ph * 0.78 * s) / shelves;
    const sh = (ph * 0.78) / shelves - ph * 0.06;
    // Book spines.
    let bx = pw * 0.05;
    let i = 0;
    while (bx < pw * 0.92) {
      const bw = pw * (0.03 + ((i * 7) % 3) * 0.015);
      const bh = sh * (0.7 + ((i * 5) % 3) * 0.1);
      ctx.fillStyle = vGrad(ctx, `${key}:bk${palette[i % palette.length]}${Math.round(bh)}`, sy + sh - bh, sy + sh, palette[i % palette.length]);
      ctx.fillRect(bx, sy + sh - bh, bw, bh);
      ctx.strokeStyle = rgba("#000000", 0.18);
      ctx.lineWidth = 0.75;
      ctx.strokeRect(bx + 0.5, sy + sh - bh + 0.5, bw, bh);
      bx += bw + pw * 0.008;
      i++;
    }
    // Shelf board.
    ctx.fillStyle = darken(WOOD, 0.35);
    ctx.fillRect(pw * 0.03, sy + sh, pw * 0.94, ph * 0.03);
  }
}

function drawRug(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  const base = mix(accent, [235, 235, 240], 0.35);
  ctx.fillStyle = memoGrad(ctx, `${key}:rug`, () => {
    const g = ctx.createLinearGradient(0, 0, pw, ph);
    g.addColorStop(0, lighten(base, 0.06));
    g.addColorStop(1, darken(base, 0.08));
    return g;
  });
  rr(ctx, pw * 0.02, ph * 0.04, pw * 0.96, ph * 0.92, 8);
  ctx.fill();
  // Border bands.
  ctx.strokeStyle = rgba(darken(accent, 0.1), 0.55);
  ctx.lineWidth = Math.max(2, pw * 0.012);
  rr(ctx, pw * 0.06, ph * 0.1, pw * 0.88, ph * 0.8, 6);
  ctx.stroke();
  ctx.strokeStyle = rgba(accent, 0.4);
  ctx.lineWidth = Math.max(1, pw * 0.006);
  rr(ctx, pw * 0.1, ph * 0.16, pw * 0.8, ph * 0.68, 5);
  ctx.stroke();
  // Center medallion.
  ctx.fillStyle = rgba(darken(accent, 0.05), 0.35);
  ell(ctx, pw / 2, ph / 2, pw * 0.12, ph * 0.14);
  ctx.fill();
}

function drawRugRound(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  const cx = pw / 2;
  const cy = ph / 2;
  const rx = pw * 0.46;
  const ry = ph * 0.46;
  const rings = [
    [1, mix(accent, [235, 235, 240], 0.4)],
    [0.74, mix(accent, [235, 235, 240], 0.2)],
    [0.48, mix(accent, [235, 235, 240], 0.35)],
    [0.24, darken(accent, 0.05)],
  ] as const;
  for (const [scale, col] of rings) {
    ell(ctx, cx, cy, rx * scale, ry * scale);
    ctx.fillStyle = col as string;
    ctx.fill();
    ctx.strokeStyle = rgba("#000000", 0.08);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawReceptionDesk(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  // Curved front counter body.
  const x = pw * 0.04;
  const y = ph * 0.2;
  const w = pw * 0.92;
  const hh = ph * 0.66;
  ctx.fillStyle = vGrad(ctx, `${key}:body`, y, y + hh, mix("#3a4150", hexToRgb(accent), 0.2));
  ctx.beginPath();
  ctx.moveTo(x, y + hh);
  ctx.lineTo(x, y + hh * 0.3);
  ctx.quadraticCurveTo(x, y, x + w * 0.12, y);
  ctx.lineTo(x + w * 0.88, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + hh * 0.3);
  ctx.lineTo(x + w, y + hh);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Accent logo band.
  ctx.fillStyle = rgba(accent, 0.85);
  ctx.fillRect(x + w * 0.1, y + hh * 0.4, w * 0.8, hh * 0.14);
  // Overhang counter top.
  shadedBox(ctx, x - pw * 0.02, y - ph * 0.02, w + pw * 0.04, ph * 0.14, 4, lighten(WOOD, 0.05), `${key}:top`);
}

function drawCafeCounter(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  const x = pw * 0.03;
  const y = ph * 0.24;
  const w = pw * 0.94;
  const hh = ph * 0.62;
  // Cabinet front with panel seams.
  ctx.fillStyle = vGrad(ctx, `${key}:body`, y, y + hh, darken(WOOD, 0.15));
  rr(ctx, x, y, w, hh, 4);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const panels = Math.max(3, Math.round(w / (ph * 0.8)));
  ctx.strokeStyle = rgba("#000000", 0.18);
  ctx.lineWidth = 1;
  for (let i = 1; i < panels; i++) {
    const bx = x + (w * i) / panels;
    ctx.beginPath();
    ctx.moveTo(bx, y + hh * 0.12);
    ctx.lineTo(bx, y + hh * 0.9);
    ctx.stroke();
  }
  // Stone counter top + accent trim.
  shadedBox(ctx, x - pw * 0.01, y - ph * 0.04, w + pw * 0.02, ph * 0.16, 3, "#d8dde3", `${key}:top`);
  ctx.fillStyle = rgba(accent, 0.7);
  ctx.fillRect(x, y + hh - ph * 0.05, w, ph * 0.05);
}

function drawCoffeeMachine(ctx: CanvasRenderingContext2D, pw: number, ph: number, _a: string, t: number, key: string): void {
  const cx = pw / 2;
  // Body.
  shadedBox(ctx, cx - pw * 0.26, ph * 0.28, pw * 0.52, ph * 0.6, 5, "#3c4250", `${key}:body`);
  // Group head + cup.
  ctx.fillStyle = METAL;
  ctx.fillRect(cx - pw * 0.1, ph * 0.5, pw * 0.2, ph * 0.06);
  ctx.fillStyle = "#f2f4f6";
  rr(ctx, cx - pw * 0.08, ph * 0.62, pw * 0.16, ph * 0.14, 2);
  ctx.fill();
  // Top warmer plate.
  ctx.fillStyle = darken("#3c4250", 0.2);
  ctx.fillRect(cx - pw * 0.24, ph * 0.24, pw * 0.48, ph * 0.06);
  // Animated steam.
  for (let i = 0; i < 3; i++) {
    const phase = (t / 700 + i * 0.7) % 1;
    const sx = cx + (i - 1) * pw * 0.08;
    const sy = ph * 0.24 - phase * ph * 0.22;
    ell(ctx, sx + Math.sin(phase * 6) * pw * 0.03, sy, pw * 0.05, pw * 0.07);
    ctx.fillStyle = rgba("#ffffff", 0.28 * (1 - phase));
    ctx.fill();
  }
}

function drawWaterCooler(ctx: CanvasRenderingContext2D, pw: number, ph: number, _a: string, _t: number, key: string): void {
  const cx = pw / 2;
  // Body.
  shadedBox(ctx, cx - pw * 0.2, ph * 0.34, pw * 0.4, ph * 0.56, 4, "#e7ecf1", `${key}:body`);
  // Bottle.
  ctx.fillStyle = memoGrad(ctx, `${key}:bottle`, () => {
    const g = ctx.createLinearGradient(cx - pw * 0.18, 0, cx + pw * 0.18, 0);
    g.addColorStop(0, rgba("#8fd0e6", 0.55));
    g.addColorStop(0.5, rgba("#c8ecf6", 0.85));
    g.addColorStop(1, rgba("#8fd0e6", 0.55));
    return g;
  });
  ctx.beginPath();
  ctx.moveTo(cx - pw * 0.16, ph * 0.36);
  ctx.quadraticCurveTo(cx - pw * 0.2, ph * 0.1, cx, ph * 0.06);
  ctx.quadraticCurveTo(cx + pw * 0.2, ph * 0.1, cx + pw * 0.16, ph * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Spout.
  ctx.fillStyle = "#4a5260";
  ctx.fillRect(cx - pw * 0.04, ph * 0.5, pw * 0.08, ph * 0.06);
}

function drawWallArt(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  // Frame.
  shadedBox(ctx, pw * 0.06, ph * 0.06, pw * 0.88, ph * 0.84, 3, "#2a2f3a", `${key}:frame`);
  // Canvas with abstract accent shapes.
  const ix = pw * 0.12;
  const iy = ph * 0.14;
  const iw = pw * 0.76;
  const ih = ph * 0.68;
  ctx.fillStyle = "#eef1f4";
  ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = rgba(accent, 0.85);
  ell(ctx, ix + iw * 0.35, iy + ih * 0.5, iw * 0.2, ih * 0.28);
  ctx.fill();
  ctx.fillStyle = rgba(darken(accent, 0.2), 0.7);
  ctx.fillRect(ix + iw * 0.55, iy + ih * 0.3, iw * 0.22, ih * 0.5);
}

function drawWindow(ctx: CanvasRenderingContext2D, pw: number, ph: number, _a: string, _t: number, key: string): void {
  // Sky pane.
  ctx.fillStyle = memoGrad(ctx, `${key}:sky`, () => {
    const g = ctx.createLinearGradient(0, 0, 0, ph);
    g.addColorStop(0, "#bfe3f5");
    g.addColorStop(1, "#e9f4fb");
    return g;
  });
  rr(ctx, pw * 0.02, ph * 0.08, pw * 0.96, ph * 0.8, 3);
  ctx.fill();
  // Sun glare.
  ctx.fillStyle = rgba("#ffffff", 0.5);
  ell(ctx, pw * 0.2, ph * 0.32, pw * 0.05, ph * 0.18);
  ctx.fill();
  // Frame + mullions.
  ctx.strokeStyle = "#e7ecf1";
  ctx.lineWidth = Math.max(2, ph * 0.12);
  rr(ctx, pw * 0.02, ph * 0.08, pw * 0.96, ph * 0.8, 3);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, ph * 0.06);
  const bars = Math.max(1, Math.round(pw / (ph * 3)));
  for (let i = 1; i <= bars; i++) {
    const bx = (pw * i) / (bars + 1);
    ctx.beginPath();
    ctx.moveTo(bx, ph * 0.08);
    ctx.lineTo(bx, ph * 0.88);
    ctx.stroke();
  }
}

function drawDivider(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  // Vertical partition — panel + feet.
  const base = mix("#4a5160", hexToRgb(accent), 0.12);
  ctx.fillStyle = memoGrad(ctx, `${key}:panel`, () => {
    const g = ctx.createLinearGradient(0, 0, pw, 0);
    g.addColorStop(0, lighten(base, 0.16));
    g.addColorStop(0.5, base);
    g.addColorStop(1, darken(base, 0.18));
    return g;
  });
  rr(ctx, pw * 0.2, ph * 0.04, pw * 0.6, ph * 0.9, 4);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Feet.
  ctx.fillStyle = DARK;
  ctx.fillRect(pw * 0.05, ph * 0.9, pw * 0.9, ph * 0.06);
}

function drawPod(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, _t: number, key: string): void {
  const cx = pw / 2;
  const cy = ph / 2;
  // Enclosure shell.
  ctx.fillStyle = vGrad(ctx, `${key}:shell`, ph * 0.06, ph * 0.94, mix("#39404e", hexToRgb(accent), 0.16));
  rr(ctx, pw * 0.06, ph * 0.06, pw * 0.88, ph * 0.88, Math.min(pw, ph) * 0.22);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Interior opening (top-down booth).
  ctx.fillStyle = rgba("#0f1116", 0.4);
  rr(ctx, pw * 0.16, ph * 0.16, pw * 0.68, ph * 0.5, Math.min(pw, ph) * 0.12);
  ctx.fill();
  // Bench + accent cushions.
  shadedBox(ctx, pw * 0.2, ph * 0.6, pw * 0.6, ph * 0.22, 6, mix(FABRIC, hexToRgb(accent), 0.3), `${key}:bench`);
  // Little round table inside.
  ell(ctx, cx, cy - ph * 0.06, pw * 0.1, ph * 0.09);
  ctx.fillStyle = lighten(WOOD, 0.08);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawLamp(ctx: CanvasRenderingContext2D, pw: number, ph: number, _a: string, t: number, key: string): void {
  const cx = pw / 2;
  // Base.
  ell(ctx, cx, ph * 0.88, pw * 0.2, ph * 0.05);
  ctx.fillStyle = DARK;
  ctx.fill();
  // Pole.
  ctx.strokeStyle = darken(METAL, 0.2);
  ctx.lineWidth = Math.max(2, pw * 0.04);
  ctx.beginPath();
  ctx.moveTo(cx, ph * 0.86);
  ctx.lineTo(cx, ph * 0.34);
  ctx.stroke();
  // Warm glow halo (subtle breathing).
  const glow = 0.5 + 0.14 * Math.sin(t / 1200);
  ctx.fillStyle = memoGrad(ctx, `${key}:glow`, () => {
    const g = ctx.createRadialGradient(cx, ph * 0.22, 0, cx, ph * 0.22, pw * 0.4);
    g.addColorStop(0, "rgba(255,220,150,0.45)");
    g.addColorStop(1, "rgba(255,220,150,0)");
    return g;
  });
  ctx.save();
  ctx.globalAlpha = glow;
  ell(ctx, cx, ph * 0.22, pw * 0.4, pw * 0.4);
  ctx.fill();
  ctx.restore();
  // Shade.
  ctx.fillStyle = vGrad(ctx, `${key}:shade`, ph * 0.06, ph * 0.34, "#f0d9a8", 0.14, 0.16);
  ctx.beginPath();
  ctx.moveTo(cx - pw * 0.22, ph * 0.34);
  ctx.lineTo(cx - pw * 0.14, ph * 0.08);
  ctx.lineTo(cx + pw * 0.14, ph * 0.08);
  ctx.lineTo(cx + pw * 0.22, ph * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawServerRack(ctx: CanvasRenderingContext2D, pw: number, ph: number, accent: string, t: number, key: string): void {
  // Cabinet.
  shadedBox(ctx, pw * 0.08, ph * 0.06, pw * 0.84, ph * 0.9, 4, "#1f242e", `${key}:cab`);
  // Rack units with blinking LEDs.
  const units = Math.max(4, Math.round(ph / (ph * 0.16)));
  const ux = pw * 0.14;
  const uw = pw * 0.72;
  for (let i = 0; i < units; i++) {
    const uy = ph * 0.12 + (ph * 0.76 * i) / units;
    const uh = (ph * 0.76) / units - ph * 0.015;
    ctx.fillStyle = vGrad(ctx, `${key}:u`, uy, uy + uh, "#333b47");
    ctx.fillRect(ux, uy, uw, uh);
    ctx.strokeStyle = rgba("#000000", 0.3);
    ctx.lineWidth = 0.75;
    ctx.strokeRect(ux + 0.5, uy + 0.5, uw, uh);
    // LEDs — cheap deterministic blink.
    for (let j = 0; j < 3; j++) {
      const on = Math.sin(t / 400 + i * 1.3 + j * 2.1) > 0;
      ctx.fillStyle = on ? (j === 0 ? "#54d67a" : rgba(accent, 0.95)) : "rgba(255,255,255,0.15)";
      ell(ctx, ux + uw - pw * 0.06 - j * pw * 0.06, uy + uh / 2, pw * 0.014, pw * 0.014);
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Uploaded branding image (logo / poster / wall art).
//
// A module-level cache of decoded <img> elements keyed by `src`, shared across
// every context and instance. The office renders inside a rAF loop, so a prop
// flips from placeholder to photo automatically on the first frame after the
// image finishes decoding — no React state or reflow involved.
// ---------------------------------------------------------------------------

const IMAGE_CACHE = new Map<string, HTMLImageElement>();

const BRASS = "#b98a3e";

/** A brass-framed placeholder with a small picture glyph (SSR + loading state). */
function drawImagePlaceholder(
  ctx: CanvasRenderingContext2D,
  pw: number,
  ph: number,
  key: string,
): void {
  // Brushed-brass frame.
  shadedBox(ctx, 0, 0, pw, ph, 4, BRASS, `${key}:imgframe`);
  // Matte opening.
  const b = Math.max(2, Math.min(pw, ph) * 0.08);
  ctx.fillStyle = "#2a2f3a";
  rr(ctx, b, b, pw - b * 2, ph - b * 2, 3);
  ctx.fill();
  // Picture glyph: a small sun + mountain inside the opening.
  const gx = pw * 0.5;
  const gy = ph * 0.5;
  const gs = Math.min(pw, ph) * 0.26;
  ctx.fillStyle = rgba("#f0d9a8", 0.85);
  ell(ctx, gx - gs * 0.5, gy - gs * 0.45, gs * 0.28, gs * 0.28);
  ctx.fill();
  ctx.fillStyle = rgba("#9aa6b4", 0.9);
  ctx.beginPath();
  ctx.moveTo(gx - gs, gy + gs * 0.7);
  ctx.lineTo(gx - gs * 0.2, gy - gs * 0.1);
  ctx.lineTo(gx + gs * 0.2, gy + gs * 0.3);
  ctx.lineTo(gx + gs * 0.55, gy - gs * 0.05);
  ctx.lineTo(gx + gs, gy + gs * 0.7);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw an uploaded branding image cover-fit into the footprint, inside a
 * brushed-brass frame with a soft drop shadow. Guards SSR/jest (`Image`
 * undefined) and a not-yet-decoded image by drawing the placeholder instead —
 * it never throws.
 */
function drawImage(
  ctx: CanvasRenderingContext2D,
  pw: number,
  ph: number,
  _a: string,
  _t: number,
  key: string,
  src?: string,
): void {
  if (!src || typeof Image === "undefined") {
    drawImagePlaceholder(ctx, pw, ph, key);
    return;
  }
  let img = IMAGE_CACHE.get(src);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    IMAGE_CACHE.set(src, img);
  }
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
    drawImagePlaceholder(ctx, pw, ph, key);
    return;
  }

  // Brushed-brass frame with a soft drop shadow.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = Math.max(4, Math.min(pw, ph) * 0.12);
  ctx.shadowOffsetY = Math.max(2, ph * 0.04);
  shadedBox(ctx, 0, 0, pw, ph, 4, BRASS, `${key}:imgframe`);
  ctx.restore();

  // Cover-fit the photo into the frame opening (clip to the inner rect).
  const b = Math.max(2, Math.min(pw, ph) * 0.06);
  const ix = b;
  const iy = b;
  const iw = pw - b * 2;
  const ih = ph - b * 2;
  const scale = Math.max(iw / img.naturalWidth, ih / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const dx = ix + (iw - dw) / 2;
  const dy = iy + (ih - dh) / 2;
  ctx.save();
  rr(ctx, ix, iy, iw, ih, 2);
  ctx.clip();
  try {
    ctx.drawImage(img, dx, dy, dw, dh);
  } catch {
    // A broken/tainted image can throw on draw — degrade to the matte.
    ctx.fillStyle = "#2a2f3a";
    ctx.fillRect(ix, iy, iw, ih);
  }
  ctx.restore();
  // Inner rim to seat the photo in the frame.
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  rr(ctx, ix, iy, iw, ih, 2);
  ctx.stroke();
}

const DRAWERS: Record<OfficeObjectKind, Drawer> = {
  desk: drawDesk,
  plant: drawPlant,
  whiteboard: drawWhiteboard,
  couch: drawCouch,
  table: drawTable,
  screen: drawScreen,
  chair: drawChair,
  monitor: drawMonitor,
  plant_lg: drawPlantLg,
  armchair: drawArmchair,
  coffee_table: drawCoffeeTable,
  meeting_table: drawMeetingTable,
  tv: drawTv,
  bookshelf: drawBookshelf,
  rug: drawRug,
  rug_round: drawRugRound,
  reception_desk: drawReceptionDesk,
  cafe_counter: drawCafeCounter,
  coffee_machine: drawCoffeeMachine,
  water_cooler: drawWaterCooler,
  wall_art: drawWallArt,
  window: drawWindow,
  divider: drawDivider,
  pod: drawPod,
  lamp: drawLamp,
  server_rack: drawServerRack,
  image: drawImage,
};
