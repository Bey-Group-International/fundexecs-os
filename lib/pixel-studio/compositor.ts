/**
 * Pixel compositor — the native runtime source of truth.
 *
 * Paints a 32×32 raster figure from a resolved character config using
 * deterministic procedural painters. Every write is at integer coordinates
 * with hard edges (no anti-aliasing, no vector paths, no interpolation). The
 * only scaling ever applied is Raster.scaleNearest for the 8× review image.
 *
 * The painters intentionally favour readable silhouettes and limited color
 * ramps (deepShadow → specular) over ornamental detail, matching the
 * "modernized 16-bit, institutional" art direction.
 */
import { AssetRegistry, type ResolvedLayer } from "./asset-registry";
import { ResolvedPalette, type Rgba } from "./palette-engine";
import { poseFor, type Pose } from "./pose";
import { Raster } from "./raster";
import {
  type AnimationState,
  type CharacterConfig,
  type Direction,
  type Manifest,
  type PaletteRole,
} from "./types";

const SIZE = 32;

/** Cache resolved palettes per manifest to avoid re-parsing colors each frame. */
class PaletteCache {
  private cache = new Map<string, ResolvedPalette>();
  constructor(private manifest: Manifest) {}
  get(id: string): ResolvedPalette {
    let p = this.cache.get(id);
    if (!p) {
      const def = this.manifest.palettes[id];
      if (!def) throw new Error(`Unknown palette: ${id}`);
      p = new ResolvedPalette(def);
      this.cache.set(id, p);
    }
    return p;
  }
}

export interface FrameContext {
  raster: Raster;
  dir: Direction;
  pose: Pose;
  frame: number;
  state: AnimationState;
}

// --- Geometry -------------------------------------------------------------
// A single shared body plan keeps every layer registered to the same origin.

interface BodyGeom {
  headX: number;
  headY: number;
  headW: number;
  headH: number;
  torsoX: number;
  torsoY: number;
  torsoW: number;
  torsoH: number;
  legY: number;
  footY: number;
  profile: boolean;
  back: boolean;
}

function geom(dir: Direction, pose: Pose): BodyGeom {
  const profile = dir === "left" || dir === "right";
  const back = dir === "up";
  const dy = pose.bodyDY;
  return {
    headX: profile ? 12 : 12,
    headY: 5 + dy + pose.headDY,
    headW: profile ? 8 : 8,
    headH: 9,
    torsoX: profile ? 12 : 10,
    torsoY: 15 + dy,
    torsoW: profile ? 8 : 12,
    torsoH: 9,
    legY: 24 + dy,
    footY: 29 + dy,
    profile,
    back,
  };
}

// --- Skin base ------------------------------------------------------------

