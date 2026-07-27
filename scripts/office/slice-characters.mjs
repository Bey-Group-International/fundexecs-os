// scripts/office/slice-characters.mjs
// One-shot asset pipeline: slice the uploaded per-character sprite SHEETS into
// the office's canonical walk ATLAS (768×1024, 3 cols × 4 rows of 256px cells;
// rows = down / up / left / right; 3 walk frames each) — the exact format the
// office floor already renders for staff (/assets/fundexecs/characters/<k>/walk.png)
// and for the member's "you" avatar (public/office/map.html).
//
// Each source sheet is a figure grid on a white background with ragged spacing,
// so we detect rows/frames by projection profiles rather than assuming a grid,
// knock out the EXTERIOR white to transparent via an edge flood-fill (interior
// whites like shoes/eyes are enclosed, so they survive), then normalize every
// frame into a 256px cell at a shared scale + bottom baseline. RIGHT is the
// mirror of LEFT so the character always faces its travel direction.
//
// Usage:
//   node scripts/office/slice-characters.mjs               # all sheets
//   DEBUG_IDX=0 OUT=/tmp/... node scripts/office/slice-characters.mjs
import sharp from "sharp";
import fs from "fs";
import path from "path";

const SRC_DIR =
  process.env.SRC_DIR ||
  "/tmp/claude-0/-home-user-fundexecs-os/d9beb0e4-8703-55f0-8a62-4f998b06a4f7/scratchpad/user_avatars/user avatars";
const OUT_ROOT = process.env.OUT || path.resolve("public/assets/fundexecs/user-characters");

const CELL = 256;
const COLS = 3;
const ROWS = 4; // down, up, left, right
const ATLAS_W = CELL * COLS; // 768
const ATLAS_H = CELL * ROWS; // 1024
const TARGET_H = 212; // figure height within a cell (matches staff atlas)
const BASELINE = 236; // y of the figure's feet within the 256 cell
const BG = 236; // >= on all channels ⇒ treated as background (near-white)

// ── raw helpers ──────────────────────────────────────────────────────────────
async function loadRaw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const isFg = (d, i) => d[i + 3] > 20 && !(d[i] >= BG && d[i + 1] >= BG && d[i + 2] >= BG);

// Edge flood-fill: mark every background-connected near-white pixel transparent.
function knockoutBackground({ data, w, h }) {
  const out = Buffer.from(data); // copy
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p]) return;
    const i = p * 4;
    if (out[i] >= BG && out[i + 1] >= BG && out[i + 2] >= BG) {
      seen[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    out[p * 4 + 3] = 0; // transparent
    const x = p % w,
      y = (p / w) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return { data: out, w, h };
}

// ── band detection ───────────────────────────────────────────────────────────
function rowBands({ data, w, h }) {
  const active = new Array(h).fill(false);
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (isFg(data, (y * w + x) * 4)) c++;
    active[y] = c > w * 0.004;
  }
  return mergeBands(active, 10, 60);
}
function colBands({ data, w }, y0, y1) {
  const width = w;
  const active = new Array(width).fill(false);
  for (let x = 0; x < width; x++) {
    let c = 0;
    for (let y = y0; y < y1; y++) if (isFg(data, (y * width + x) * 4)) c++;
    active[x] = c > (y1 - y0) * 0.03;
  }
  return mergeBands(active, 20, 36);
}
function mergeBands(active, gapTol, minLen) {
  const bands = [];
  let s = -1;
  for (let i = 0; i < active.length; i++) {
    if (active[i] && s < 0) s = i;
    else if (!active[i] && s >= 0) {
      bands.push([s, i - 1]);
      s = -1;
    }
  }
  if (s >= 0) bands.push([s, active.length - 1]);
  // merge across small gaps
  const merged = [];
  for (const b of bands) {
    if (merged.length && b[0] - merged[merged.length - 1][1] <= gapTol) merged[merged.length - 1][1] = b[1];
    else merged.push([...b]);
  }
  return merged.filter(([a, b]) => b - a + 1 >= minLen);
}

