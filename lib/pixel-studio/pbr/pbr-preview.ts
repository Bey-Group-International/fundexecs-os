/**
 * PBR Showcase — a material-aware raster lighting pipeline.
 *
 * This is a real per-pixel shader evaluated in software (an "equivalent shader
 * layer" per the brief; a WebGL2 port can drop in behind the same interface).
 * It consumes the native color frame plus the per-pixel material map, generates
 * deterministic normal/height/roughness/metallic masks from the raster and each
 * material's metadata, and evaluates a Blinn-Phong + metallic response with a
 * directional key light and a fill/ambient term.
 *
 * Crucially it returns a NEW raster — it never mutates the native pixel asset,
 * so runtime exports are unaffected. `bakeToPalette` performs the controlled
 * quantization back to hard-edged palette pixels.
 */
import type { MaterialFrame } from "../compositor";
import { luminance, parseColor, type Rgba } from "../palette-engine";
import { Raster } from "../raster";
import type { MaterialDefinition } from "../types";

export interface LightRig {
  /** Key light direction (will be normalized). Default upper-left, toward viewer. */
  keyDir: { x: number; y: number; z: number };
  keyIntensity: number;
  fillIntensity: number;
  ambient: number;
}

export const DEFAULT_LIGHT: LightRig = {
  keyDir: { x: -0.5, y: -0.7, z: 0.8 },
  keyIntensity: 1.1,
  fillIntensity: 0.35,
  ambient: 0.25,
};

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Build a height field: material relief modulated by local brightness, plus a
 * gentle silhouette bulge so figures read as rounded volumes. */
function heightField(frame: MaterialFrame, materials: MaterialDefinition[]): Float32Array {
  const { color, material } = frame;
  const w = color.width;
  const h = color.height;
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (color.data[i * 4 + 3] === 0) continue;
      const mi = material[i];
      const mat = mi > 0 ? materials[mi - 1] : undefined;
      const relief = mat?.relief ?? 0.4;
      const lum = luminance({ r: color.data[i * 4], g: color.data[i * 4 + 1], b: color.data[i * 4 + 2], a: 255 }) / 255;
      // brighter pixels sit slightly higher; scaled by material relief
      height[i] = 0.5 + (lum - 0.5) * relief;
    }
  }
  return height;
}

/** Sobel-derived surface normal from the height field. */
function normalAt(height: Float32Array, w: number, h: number, x: number, y: number, strength: number): Vec3 {
  const at = (xx: number, yy: number) => {
    const cx = Math.max(0, Math.min(w - 1, xx));
    const cy = Math.max(0, Math.min(h - 1, yy));
    return height[cy * w + cx];
  };
  const dx = at(x + 1, y) - at(x - 1, y);
  const dy = at(x, y + 1) - at(x, y - 1);
  return norm({ x: -dx * strength * 4, y: -dy * strength * 4, z: 1 });
}

/** Render the PBR showcase frame. */
export function renderPbr(
  frame: MaterialFrame,
  materials: MaterialDefinition[],
  light: LightRig = DEFAULT_LIGHT,
): Raster {
  const { color, material } = frame;
  const w = color.width;
  const h = color.height;
  const out = new Raster(w, h);
  const height = heightField(frame, materials);
  const L = norm(light.keyDir);
  const V: Vec3 = { x: 0, y: 0, z: 1 };
  const H = norm({ x: L.x + V.x, y: L.y + V.y, z: L.z + V.z });

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = color.data[i * 4 + 3];
      if (a === 0) continue;
      const base: Rgba = { r: color.data[i * 4], g: color.data[i * 4 + 1], b: color.data[i * 4 + 2], a };
      const mi = material[i];
      const mat = mi > 0 ? materials[mi - 1] : undefined;
      const roughness = mat?.roughness ?? 0.6;
      const metallic = mat?.metallic ?? 0;
      const ao = mat?.ao ?? 0.4;
      const specularK = mat?.specular ?? 0.4;
      const emissive = mat?.emissive ?? 0;

      const N = normalAt(height, w, h, x, y, mat?.relief ?? 0.4);
      const NdotL = Math.max(0, dot(N, L));
      const NdotH = Math.max(0, dot(N, H));

      // Diffuse: ambient (with AO) + key + fill.
      const diffuse = light.ambient * (1 - ao * 0.5) + light.keyIntensity * NdotL + light.fillIntensity * (0.5 + N.z * 0.5);

      // Specular lobe sharpened by inverse roughness.
      const shininess = 2 + (1 - roughness) * 120;
      const specAmt = specularK * Math.pow(NdotH, shininess) * light.keyIntensity;

      // Metals tint specular by base color and darken diffuse.
      const diffTint = 1 - metallic * 0.75;
      const specColor: Rgba = metallic
        ? { r: base.r, g: base.g, b: base.b, a: 255 }
        : { r: 255, g: 255, b: 255, a: 255 };

      let r = base.r * diffuse * diffTint + specColor.r * specAmt + base.r * emissive;
      let g = base.g * diffuse * diffTint + specColor.g * specAmt + base.g * emissive;
      let b = base.b * diffuse * diffTint + specColor.b * specAmt + base.b * emissive;

      out.set(x, y, {
        r: Math.max(0, Math.min(255, Math.round(r))),
        g: Math.max(0, Math.min(255, Math.round(g))),
        b: Math.max(0, Math.min(255, Math.round(b))),
        a,
      });
    }
  }
  return out;
}

/**
 * Pixel bake — quantize a PBR-lit frame to a fixed palette with HARD
 * transitions and no filtered downsampling. Highlights are naturally restricted
 * to the few brightest palette entries, keeping specular within a pixel or two.
 */
export function bakeToPalette(shaded: Raster, paletteHexes: string[]): Raster {
  const palette = paletteHexes.map(parseColor);
  const out = new Raster(shaded.width, shaded.height);
  for (let y = 0; y < shaded.height; y++) {
    for (let x = 0; x < shaded.width; x++) {
      const c = shaded.get(x, y);
      if (c.a === 0) continue;
      let best = palette[0];
      let bestD = Infinity;
      for (const p of palette) {
        const d = (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      out.set(x, y, { r: best.r, g: best.g, b: best.b, a: 255 });
    }
  }
  return out;
}