function paintBody(ctx: FrameContext, skin: ResolvedPalette): void {
  const { raster: r, pose } = ctx;
  const g = geom(ctx.dir, pose);
  const base = skin.color("base");
  const mid = skin.color("midtone");
  const shadow = skin.color("shadow");
  const hi = skin.color("highlight");

  // Head — rounded block with a lit top-left and shaded lower-right.
  for (let y = g.headY; y < g.headY + g.headH; y++) {
    for (let x = g.headX; x < g.headX + g.headW; x++) {
      // Corner rounding.
      const cornerTL = x <= g.headX && y <= g.headY;
      const cornerTR = x >= g.headX + g.headW - 1 && y <= g.headY;
      if (cornerTL || cornerTR) continue;
      let c: Rgba = base;
      if (x <= g.headX + 1) c = mid;
      if (x >= g.headX + g.headW - 2) c = shadow;
      if (y <= g.headY + 1 && x > g.headX + 1 && x < g.headX + g.headW - 2) c = hi;
      r.set(x, y, c);
    }
  }
  // Ears (front/profile only, not back).
  if (!g.back) {
    if (!g.profile) {
      r.set(g.headX - 1, g.headY + 4, mid);
      r.set(g.headX - 1, g.headY + 5, shadow);
      r.set(g.headX + g.headW, g.headY + 4, mid);
      r.set(g.headX + g.headW, g.headY + 5, shadow);
    } else {
      const ex = ctx.dir === "right" ? g.headX - 1 : g.headX + g.headW;
      r.set(ex, g.headY + 4, mid);
      r.set(ex, g.headY + 5, shadow);
    }
  }

  // Neck.
  r.fillRect(14, g.headY + g.headH, 4, 2, mid);
  r.hline(14, g.headY + g.headH, 4, shadow);

  // Hands (visible below sleeves) with walk arm swing.
  const armSwing = pose.armPhase;
  if (!g.back) {
    r.fillRect(9, 22 + armSwing, 2, 2, mid);
    r.fillRect(21, 22 - armSwing, 2, 2, mid);
    r.set(9, 22 + armSwing, base);
    r.set(22, 22 - armSwing, base);
  }

  // Legs/feet skin is mostly covered by trousers; ankles peek out.
  const leg = pose.legPhase;
  r.fillRect(13, g.footY - 1, 2, 1, shadow);
  r.fillRect(17, g.footY - 1, 2, 1, shadow);
  // subtle motion so contact reads during walk
  if (leg !== 0) {
    r.set(13 + (leg > 0 ? -1 : 0), g.footY - 1, mid);
  }
}

// --- Painter dispatch -----------------------------------------------------

type Painter = (ctx: FrameContext, pal: ResolvedPalette, layer: ResolvedLayer, mat: number) => void;

function num(layer: ResolvedLayer, key: string, dflt = 0): number {
  const v = layer.asset.recipe.params[key];
  return typeof v === "number" ? v : dflt;
}
function str(layer: ResolvedLayer, key: string, dflt = ""): string {
  const v = layer.asset.recipe.params[key];
  return typeof v === "string" ? v : dflt;
}

const painters: Record<string, Painter> = {
  face: paintFace,
  expression: paintExpression,
  hair: paintHair,
  facialHair: paintFacialHair,
  headCovering: paintHeadCovering,
  outfit: paintOutfit,
  accessory: paintAccessory,
};

function paintFace(ctx: FrameContext, skin: ResolvedPalette, layer: ResolvedLayer): void {
  const { raster: r, pose } = ctx;
  const g = geom(ctx.dir, pose);
  if (g.back) return; // back of head shows no face structure
  const shadow = skin.color("shadow");
  const mid = skin.color("midtone");
  const width = num(layer, "width", 8);
  const jaw = num(layer, "jaw", 1); // 0 soft .. 2 strong
  const brow = num(layer, "brow", 1);

  // Cheek/jaw shading — vary silhouette by params.
  const jawY = g.headY + g.headH - 1;
  if (jaw >= 1) {
    r.set(g.headX + 1, jawY, shadow);
    r.set(g.headX + g.headW - 2, jawY, shadow);
  }
  if (jaw >= 2) {
    r.set(g.headX + 2, jawY, mid);
    r.set(g.headX + g.headW - 3, jawY, mid);
  }
  // Face width trim (narrow faces lose an edge column to skin-shadow).
  if (width <= 7 && !g.profile) {
    r.vline(g.headX, g.headY + 2, g.headH - 3, shadow);
  }
  // Brow ridge hint.
  if (brow >= 1 && !g.profile) {
    r.hline(g.headX + 2, g.headY + 3, g.headW - 4, shadow);
  }
}