// Tighten a bbox to the actual foreground extent inside a coarse rect.
function tighten({ data, w }, x0, x1, y0, y1) {
  let minx = x1,
    maxx = x0,
    miny = y1,
    maxy = y0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (isFg(data, (y * w + x) * 4)) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
  if (maxx < minx) return null;
  return { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
}

// ── per-sheet slicing ────────────────────────────────────────────────────────
async function sliceSheet(file) {
  const raw0 = await loadRaw(file);
  const raw = knockoutBackground(raw0);
  const rbands = rowBands(raw);
  if (rbands.length < 3) throw new Error(`only ${rbands.length} row bands in ${path.basename(file)}`);

  // First three usable bands are the walk rows we need: down, up, side(left).
  const dirBands = { down: rbands[0], up: rbands[1], left: rbands[2] };
  const cells = {}; // dir -> [ {frame bbox}, x3 ]
  for (const [dir, band] of Object.entries(dirBands)) {
    const cbs = colBands(raw, band[0], band[1] + 1);
    const groups = cbs.length >= 3 ? cbs.slice(0, 3) : cbs;
    const frames = groups
      .map((cb) => tighten(raw, cb[0], cb[1], band[0], band[1]))
      .filter(Boolean);
    if (frames.length < 1) throw new Error(`no frames in ${dir} of ${path.basename(file)}`);
    while (frames.length < 3) frames.push(frames[frames.length - 1]); // pad if a frame merged
    cells[dir] = frames.slice(0, 3);
  }

  // Scale by the FRONT (down) body height — the canonical figure size — so every
  // character reads at a consistent body scale. (Keying off the tallest frame
  // would let an unusually long back-hair frame shrink the whole character.)
  const downH = [...cells.down.map((f) => f.h)].sort((a, b) => a - b)[1]; // median of 3
  const scale = Math.min(TARGET_H / downH, (CELL - 20) / widestFrame(cells));

  const png = await sharp(raw.data, { raw: { width: raw.w, height: raw.h, channels: 4 } })
    .png()
    .toBuffer();

  const layers = [];
  const rowOf = { down: 0, up: 1, left: 2, right: 3 };
  for (const dir of ["down", "up", "left"]) {
    for (let fi = 0; fi < 3; fi++) {
      const f = cells[dir][fi];
      const cell = await frameToCell(png, f, scale, false);
      layers.push({ input: cell, left: fi * CELL, top: rowOf[dir] * CELL });
    }
  }
  // RIGHT = mirror of LEFT (guaranteed correct facing).
  for (let fi = 0; fi < 3; fi++) {
    const f = cells.left[fi];
    const cell = await frameToCell(png, f, scale, true);
    layers.push({ input: cell, left: fi * CELL, top: rowOf.right * CELL });
  }

  const atlas = await sharp({
    create: { width: ATLAS_W, height: ATLAS_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(layers)
    .png()
    .toBuffer();

  // Portrait tile = front idle frame (down, middle), on a transparent cell.
  const portrait = await sharp(await frameToCell(png, cells.down[1], scale, false))
    .png()
    .toBuffer();

  return { atlas, portrait };
}

function widestFrame(cells) {
  let m = 1;
  for (const d of Object.values(cells)) for (const f of d) m = Math.max(m, f.w);
  return m;
}

// Extract one frame bbox, scale it, and place it bottom-centered in a 256 cell.
async function frameToCell(png, f, scale, mirror) {
  // Per-frame overflow clamp: if this frame (e.g. a long-hair back view) would
  // exceed the cell at the character's body scale, shrink just this frame to fit
  // rather than clipping the top of the hair.
  let s = scale;
  const fit = (CELL - 6) / (f.h * scale);
  if (fit < 1) s = scale * fit;
  const tw = Math.max(1, Math.round(f.w * s));
  const th = Math.max(1, Math.round(f.h * s));
  let img = sharp(png).extract({ left: f.x, top: f.y, width: f.w, height: f.h }).resize(tw, th, {
    kernel: "nearest",
  });
  if (mirror) img = img.flop();
  const frame = await img.png().toBuffer();
  const left = Math.round((CELL - tw) / 2);
  const top = Math.round(BASELINE - th);
  return sharp({
    create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: frame, left: Math.max(0, left), top: Math.max(0, top) }])
    .png()
    .toBuffer();
}

// ── main ─────────────────────────────────────────────────────────────────────
const files = fs
  .readdirSync(SRC_DIR)
  .filter((f) => f.toLowerCase().endsWith(".png"))
  .sort();

// Stable, descriptive slugs mapped to the sorted source files (this is a
// one-shot pipeline over exactly these 10 sheets).
const SLUGS = [
  "auburn-hoodie",
  "gold-blouse",
  "teal-blazer",
  "lavender-cardigan",
  "blue-shirt",
  "green-sweater",
  "emerald-wave",
  "maroon-shirt",
  "coral-jacket",
  "navy-beard",
];

const debugIdx = process.env.DEBUG_IDX != null ? Number(process.env.DEBUG_IDX) : null;
const targets = debugIdx != null ? [files[debugIdx]] : files;

for (let i = 0; i < targets.length; i++) {
  const file = path.join(SRC_DIR, targets[i]);
  const slug = process.env.SLUG || SLUGS[debugIdx ?? i] || `char-${String((debugIdx ?? i) + 1).padStart(2, "0")}`;
  try {
    const { atlas, portrait } = await sliceSheet(file);
    if (debugIdx != null && process.env.OUT) {
      fs.writeFileSync(path.join(process.env.OUT, "dbg-atlas.png"), atlas);
      fs.writeFileSync(path.join(process.env.OUT, "dbg-portrait.png"), portrait);
      console.log("DEBUG wrote", slug, "from", targets[i]);
    } else {
      const dir = path.join(OUT_ROOT, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "walk.png"), atlas);
      fs.writeFileSync(path.join(dir, "portrait.png"), portrait);
      console.log("wrote", slug, "←", targets[i]);
    }
  } catch (e) {
    console.error("FAILED", targets[i], e.message);
  }
}
