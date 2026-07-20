// Hand-authored humanoid sprites, procedurally recolored per AvatarConfig.
//
// PURE composition — no canvas, no DOM. `resolveAvatar` turns a config into a
// palette plus a set of directional frames (idle + a 2-frame walk cycle for
// each facing). The art lives on a ~16×22 pixel grid built from a base body
// template, a hair-style overlay (all five styles), and an accessory overlay
// (all five). Every silhouette gets a 1px dark outline so it reads on light AND
// dark floors — the outline is computed from the silhouette, not the theme.
//
// The pixel engine (components/office/pixelSprite.ts) consumes the `string[]`
// frames and `Palette` this module produces.
import type { Palette } from "@/components/office/pixelSprite";
import type {
  AvatarConfig,
  Accessory,
  Facing,
  HairStyle,
} from "@/lib/office/avatarConfig";

/** Sprite grid dimensions. Frames are exactly SPRITE_W×SPRITE_H characters. */
export const SPRITE_W = 16;
export const SPRITE_H = 22;

/** Internal drawing view — `side` is authored once and mirrored for left/right. */
type View = "down" | "up" | "side";

export interface ResolvedAvatar {
  palette: Palette;
  /** Per facing: [idle, walkA, walkB]. `left`/`right` share the mirrored side art. */
  frames: Record<Facing, string[][]>;
}

// ── Color helpers ──────────────────────────────────────────────────────────

/** Multiply an #rrggbb color toward black by `f` (0 = same, 1 = black). */
function darken(hex: string, f: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = Math.round(parseInt(full.slice(0, 2), 16) * (1 - f));
  const g = Math.round(parseInt(full.slice(2, 4), 16) * (1 - f));
  const b = Math.round(parseInt(full.slice(4, 6), 16) * (1 - f));
  const to = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * The palette for a config. Keys are the single characters the art uses; the
 * config's own colors flow in for skin/hair/shirt so recoloring is free. Fixed
 * neutral/accessory colors round it out. Every key is always present (even for
 * e.g. "bald", which draws no hair pixels) so the palette is stable.
 */
function buildPalette(config: AvatarConfig): Palette {
  return {
    O: "#20232e", // silhouette outline (dark, theme-agnostic)
    S: config.skin,
    K: darken(config.skin, 0.18), // skin shadow (chin / hairline)
    H: config.hairColor,
    T: config.shirt,
    t: darken(config.shirt, 0.2), // shirt shadow (sleeves)
    E: "#20232e", // eyes
    P: "#3a3f4b", // trousers / legs
    g: "#20232e", // glasses frame
    d: "#2b2f3a", // headset band + ear cups
    m: "#9aa0aa", // headset mic boom
    c: "#2f3646", // cap crown
    v: "#20232e", // cap brim
    b: "#3a6ea5", // beanie
  };
}

// ── Grid helpers ─────────────────────────────────────────────────────────────

type Grid = string[][];

function blankGrid(): Grid {
  return Array.from({ length: SPRITE_H }, () =>
    Array.from({ length: SPRITE_W }, () => " "),
  );
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < SPRITE_W && y >= 0 && y < SPRITE_H;
}

function setPx(g: Grid, x: number, y: number, ch: string): void {
  if (inBounds(x, y)) g[y][x] = ch;
}

/** Inclusive rectangle fill. */
function fillRect(
  g: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ch: string,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) setPx(g, x, y, ch);
  }
}

/**
 * Wrap the drawn silhouette in a 1px dark outline: any transparent cell that is
 * 4-adjacent to a filled cell becomes an outline pixel. Theme-agnostic and
 * automatic, so the art never has to hand-place edge pixels.
 */
function addOutline(g: Grid): void {
  const outline: Array<[number, number]> = [];
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      if (g[y][x] !== " ") continue;
      const neighbour =
        (inBounds(x - 1, y) && g[y][x - 1] !== " ") ||
        (inBounds(x + 1, y) && g[y][x + 1] !== " ") ||
        (inBounds(x, y - 1) && g[y - 1][x] !== " ") ||
        (inBounds(x, y + 1) && g[y + 1][x] !== " ");
      if (neighbour) outline.push([x, y]);
    }
  }
  for (const [x, y] of outline) g[y][x] = "O";
}