function paintExpression(ctx: FrameContext, _pal: ResolvedPalette, layer: ResolvedLayer): void {
  const { raster: r, pose } = ctx;
  const g = geom(ctx.dir, pose);
  if (g.back) return;
  const kind = str(layer, "expression", "neutral");
  const ink: Rgba = { r: 28, g: 26, b: 34, a: 255 };
  const white: Rgba = { r: 240, g: 240, b: 245, a: 255 };

  const eyeY = g.headY + 4;
  const leftEyeX = g.profile ? (ctx.dir === "right" ? g.headX + 4 : g.headX + 2) : g.headX + 2;
  const rightEyeX = g.headX + g.headW - 3;

  // Eyes.
  if (pose.blink) {
    r.hline(leftEyeX, eyeY + 1, 1, ink);
    if (!g.profile) r.hline(rightEyeX, eyeY + 1, 1, ink);
  } else {
    r.set(leftEyeX, eyeY, white);
    r.set(leftEyeX, eyeY + 1, ink);
    if (!g.profile) {
      r.set(rightEyeX, eyeY, white);
      r.set(rightEyeX, eyeY + 1, ink);
    }
  }

  // Brows shift with expression.
  if (kind === "focused") {
    r.set(leftEyeX, eyeY - 1, ink);
    if (!g.profile) r.set(rightEyeX, eyeY - 1, ink);
  }

  // Mouth.
  const mouthY = g.headY + 7;
  const mouthX = g.profile ? (ctx.dir === "right" ? g.headX + 3 : g.headX + 2) : g.headX + 3;
  const open = kind === "talk" ? Math.max(1, pose.mouthOpen) : pose.mouthOpen;
  if (open >= 2) {
    r.fillRect(mouthX, mouthY, 2, 2, ink);
  } else if (open === 1) {
    r.hline(mouthX, mouthY, 2, ink);
  } else if (kind === "smile") {
    r.set(mouthX, mouthY + 1, ink);
    r.hline(mouthX + 1, mouthY, 2, ink);
  } else {
    r.hline(mouthX, mouthY, 2, ink);
  }
}

function paintHair(ctx: FrameContext, pal: ResolvedPalette, layer: ResolvedLayer): void {
  const { raster: r, pose } = ctx;
  const g = geom(ctx.dir, pose);
  const base = pal.color("base");
  const shadow = pal.color("shadow");
  const hi = pal.color("highlight");
  const coverage = num(layer, "coverage", 2); // 0 bald .. 3 full
  const length = num(layer, "length", 1); // extends below head
  const volume = num(layer, "volume", 0); // extra width
  const isFrontLayer = layer.slot === "hair.front";

  if (coverage === 0) return; // shaved styles paint nothing but stubble handled elsewhere

  if (layer.slot === "hair.back" || g.back) {
    // Back mass behind head.
    r.fillRect(g.headX - volume, g.headY - 1, g.headW + volume * 2, 3, base);
    if (length >= 2) r.fillRect(g.headX, g.headY + g.headH, g.headW, length, base);
    r.hline(g.headX, g.headY - 1, g.headW, hi);
    return;
  }

  if (isFrontLayer) {
    // Crown + fringe.
    r.fillRect(g.headX - volume, g.headY - 1, g.headW + volume * 2, 3, base);
    // top highlight
    r.hline(g.headX + 1, g.headY - 1, g.headW - 2, hi);
    // sides
    if (coverage >= 2) {
      r.vline(g.headX - volume, g.headY, 4, shadow);
      r.vline(g.headX + g.headW - 1 + volume, g.headY, 4, shadow);
    }
    // fringe over brow
    if (coverage >= 1) {
      r.hline(g.headX + 1, g.headY + 2, g.headW - 2, base);
      r.set(g.headX + 2, g.headY + 2, hi);
    }
    if (length >= 3) {
      // shoulder-length: drape sides down the neck
      r.vline(g.headX - 1, g.headY + 3, 6, base);
      r.vline(g.headX + g.headW, g.headY + 3, 6, base);
    }
  }
}

