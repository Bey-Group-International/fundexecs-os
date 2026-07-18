/**
 * Map compositor — paints a map asset (tile or multi-tile object) into a Raster
 * at native 32px tile resolution. Same DOM-free approach as the character
 * compositor: hard-edged pixels, integer coordinates, nearest-neighbor only.
 */
import { parseColor, type Rgba } from "../palette-engine";
import { Raster } from "../raster";
import { mapAsset, type MapAssetDef } from "./map-assets";

const T = 32;

interface Branding {
  primaryColor: string;
  secondaryColor: string;
}

function shade(hex: string, f: number): Rgba {
  const c = parseColor(hex);
  return { r: Math.round(c.r * f), g: Math.round(c.g * f), b: Math.round(c.b * f), a: 255 };
}

const PALETTES: Record<string, [string, string, string]> = {
  carpet: ["#3c4657", "#333c4b", "#48536680"],
  wood: ["#8a5a34", "#6f472a", "#a06a3f"],
  marble: ["#cfd2da", "#b9bcc6", "#e6e8ee"],
  concrete: ["#8f9299", "#7c7f86", "#a3a6ad"],
  grass: ["#4a7a3a", "#3d6730", "#5c8f47"],
  paving: ["#9a9ba0", "#86878c", "#adaeb3"],
};

export function renderMapAsset(def: MapAssetDef, branding: Branding, variant = 0): Raster {
  const w = def.size.w * T;
  const h = def.size.h * T;
  const r = new Raster(w, h);
  const kind = def.recipe.kind;
  const p = def.recipe.params;

  const primary = parseColor(branding.primaryColor);
  const secondary = parseColor(branding.secondaryColor);

  switch (kind) {
    case "floor": {
      const tone = String(p.tone ?? "carpet");
      const [base, dark, light] = PALETTES[tone] ?? PALETTES.carpet;
      r.fillRect(0, 0, w, h, parseColor(base));
      // Subtle tile seam + speckle for texture (deterministic by variant).
      r.hline(0, 0, w, parseColor(dark));
      r.vline(0, 0, h, parseColor(dark));
      for (let i = 0; i < 6; i++) {
        const x = (i * 7 + variant * 3) % w;
        const y = (i * 11 + variant * 5) % h;
        r.set(x, y, parseColor(light));
      }
      break;
    }
    case "wall": {
      const style = String(p.style ?? "solid");
      if (style === "glass" || style === "window") {
        r.fillRect(0, 0, w, h, { r: 150, g: 180, b: 200, a: 120 });
        r.fillRect(2, 2, w - 4, h - 4, { r: 190, g: 215, b: 230, a: 150 });
        r.set(4, 4, { r: 255, g: 255, b: 255, a: 200 });
      } else {
        r.fillRect(0, 0, w, h, shade("#b7b2a8", 1));
        r.hline(0, h - 3, w, shade("#b7b2a8", 0.7));
        r.hline(0, 0, w, shade("#b7b2a8", 1.15));
      }
      break;
    }
    case "desk": {
      const top = shade("#7a4f2d", 1.1);
      const side = shade("#5c3b21", 1);
      r.fillRect(1, 4, w - 2, h - 6, top);
      r.hline(1, 4, w - 2, shade("#7a4f2d", 1.3));
      r.fillRect(1, h - 4, w - 2, 3, side);
      break;
    }
    case "chair": {
      const c = shade("#2c333d", 1);
      r.fillRect(9, 8, 14, 14, c);
      r.fillRect(9, 6, 14, 4, shade("#2c333d", 1.2));
      r.hline(9, 8, 14, shade("#2c333d", 1.4));
      break;
    }
    case "table": {
      const shape = String(p.shape ?? "round");
      const top = shade("#8a5a34", 1.1);
      if (shape === "round") {
        const cx = w / 2;
        const cy = h / 2;
        const rad = Math.min(w, h) / 2 - 3;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const d = Math.hypot(x - cx, y - cy);
            if (d < rad) r.set(x, y, top);
            if (Math.abs(d - rad) < 1.2) r.set(x, y, shade("#8a5a34", 0.8));
          }
      } else {
        r.fillRect(3, 4, w - 6, h - 8, top);
        r.hline(3, 4, w - 6, shade("#8a5a34", 1.3));
        r.fillRect(3, h - 5, w - 6, 3, shade("#8a5a34", 0.8));
      }
      break;
    }
    case "sofa": {
      r.fillRect(1, 6, w - 2, h - 8, shade("#465063", 1));
      r.fillRect(1, 4, w - 2, 5, shade("#465063", 1.2));
      r.fillRect(0, 6, 3, h - 8, shade("#465063", 0.8));
      r.fillRect(w - 3, 6, 3, h - 8, shade("#465063", 0.8));
      break;
    }
    case "shelf": {
      r.fillRect(2, 1, w - 4, h - 2, shade("#6f472a", 1));
      for (let y = 6; y < h - 2; y += 8) r.hline(3, y, w - 6, shade("#6f472a", 0.7));
      // books
      for (let x = 4; x < w - 4; x += 3) r.vline(x, 3, 4, x % 2 ? primary : secondary);
      break;
    }
    case "device": {
      const dk = String(p.kind ?? "monitor");
      if (dk === "server") {
        r.fillRect(6, 2, 20, 28, shade("#3a3f47", 1));
        for (let y = 5; y < 28; y += 4) {
          r.hline(8, y, 16, { r: 40, g: 220, b: 160, a: 255 });
        }
      } else if (dk === "laptop") {
        r.fillRect(7, 14, 18, 10, shade("#2c2f36", 1));
        r.fillRect(9, 6, 14, 9, shade("#20232a", 1));
        r.fillRect(10, 7, 12, 7, { r: 90, g: 170, b: 210, a: 255 });
      } else {
        r.fillRect(6, 6, 20, 13, shade("#20232a", 1));
        r.fillRect(8, 8, 16, 9, { r: 90, g: 170, b: 210, a: 255 });
        r.fillRect(14, 19, 4, 5, shade("#20232a", 1));
        r.hline(11, 24, 10, shade("#20232a", 0.8));
      }
      break;
    }
    case "screen": {
      r.fillRect(1, 2, w - 2, h - 6, shade("#181b22", 1));
      r.fillRect(3, 4, w - 6, h - 10, { r: primary.r, g: primary.g, b: primary.b, a: 255 });
      r.set(5, 6, { r: 255, g: 255, b: 255, a: 200 });
      break;
    }
    case "sign": {
      const isLogo = String(p.kind) === "logo";
      r.fillRect(1, 6, w - 2, h - 12, isLogo ? primary : shade("#2c2f36", 1));
      r.fillRect(3, 8, 6, 6, secondary);
      r.hline(11, 10, w - 14, { r: 240, g: 240, b: 245, a: 255 });
      r.hline(11, 13, w - 16, { r: 200, g: 200, b: 210, a: 255 });
      break;
    }
    case "plant": {
      const cx = w / 2;
      const green = p.tree ? shade("#2f5a2f", 1) : shade("#3c7a3c", 1);
      const potY = h - 6;
      for (let y = 0; y < potY; y++) {
        const spread = p.tree ? (y / potY) * (w / 2 - 2) : Math.min(8, (potY - y));
        r.hline(Math.round(cx - spread), y + 2, Math.round(spread * 2), green);
      }
      r.fillRect(Math.round(cx) - 4, potY, 8, 6, shade("#8a5a34", 1));
      break;
    }
    case "rug": {
      r.fillRect(2, 2, w - 4, h - 4, { r: secondary.r, g: secondary.g, b: secondary.b, a: 200 });
      r.fillRect(5, 5, w - 10, h - 10, { r: primary.r, g: primary.g, b: primary.b, a: 200 });
      break;
    }
    case "art": {
      r.fillRect(6, 6, 20, 20, shade("#c9a84c", 1));
      r.fillRect(8, 8, 16, 16, secondary);
      r.fillRect(11, 11, 10, 10, primary);
      break;
    }
    case "door": {
      r.fillRect(4, 2, w - 8, h - 2, shade("#6f472a", 1));
      r.vline(w - 8, h / 2 - 2, 4, shade("#c9a84c", 1)); // handle
      break;
    }
    case "marker": {
      const tone = String(p.tone ?? "spawn");
      const colors: Record<string, Rgba> = {
        spawn: { r: 80, g: 200, b: 120, a: 120 },
        exit: { r: 220, g: 90, b: 90, a: 120 },
        meeting: { r: 90, g: 150, b: 230, a: 90 },
        silent: { r: 160, g: 120, b: 220, a: 90 },
      };
      const c = colors[tone] ?? colors.spawn;
      r.fillRect(0, 0, w, h, c);
      // dashed border
      for (let x = 0; x < w; x += 4) {
        r.set(x, 0, { ...c, a: 220 });
        r.set(x, h - 1, { ...c, a: 220 });
      }
      for (let y = 0; y < h; y += 4) {
        r.set(0, y, { ...c, a: 220 });
        r.set(w - 1, y, { ...c, a: 220 });
      }
      break;
    }
    default:
      r.fillRect(2, 2, w - 4, h - 4, { r: 200, g: 60, b: 200, a: 200 }); // missing-art marker
  }
  return r;
}