// ── Body / face ──────────────────────────────────────────────────────────────
//
// Layout (pre-outline), on the 16×22 grid with a 1px margin for the outline:
//   head  rows 3–9, cols 4–11 (8 wide)
//   eyes  row 6
//   neck  row 10
//   torso rows 11–16, cols 4–11
//   arms  cols 3 / 12, rows 12–15
//   legs  rows 17–20, left cols 5–6, right cols 9–10

function drawBody(g: Grid, view: View, frame: number): void {
  // Neck.
  fillRect(g, 7, 10, 8, 10, "S");

  // Torso (shirt).
  fillRect(g, 4, 11, 11, 16, "T");
  // A touch of shirt shadow down the sides for volume.
  fillRect(g, 4, 12, 4, 15, "t");
  fillRect(g, 11, 12, 11, 15, "t");

  // Arms — the side view only shows the near (front) arm. Walk cycle swings one
  // hand up per stride (frame 1 raises the right, frame 2 the left).
  const drawArm = (col: number, raised: boolean) => {
    const bottom = raised ? 14 : 15;
    for (let r = 12; r < bottom; r++) setPx(g, col, r, "t");
    setPx(g, col, bottom, "S"); // hand
  };
  if (view !== "side") drawArm(3, frame === 2);
  drawArm(12, frame === 1);

  // Legs — the trailing leg lifts a pixel on its stride frame.
  const leftBottom = frame === 2 ? 19 : 20;
  const rightBottom = frame === 1 ? 19 : 20;
  fillRect(g, 5, 17, 6, leftBottom, "P");
  fillRect(g, 9, 17, 10, rightBottom, "P");
}

function drawHead(g: Grid, view: View): void {
  // Head skin block.
  fillRect(g, 4, 3, 11, 9, "S");
  // Soft jaw shadow.
  fillRect(g, 5, 9, 10, 9, "K");

  if (view === "down") {
    setPx(g, 6, 6, "E");
    setPx(g, 9, 6, "E");
    // Hint of a mouth.
    fillRect(g, 7, 8, 8, 8, "K");
  } else if (view === "side") {
    // Facing right: one eye near the front, a small nose poking out.
    setPx(g, 9, 6, "E");
    setPx(g, 12, 6, "S");
    setPx(g, 12, 7, "S");
  }
  // `up` (back of head) shows no face.
}

// ── Hair ─────────────────────────────────────────────────────────────────────

function drawHair(g: Grid, style: HairStyle, view: View): void {
  if (style === "bald") return;

  if (view === "up") {
    // Back of the head — haired styles cover the whole skull.
    const bottom = style === "buzz" ? 8 : 9;
    fillRect(g, 4, 3, 11, bottom, "H");
    if (style === "long") fillRect(g, 3, 10, 12, 15, "H");
    if (style === "bun") fillRect(g, 6, 1, 9, 3, "H");
    return;
  }

  // Front / side: crown on top, then style-specific framing.
  const topBottom = style === "buzz" ? 3 : 4;
  fillRect(g, 4, 3, 11, topBottom, "H");

  if (view === "down") {
    if (style !== "buzz") {
      // Temples.
      setPx(g, 4, 5, "H");
      setPx(g, 11, 5, "H");
    }
    if (style === "long") {
      // Strands framing the face and falling past the shoulders.
      fillRect(g, 3, 5, 3, 14, "H");
      fillRect(g, 12, 5, 12, 14, "H");
      setPx(g, 4, 6, "H");
      setPx(g, 11, 6, "H");
    }
    if (style === "bun") fillRect(g, 6, 1, 9, 2, "H");
  } else {
    // side (facing right): hair sits over the back (left) of the skull.
    fillRect(g, 4, 4, 5, 8, "H");
    if (style === "long") fillRect(g, 3, 5, 4, 14, "H");
    if (style === "bun") fillRect(g, 3, 2, 5, 3, "H");
  }
}

// ── Accessories ──────────────────────────────────────────────────────────────