function paintFacialHair(ctx: FrameContext, pal: ResolvedPalette, layer: ResolvedLayer): void {
  const { raster: r, pose } = ctx;
  const g = geom(ctx.dir, pose);
  if (g.back) return;
  const base = pal.color("base");
  const shadow = pal.color("shadow");
  const style = str(layer, "style", "stubble");
  const density = num(layer, "density", 1);

  const jawY = g.headY + g.headH - 2;
  const lipY = g.headY + 6;

  if (style.includes("mustache")) {
    r.hline(g.headX + 3, lipY, 2, base);
    return;
  }
  if (style === "soul-patch") {
    r.set(g.headX + 3, g.headY + 8, base);
    return;
  }
  // Beards / stubble cover the jaw.
  const c = density >= 2 ? base : shadow;
  r.hline(g.headX + 1, jawY, g.headW - 2, c);
  r.hline(g.headX + 2, jawY + 1, g.headW - 4, c);
  if (style.includes("full") || style.includes("boxed")) {
    r.vline(g.headX + 1, g.headY + 5, 4, c);
    r.vline(g.headX + g.headW - 2, g.headY + 5, 4, c);
  }
}

function paintHeadCovering(ctx: FrameContext, pal: ResolvedPalette, layer: ResolvedLayer): void {
  const { raster: r, pose } = ctx;
  const g = geom(ctx.dir, pose);
  const base = pal.color("base");
  const shadow = pal.color("shadow");
  const hi = pal.color("highlight");
  const style = str(layer, "style", "cap");
  const drape = num(layer, "drape", 0);

  if (layer.slot === "headCovering.back") {
    if (drape >= 1) {
      r.fillRect(g.headX - 1, g.headY + 2, g.headW + 2, g.headH + 2, base);
      r.vline(g.headX - 1, g.headY + 2, g.headH + 2, shadow);
    }
    return;
  }

  // Front crown.
  const brimmed = style === "hat" || style === "cap";
  const crownH = brimmed ? 3 : 4;
  r.fillRect(g.headX - 1, g.headY - 2, g.headW + 2, crownH, base);
  r.hline(g.headX, g.headY - 2, g.headW, hi);
  if (brimmed) {
    r.hline(g.headX - 2, g.headY + 1, g.headW + 4, shadow); // brim
  }
  if (style === "hijab" || style === "headwrap" || style === "turban" || style === "dastar") {
    // Wrap the sides and under the chin band.
    r.vline(g.headX - 1, g.headY, g.headH, base);
    r.vline(g.headX + g.headW, g.headY, g.headH, base);
    if (style === "turban" || style === "dastar") {
      r.hline(g.headX, g.headY - 1, g.headW, shadow); // fold line
    }
    if (drape >= 1) {
      r.fillRect(g.headX - 1, g.headY + g.headH, g.headW + 2, 2, base);
    }
  }
}

