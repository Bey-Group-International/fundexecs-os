/**
 * Palette engine — resolves semantic palette roles to concrete RGBA and
 * performs palette swaps for the pixel compositor.
 *
 * A "ramp" is the ordered set of colors a material uses (deepShadow → specular).
 * The compositor paints using role names; this module converts a role to the
 * active palette's color. Swapping a palette therefore recolors every pixel
 * that referenced a role, with zero per-asset color duplication.
 */
import { PALETTE_ROLES, type PaletteDefinition, type PaletteRole } from "./types";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGBA = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/** Parse an exact hex or rgba() string to RGBA. Throws on invalid input. */
export function parseColor(value: string): Rgba {
  const v = value.trim();
  let m: RegExpExecArray | null;
  if ((m = HEX8.exec(v))) {
    return { r: hx(m[1]), g: hx(m[2]), b: hx(m[3]), a: hx(m[4]) };
  }
  if ((m = HEX6.exec(v))) {
    return { r: hx(m[1]), g: hx(m[2]), b: hx(m[3]), a: 255 };
  }
  if ((m = HEX3.exec(v))) {
    return { r: hx(m[1] + m[1]), g: hx(m[2] + m[2]), b: hx(m[3] + m[3]), a: 255 };
  }
  if ((m = RGBA.exec(v))) {
    const a = m[4] === undefined ? 255 : Math.round(clamp01(Number(m[4])) * 255);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  throw new Error(`Invalid color value: ${value}`);
}

function hx(s: string): number {
  return parseInt(s, 16);
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function rgbaToCss(c: Rgba): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a / 255).toFixed(3)})`;
}

export function rgbaToHex(c: Rgba): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a === 255 ? "" : h(c.a)}`;
}

/** Relative luminance (perceptual, sRGB-weighted) in 0..255. */
export function luminance(c: Rgba): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * A resolved palette: role → RGBA, precomputed once for a compositing pass.
 */
export class ResolvedPalette {
  readonly id: string;
  private readonly map: Record<PaletteRole, Rgba>;

  constructor(def: PaletteDefinition) {
    this.id = def.id;
    const map = {} as Record<PaletteRole, Rgba>;
    for (const role of PALETTE_ROLES) {
      const raw = def.colors[role];
      if (!raw) throw new Error(`Palette ${def.id} missing role "${role}"`);
      map[role] = parseColor(raw);
    }
    this.map = map;
  }

  color(role: PaletteRole): Rgba {
    return this.map[role];
  }

  /** Ordered ramp deepShadow → specular. */
  ramp(): Rgba[] {
    return PALETTE_ROLES.map((r) => this.map[r]);
  }
}

/**
 * Validate that a palette maintains equivalent perceived contrast to a
 * reference (used to keep the six skin tones consistent). Returns the spread
 * (specular luminance − deepShadow luminance); callers assert it is within
 * tolerance of the reference spread.
 */
export function paletteContrastSpread(def: PaletteDefinition): number {
  const p = new ResolvedPalette(def);
  return luminance(p.color("specular")) - luminance(p.color("deepShadow"));
}

/** Assert a palette's ramp is monotonically non-decreasing in luminance. */
export function isMonotonicRamp(def: PaletteDefinition): boolean {
  const p = new ResolvedPalette(def);
  const lums = p.ramp().map(luminance);
  for (let i = 1; i < lums.length; i++) {
    // Allow tiny equal steps but never an inversion.
    if (lums[i] < lums[i - 1] - 0.5) return false;
  }
  return true;
}