function drawAccessory(g: Grid, accessory: Accessory, view: View): void {
  switch (accessory) {
    case "none":
      return;

    case "glasses":
      if (view === "down") {
        // Two lenses bridged across the eyes.
        setPx(g, 5, 6, "g");
        setPx(g, 6, 6, "g");
        setPx(g, 7, 6, "g");
        setPx(g, 9, 6, "g");
        setPx(g, 10, 6, "g");
      } else if (view === "side") {
        setPx(g, 8, 6, "g");
        setPx(g, 9, 6, "g");
        setPx(g, 10, 6, "g");
      }
      return;

    case "headset":
      if (view === "down") {
        fillRect(g, 5, 2, 10, 2, "d"); // band over the crown
        fillRect(g, 3, 5, 3, 7, "d"); // left ear cup
        fillRect(g, 12, 5, 12, 7, "d"); // right ear cup
        setPx(g, 12, 8, "m"); // mic boom to the mouth
        setPx(g, 11, 9, "m");
      } else if (view === "up") {
        fillRect(g, 5, 2, 10, 2, "d");
        fillRect(g, 3, 5, 3, 7, "d");
        fillRect(g, 12, 5, 12, 7, "d");
      } else {
        // side (facing right): near ear cup at the back, mic to the front.
        fillRect(g, 4, 2, 9, 2, "d");
        fillRect(g, 3, 5, 3, 7, "d");
        setPx(g, 11, 8, "m");
        setPx(g, 12, 8, "m");
      }
      return;

    case "cap":
      // Crown covers the hair top; brim points toward the face.
      fillRect(g, 4, 2, 11, 4, "c");
      setPx(g, 5, 1, "c");
      fillRect(g, 6, 1, 9, 1, "c");
      if (view === "down") {
        fillRect(g, 4, 5, 11, 5, "v"); // brim over the forehead
      } else if (view === "side") {
        fillRect(g, 12, 4, 14, 4, "v"); // brim juts forward
      }
      return;

    case "beanie":
      // Snug knit cap over the top of the head with a folded band.
      fillRect(g, 4, 2, 11, 5, "b");
      fillRect(g, 5, 1, 10, 1, "b");
      setPx(g, 7, 0, "b"); // pom
      setPx(g, 8, 0, "b");
      if (view === "side") fillRect(g, 3, 2, 3, 5, "b");
      return;
  }
}

// ── Frame assembly ───────────────────────────────────────────────────────────

function buildFrame(
  view: View,
  hair: HairStyle,
  accessory: Accessory,
  frame: number,
): string[] {
  const g = blankGrid();
  drawBody(g, view, frame);
  drawHead(g, view);
  drawHair(g, hair, view);
  drawAccessory(g, accessory, view);
  addOutline(g);
  return g.map((row) => row.join(""));
}

function buildFrames(
  view: View,
  hair: HairStyle,
  accessory: Accessory,
): string[][] {
  return [0, 1, 2].map((f) => buildFrame(view, hair, accessory, f));
}

// ── Public API (memoized) ────────────────────────────────────────────────────

const cache = new Map<string, ResolvedAvatar>();

function configKey(c: AvatarConfig): string {
  return `${c.skin}|${c.hair}|${c.hairColor}|${c.shirt}|${c.accessory}`;
}

/**
 * Resolve a config into a palette + directional frames. `frames[facing]` is
 * `[idle, walkA, walkB]`. The `side` art is authored facing RIGHT and shared by
 * both `left` and `right`; the renderer mirrors it horizontally for `left`.
 * Memoized by config key so repeated calls (every animation frame) are cheap.
 */
export function resolveAvatar(config: AvatarConfig): ResolvedAvatar {
  const key = configKey(config);
  const hit = cache.get(key);
  if (hit) return hit;

  const side = buildFrames("side", config.hair, config.accessory);
  const resolved: ResolvedAvatar = {
    palette: buildPalette(config),
    frames: {
      down: buildFrames("down", config.hair, config.accessory),
      up: buildFrames("up", config.hair, config.accessory),
      left: side,
      right: side,
    },
  };

  cache.set(key, resolved);
  return resolved;
}