function paintOutfit(ctx: FrameContext, pal: ResolvedPalette, layer: ResolvedLayer): void {
  const { raster: r, pose } = ctx;
  const g = geom(ctx.dir, pose);
  const base = pal.color("base");
  const mid = pal.color("midtone");
  const shadow = pal.color("shadow");
  const hi = pal.color("highlight");
  const spec = pal.color("specular");
  const part = str(layer, "part", "base");

  switch (part) {
    case "lower": {
      // Trousers / skirt.
      const skirt = num(layer, "skirt", 0);
      const leg = pose.legPhase;
      if (skirt >= 1) {
        r.fillRect(g.torsoX, g.legY, g.torsoW, 5, base);
        r.hline(g.torsoX, g.legY + 4, g.torsoW, shadow);
      } else {
        // two legs with walk swing
        r.fillRect(12, g.legY, 3, 5 + (leg < 0 ? 1 : 0), base);
        r.fillRect(16, g.legY, 3, 5 + (leg > 0 ? 1 : 0), base);
        r.vline(12, g.legY, 5, shadow);
        r.vline(18, g.legY, 5, shadow);
      }
      break;
    }
    case "shoes": {
      const c = shadow;
      r.fillRect(12, g.footY, 3, 2, c);
      r.fillRect(16, g.footY, 3, 2, c);
      r.hline(12, g.footY + 1, 3, base);
      r.hline(16, g.footY + 1, 3, base);
      break;
    }
    case "shirt": {
      r.fillRect(g.torsoX + 1, g.torsoY, g.torsoW - 2, 6, base);
      // collar V
      if (!g.back) {
        r.set(g.torsoX + Math.floor(g.torsoW / 2) - 1, g.torsoY, hi);
        r.set(g.torsoX + Math.floor(g.torsoW / 2), g.torsoY, hi);
      }
      break;
    }
    case "base":
    case "outer": {
      // Jacket / blazer body + sleeves.
      r.fillRect(g.torsoX, g.torsoY, g.torsoW, g.torsoH, base);
      // lit left, shaded right
      r.vline(g.torsoX, g.torsoY, g.torsoH, mid);
      r.vline(g.torsoX + g.torsoW - 1, g.torsoY, g.torsoH, shadow);
      r.hline(g.torsoX + 1, g.torsoY, g.torsoW - 2, hi);
      // sleeves with arm swing
      const sw = pose.armPhase;
      r.fillRect(g.torsoX - 2, g.torsoY + 1 + sw, 2, 6, mid);
      r.fillRect(g.torsoX + g.torsoW, g.torsoY + 1 - sw, 2, 6, mid);
      r.vline(g.torsoX - 2, g.torsoY + 1 + sw, 6, shadow);
      // lapels / opening
      if (part === "outer" && !g.back) {
        r.vline(g.torsoX + Math.floor(g.torsoW / 2), g.torsoY, g.torsoH - 1, shadow);
        r.set(g.torsoX + Math.floor(g.torsoW / 2) - 1, g.torsoY + 1, hi);
        r.set(g.torsoX + Math.floor(g.torsoW / 2) + 1, g.torsoY + 1, hi);
      }
      // reflective sheen hint for silk/tech fabrics
      if (num(layer, "sheen", 0) >= 1) {
        r.set(g.torsoX + 2, g.torsoY + 2, spec);
      }
      break;
    }
    case "neckwear": {
      if (g.back) break;
      const cx = g.torsoX + Math.floor(g.torsoW / 2);
      const style = str(layer, "neck", "tie");
      if (style === "tie") {
        r.set(cx, g.torsoY, base);
        r.vline(cx, g.torsoY + 1, 5, base);
        r.set(cx, g.torsoY + 5, shadow);
        r.set(cx, g.torsoY + 1, hi);
      } else if (style === "scarf") {
        r.hline(g.torsoX + 2, g.torsoY, g.torsoW - 4, base);
        r.set(cx, g.torsoY + 1, base);
      } else if (style === "bowtie") {
        r.hline(cx - 1, g.torsoY, 3, base);
      }
      break;
    }
    case "pocket": {
      if (g.back) break;
      r.set(g.torsoX + 1, g.torsoY + 3, pal.color("specular"));
      break;
    }
  }
}

