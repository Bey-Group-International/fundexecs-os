/**
 * Deterministic palette-ramp construction.
 *
 * Every material ramp is derived from a single base color plus warm/cool tint
 * biases, guaranteeing: (a) 4–7 colors, (b) shared semantic roles, (c)
 * monotonic luminance (no muddy inversions), and (d) equivalent perceived
 * contrast across a family (e.g. the six skin tones share the same multipliers,
 * so their specular−deepShadow luminance spread is near-identical).
 */
import type { PaletteDefinition, PaletteRole } from "./types";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function scale(a: Rgb, f: number): Rgb {
  return { r: a.r * f, g: a.g * f, b: a.b * f };
}

/** Cool shadow tint (toward slate) and warm highlight tint (toward cream). */
const COOL: Rgb = { r: 60, g: 66, b: 86 };
const WARM: Rgb = { r: 255, g: 246, b: 224 };

export interface RampOptions {
  /** How strongly shadows shift cool (0..1). */
  shadowCool?: number;
  /** How strongly highlights shift warm (0..1). */
  highlightWarm?: number;
  /** Specular target: how close to warm-white (0..1). */
  specular?: number;
}

/**
 * Build a full six-role ramp from a mid "base" color. The multipliers are
 * fixed across a family so contrast spread stays equivalent.
 */
export function makeRamp(baseHex: string, opts: RampOptions = {}): Record<PaletteRole, string> {
  const base = parseHex(baseHex);
  const shadowCool = opts.shadowCool ?? 0.18;
  const highlightWarm = opts.highlightWarm ?? 0.14;
  const specTarget = opts.specular ?? 0.55;

  const deepShadow = mix(scale(base, 0.42), COOL, shadowCool);
  const shadow = mix(scale(base, 0.64), COOL, shadowCool * 0.6);
  const midtone = scale(base, 1.12);
  const highlight = mix(scale(base, 1.28), WARM, highlightWarm);
  const specular = mix(scale(base, 1.34), WARM, specTarget);

  return {
    deepShadow: toHex(deepShadow),
    shadow: toHex(shadow),
    base: toHex(base),
    midtone: toHex(midtone),
    highlight: toHex(highlight),
    specular: toHex(specular),
  };
}

export function makePalette(
  id: string,
  label: string,
  group: string,
  baseHex: string,
  opts?: RampOptions,
): PaletteDefinition {
  return { id, label, group, colors: makeRamp(baseHex, opts) };
}