export function renderMapAssetById(id: string, branding: Branding, variant = 0): Raster | null {
  const def = mapAsset(id);
  return def ? renderMapAsset(def, branding, variant) : null;
}

// Layer paint order for previews (metadata layers rendered translucently last).
const PREVIEW_ORDER = [
  "exterior", "ground", "floor", "walls", "furniture", "technology",
  "signage", "screens", "decor", "interactions", "spawns", "entrances", "exits", "overhead",
] as const;

interface MapProjectLike {
  width: number;
  height: number;
  branding: { primaryColor: string; secondaryColor: string };
  layers: { id: string; visible: boolean; placements: { assetId: string; x: number; y: number }[] }[];
}

/** Composite an entire map project into a single native raster (32px tiles). */
export function renderMapPreview(project: MapProjectLike, showZones = true): Raster {
  const out = new Raster(project.width * T, project.height * T);
  // neutral backdrop
  out.fillRect(0, 0, out.width, out.height, { r: 24, g: 27, b: 34, a: 255 });
  for (const layerId of PREVIEW_ORDER) {
    const layer = project.layers.find((l) => l.id === layerId);
    if (!layer || !layer.visible) continue;
    const isZone = ["interactions", "spawns", "entrances", "exits"].includes(layerId);
    if (isZone && !showZones) continue;
    let variant = 0;
    for (const pl of layer.placements) {
      if (pl.assetId === "__collision") continue;
      const def = mapAsset(pl.assetId);
      if (!def) continue;
      const tile = renderMapAsset(def, project.branding, variant++);
      out.composite(tile, pl.x * T, pl.y * T);
    }
  }
  return out;
}

/** Render the tileset atlas PNG (16 columns) referenced by the Tiled export. */
export function renderTilesetAtlas(assets: MapAssetDef[], branding: Branding): Raster {
  const cols = 16;
  const rows = Math.ceil((assets.length + 1) / cols);
  const atlas = new Raster(cols * T, rows * T);
  assets.forEach((def, i) => {
    const tile = renderMapAsset(def, branding, 0).crop(0, 0, T, T); // first-tile representative
    atlas.composite(tile, (i % cols) * T, Math.floor(i / cols) * T);
  });
  return atlas;
}