function paintAccessory(ctx: FrameContext, pal: ResolvedPalette, layer: ResolvedLayer): void {
  const { raster: r, pose } = ctx;
  const g = geom(ctx.dir, pose);
  const base = pal.color("base");
  const shadow = pal.color("shadow");
  const hi = pal.color("highlight");
  const spec = pal.color("specular");
  const kind = str(layer, "acc", "glasses");
  const backLayer = layer.slot === "accessory.back";

  switch (kind) {
    case "glasses": {
      if (g.back) break;
      const eyeY = g.headY + 4;
      const shape = str(layer, "shape", "rect");
      r.hline(g.headX + 1, eyeY, g.headW - 2, base);
      r.set(g.headX + 1, eyeY, shadow);
      r.set(g.headX + g.headW - 2, eyeY, shadow);
      if (shape === "round") {
        r.set(g.headX + 2, eyeY - 1, base);
        r.set(g.headX + g.headW - 3, eyeY - 1, base);
      }
      r.set(g.headX + Math.floor(g.headW / 2), eyeY, hi); // bridge
      break;
    }
    case "badge":
    case "lanyard": {
      const cy = g.torsoY + 4;
      if (kind === "lanyard") {
        r.set(g.torsoX + 4, g.torsoY, shadow);
        r.set(g.torsoX + Math.floor(g.torsoW / 2), g.torsoY, shadow);
      }
      r.fillRect(g.torsoX + 3, cy, 3, 3, base);
      r.set(g.torsoX + 4, cy + 1, hi);
      break;
    }
    case "pin": {
      r.set(g.torsoX + 2, g.torsoY + 2, spec);
      break;
    }
    case "pocket-square": {
      r.set(g.torsoX + 1, g.torsoY + 3, hi);
      r.set(g.torsoX + 2, g.torsoY + 3, base);
      break;
    }
    case "watch":
    case "smartwatch": {
      const wy = 23 - pose.armPhase;
      r.set(21, wy, kind === "smartwatch" ? spec : base);
      break;
    }
    case "tablet":
    case "clipboard":
    case "phone":
    case "portfolio": {
      // Handheld in front of torso (or behind in up view).
      const hy = g.torsoY + 4;
      const w = kind === "phone" ? 2 : 4;
      const hx = g.torsoX + Math.floor((g.torsoW - w) / 2);
      if (g.back && !backLayer) break;
      r.fillRect(hx, hy, w, kind === "phone" ? 3 : 5, base);
      r.hline(hx, hy, w, hi);
      if (kind === "tablet" || kind === "phone") r.set(hx + 1, hy + 1, spec); // screen glint
      break;
    }
    case "pen": {
      r.vline(21, 21, 3, spec);
      break;
    }
    case "briefcase": {
      // Behind in one direction, in front in another (data-driven layering).
      const by = 22;
      const bx = ctx.dir === "left" ? 7 : 23;
      r.fillRect(bx, by, 3, 4, base);
      r.hline(bx, by, 3, hi);
      r.set(bx + 1, by - 1, shadow); // handle
      break;
    }
    case "earpiece":
    case "headset": {
      if (g.back && kind === "earpiece") break;
      const ex = ctx.dir === "left" ? g.headX : g.headX + g.headW - 1;
      r.set(ex, g.headY + 4, spec);
      if (kind === "headset") {
        r.hline(g.headX, g.headY - 2, g.headW, base); // band
        r.set(g.headX + 1, g.headY + 5, base); // mic boom
      }
      break;
    }
  }
}

// --- Public API -----------------------------------------------------------

/** Options to render only a slice of the stack (used by the WA layer adapter). */
export interface ComposeOptions {
  includeShadow?: boolean;
  includeSkin?: boolean;
  layerFilter?: (layer: ResolvedLayer) => boolean;
}

/** Color raster + a parallel per-pixel material-index map (for PBR preview). */
export interface MaterialFrame {
  color: Raster;
  /** material index per pixel (0 = none); map via materialIndex(). */
  material: Uint8Array;
}

export interface Composer {
  composeFrame(
    config: CharacterConfig,
    state: AnimationState,
    dir: Direction,
    frame: number,
    opts?: ComposeOptions,
  ): Raster;
  composeStateSheet(config: CharacterConfig, state: AnimationState, opts?: ComposeOptions): Raster;
  /** Compose one frame while recording which material painted each pixel. */
  composeFrameWithMaterials(
    config: CharacterConfig,
    state: AnimationState,
    dir: Direction,
    frame: number,
  ): MaterialFrame;
  /** material id → 1-based index used in the material map. */
  materialIndex(id: string): number;
}

export function createComposer(registry: AssetRegistry): Composer {
  const manifest = registry.manifest;
  const palettes = new PaletteCache(manifest);

  function composeFrame(
    config: CharacterConfig,
    state: AnimationState,
    dir: Direction,
    frame: number,
    opts: ComposeOptions = {},
  ): Raster {
    const { includeShadow = true, includeSkin = true, layerFilter } = opts;
    const r = new Raster(SIZE, SIZE);
    const pose = poseFor(state, dir, frame);
    const ctx: FrameContext = { raster: r, dir, pose, frame, state };

    if (includeShadow) {
      // Ground shadow (own layer; sits under everything).
      const gShadow: Rgba = { r: 0, g: 0, b: 0, a: 70 };
      r.fillRect(11, 30, 10, 2, gShadow);
      r.fillRect(13, 31, 6, 1, { r: 0, g: 0, b: 0, a: 40 });
    }

    const skin = palettes.get(config.skinPalette);
    if (includeSkin) paintBody(ctx, skin);

    const layers = registry.resolveLayers(config);
    for (const layer of layers) {
      if (layerFilter && !layerFilter(layer)) continue;
      const painter = painters[layer.asset.recipe.kind];
      if (!painter) continue;
      const pal = layer.asset.paletteGroup === "skin" ? skin : palettes.get(layer.paletteId);
      painter(ctx, pal, layer, 0);
    }

    return r;
  }

  function composeStateSheet(
    config: CharacterConfig,
    state: AnimationState,
    opts?: ComposeOptions,
  ): Raster {
    const def = manifest.animations[state];
    const sheet = new Raster(def.width, def.height);
    const dirs = manifest.frame.directions;
    dirs.forEach((dir, row) => {
      for (let col = 0; col < def.framesPerDirection; col++) {
        const frame = composeFrame(config, state, dir, col, opts);
        sheet.composite(frame, col * SIZE, row * SIZE);
      }
    });
    return sheet;
  }

  // Material index table (1-based; 0 = no material / transparent).
  const matIds = Object.keys(manifest.materials);
  const matIndexMap = new Map<string, number>();
  matIds.forEach((id, i) => matIndexMap.set(id, i + 1));
  const materialIndex = (id: string) => matIndexMap.get(id) ?? 0;

  function composeFrameWithMaterials(
    config: CharacterConfig,
    state: AnimationState,
    dir: Direction,
    frame: number,
  ): MaterialFrame {
    const r = new Raster(SIZE, SIZE);
    const material = new Uint8Array(SIZE * SIZE);
    const pose = poseFor(state, dir, frame);
    const ctx: FrameContext = { raster: r, dir, pose, frame, state };
    const skin = palettes.get(config.skinPalette);

    // Snapshot alpha, paint a layer, then tag newly-written pixels.
    const tag = (matId: string) => {
      const idx = materialIndex(matId);
      for (let i = 0; i < material.length; i++) {
        if (material[i] === 0 && r.data[i * 4 + 3] !== 0) material[i] = idx;
      }
      // Re-tag pixels this layer overwrote too (top material wins visually).
      // Handled by painting order: later layers overwrite, so re-scan opaque.
    };

    paintBody(ctx, skin);
    tag("skin");

    for (const layer of registry.resolveLayers(config)) {
      const painter = painters[layer.asset.recipe.kind];
      if (!painter) continue;
      const before = new Uint8Array(SIZE * SIZE);
      for (let i = 0; i < before.length; i++) before[i] = r.data[i * 4 + 3];
      const pal = layer.asset.paletteGroup === "skin" ? skin : palettes.get(layer.paletteId);
      painter(ctx, pal, layer, 0);
      const idx = materialIndex(layer.materialId);
      for (let i = 0; i < material.length; i++) {
        // Pixel became opaque OR changed under this layer → belongs to it.
        if (r.data[i * 4 + 3] !== 0 && r.data[i * 4 + 3] !== before[i]) material[i] = idx;
      }
    }
    return { color: r, material };
  }

  return { composeFrame, composeStateSheet, composeFrameWithMaterials, materialIndex };
}

/** Horizontal mirror of a 32×32 frame (for the left profile). */
export function mirror(src: Raster): Raster {
  const out = new Raster(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) out.set(src.width - 1 - x, y, src.get(x, y));
  }
  return out;
}

/** Named palette-role helper for tests. */
export function roleColor(pal: ResolvedPalette, role: PaletteRole): Rgba {
  return pal.color(role);
}
