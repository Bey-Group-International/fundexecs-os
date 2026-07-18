/**
 * Manifest builder — constructs the complete, inventory-complete manifest in
 * code so the exact required counts are enforced at the source (and re-checked
 * by the validators). Pure and node-safe: no DOM, no fs. The build script
 * writes the JSON; tests import the object directly.
 *
 * Required inventory (see brief §6 / §20):
 *   6 skin palettes · 12 faces · 24 hairstyles · 12 facial-hair · 12 head
 *   coverings · 10 hair colors · 13 outfit systems · 17 accessories ·
 *   4 expressions · 8 example executives.
 */
import { makePalette } from "./ramp";
import {
  ANIMATION_STATES,
  DIRECTIONS,
  LAYER_ORDER,
  WORKADVENTURE_CATEGORIES,
  type AnimationState,
  type AssetDefinition,
  type CharacterConfig,
  type Direction,
  type FitGroup,
  type LayerSlot,
  type Manifest,
  type MaterialDefinition,
  type OutfitSystem,
  type PaletteDefinition,
  type WorkAdventureCategory,
} from "./types";

const ALL_DIRS = [...DIRECTIONS] as Direction[];
const ALL_STATES = [...ANIMATION_STATES] as AnimationState[];

/** Stable 8-hex content hash (djb2) for asset versioning / cache-busting. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (Math.imul(h, 33) ^ input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function withVersion(a: Omit<AssetDefinition, "assetVersion">): AssetDefinition {
  const version = hash(JSON.stringify(a));
  return { ...a, assetVersion: version };
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

function buildPalettes(): Record<string, PaletteDefinition> {
  const list: PaletteDefinition[] = [];

  // 6 institutional olive-influenced skin tones, light → deep. Same ramp
  // multipliers → equivalent perceived contrast.
  const skinBases: [string, string][] = [
    ["skin-olive-01-light", "#e7cba1"],
    ["skin-olive-02", "#d6b287"],
    ["skin-olive-03", "#bf9968"],
    ["skin-olive-04", "#a17b4d"],
    ["skin-olive-05", "#7e5c37"],
    ["skin-olive-06-deep", "#5c3f25"],
  ];
  for (const [id, base] of skinBases) {
    list.push(makePalette(id, id.replace(/skin-|-/g, " ").trim(), "skin", base, { shadowCool: 0.16, highlightWarm: 0.12, specular: 0.4 }));
  }

  // 10 hair colors.
  const hairBases: [string, string][] = [
    ["hair-soft-black", "#2b2b30"],
    ["hair-blue-black", "#23252e"],
    ["hair-espresso", "#3b2a20"],
    ["hair-dark-brown", "#4b3423"],
    ["hair-chestnut", "#6b4326"],
    ["hair-auburn", "#7a3b22"],
    ["hair-warm-blond", "#b98a4e"],
    ["hair-ash-blond", "#c7b189"],
    ["hair-salt-pepper", "#8a8a8f"],
    ["hair-white", "#dcdce2"],
  ];
  for (const [id, base] of hairBases) {
    list.push(makePalette(id, id.replace(/hair-|-/g, " ").trim(), "hair", base, { shadowCool: 0.22 }));
  }

  // Fabric / material palettes referenced by outfit colorways.
  const fabricBases: [string, string, string][] = [
    ["fabric-navy", "navy wool", "#2a3a5c"],
    ["fabric-charcoal", "charcoal wool", "#33363d"],
    ["fabric-graphite", "graphite", "#4a4e57"],
    ["fabric-black", "black formal", "#26272b"],
    ["fabric-olive", "olive", "#4a4d34"],
    ["fabric-burgundy", "burgundy", "#5a2733"],
    ["fabric-tan", "tan", "#a9906a"],
    ["fabric-taupe", "taupe", "#7a6f5f"],
    ["fabric-forest", "forest", "#2f4436"],
    ["fabric-slate", "slate", "#45505f"],
    ["fabric-cream", "cream", "#cfc4a8"],
  ];
  for (const [id, label, base] of fabricBases) list.push(makePalette(id, label, id, base));

  // Shirts / blouses.
  const shirtBases: [string, string, string][] = [
    ["shirt-white", "white shirt", "#e8e8ee"],
    ["shirt-blue", "blue shirt", "#b9c6dd"],
    ["shirt-gray", "gray shirt", "#c2c4cb"],
    ["shirt-rose", "rose blouse", "#d9b8b0"],
  ];
  for (const [id, label, base] of shirtBases) list.push(makePalette(id, label, id, base, { highlightWarm: 0.05 }));

  // Neckwear (silk sheen → higher specular).
  const tieBases: [string, string, string][] = [
    ["tie-navy", "navy silk", "#20304f"],
    ["tie-burgundy", "burgundy silk", "#5a2029"],
    ["tie-gold", "gold silk", "#b9992f"],
    ["tie-forest", "forest silk", "#223a2c"],
  ];
  for (const [id, label, base] of tieBases) list.push(makePalette(id, label, id, base, { specular: 0.7 }));

  // Leather (shoes).
  list.push(makePalette("leather-black", "black leather", "leather-black", "#241c18", { specular: 0.35 }));
  list.push(makePalette("leather-brown", "brown leather", "leather-brown", "#3a2a1e", { specular: 0.35 }));

  // Accessory metals / plastics / glass.
  list.push(makePalette("metal-steel", "brushed steel", "metal-steel", "#7c828c", { specular: 0.85 }));
  list.push(makePalette("metal-gold", "polished gold", "metal-gold", "#b9922f", { specular: 0.9 }));
  list.push(makePalette("plastic-dark", "dark plastic", "plastic-dark", "#2c2f36"));
  list.push(makePalette("glass-clear", "clear glass", "glass-clear", "#aebfca", { specular: 0.9 }));
  list.push(makePalette("screen-cyan", "display screen", "screen-cyan", "#2f6f8f", { specular: 0.6 }));
  list.push(makePalette("fabric-lanyard", "lanyard", "fabric-lanyard", "#3a4657"));

  // Head-covering fabrics.
  const coveringBases: [string, string, string][] = [
    ["cover-charcoal", "charcoal fabric", "#33363d"],
    ["cover-cream", "cream fabric", "#cfc4a8"],
    ["cover-navy", "navy fabric", "#2a3a5c"],
    ["cover-burgundy", "burgundy fabric", "#5a2733"],
    ["cover-white", "white fabric", "#e6e6ec"],
    ["cover-black", "black fabric", "#26272b"],
  ];
  for (const [id, label, base] of coveringBases) list.push(makePalette(id, label, id, base));

  const record: Record<string, PaletteDefinition> = {};
  for (const p of list) record[p.id] = p;
  return record;
}

// ---------------------------------------------------------------------------
// Materials (13 required PBR presets)
// ---------------------------------------------------------------------------

function buildMaterials(): Record<string, MaterialDefinition> {
  const m: MaterialDefinition[] = [
    { id: "skin", label: "Skin", roughness: 0.55, metallic: 0, ao: 0.35, specular: 0.4, emissive: 0, relief: 0.6 },
    { id: "wool-matte", label: "Matte Wool Suit", roughness: 0.92, metallic: 0, ao: 0.5, specular: 0.15, emissive: 0, relief: 0.4 },
    { id: "cotton", label: "Cotton Shirt", roughness: 0.78, metallic: 0, ao: 0.4, specular: 0.25, emissive: 0, relief: 0.3 },
    { id: "silk", label: "Silk / Satin Tie", roughness: 0.32, metallic: 0, ao: 0.3, specular: 0.7, emissive: 0, relief: 0.5 },
    { id: "leather", label: "Leather", roughness: 0.45, metallic: 0, ao: 0.45, specular: 0.5, emissive: 0, relief: 0.7 },
    { id: "hair-matte", label: "Hair", roughness: 0.6, metallic: 0, ao: 0.5, specular: 0.45, emissive: 0, relief: 0.8 },
    { id: "metal-brushed", label: "Brushed Metal", roughness: 0.4, metallic: 1, ao: 0.3, specular: 0.85, emissive: 0, relief: 0.3 },
    { id: "metal-polished", label: "Polished Metal", roughness: 0.12, metallic: 1, ao: 0.2, specular: 0.95, emissive: 0, relief: 0.2 },
    { id: "glass", label: "Glass", roughness: 0.08, metallic: 0, ao: 0.1, specular: 0.9, emissive: 0, relief: 0.1 },
    { id: "plastic", label: "Plastic", roughness: 0.5, metallic: 0, ao: 0.35, specular: 0.5, emissive: 0, relief: 0.3 },
    { id: "wood", label: "Wood", roughness: 0.7, metallic: 0, ao: 0.5, specular: 0.3, emissive: 0, relief: 0.6 },
    { id: "stone", label: "Stone", roughness: 0.85, metallic: 0, ao: 0.6, specular: 0.2, emissive: 0, relief: 0.7 },
    { id: "screen", label: "Display Screen", roughness: 0.2, metallic: 0, ao: 0.1, specular: 0.6, emissive: 0.9, relief: 0.1 },
  ];
  const record: Record<string, MaterialDefinition> = {};
  for (const mat of m) record[mat.id] = mat;
  return record;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

interface AssetSeed {
  id: string;
  label: string;
  category: AssetDefinition["category"];
  slot: LayerSlot;
  zIndex: number;
  fitGroups: FitGroup[];
  paletteGroup: string;
  materialId: string;
  workAdventureCategory: WorkAdventureCategory;
  requires?: string[];
  excludes?: string[];
  occludes?: LayerSlot[];
  defaultPalette?: string;
  recipe: { kind: string; params: Record<string, number | string | boolean> };
}

function asset(seed: AssetSeed): AssetDefinition {
  return withVersion({
    id: seed.id,
    label: seed.label,
    category: seed.category,
    slot: seed.slot,
    zIndex: seed.zIndex,
    fitGroups: seed.fitGroups,
    directions: ALL_DIRS,
    states: ALL_STATES,
    paletteGroup: seed.paletteGroup,
    defaultPalette: seed.defaultPalette,
    materialId: seed.materialId,
    workAdventureCategory: seed.workAdventureCategory,
    requires: seed.requires ?? [],
    excludes: seed.excludes ?? [],
    occludes: seed.occludes ?? [],
    anchor: { x: 16, y: 30 },
    frame: { width: 32, height: 32 },
    recipe: seed.recipe,
  });
}

function buildFaces(): AssetDefinition[] {
  const masc = ["Angular", "Broad", "Oval", "Square", "Lean", "Rounded"];
  const fem = ["Soft-Oval", "Heart", "Diamond", "Round", "Refined", "Wide"];
  const out: AssetDefinition[] = [];
  const make = (i: number, label: string, fit: FitGroup) =>
    asset({
      id: `face-${fit === "masculine-fit" ? "m" : "f"}-${String(i + 1).padStart(2, "0")}`,
      label: `${label} Face`,
      category: "face",
      slot: "face.base",
      zIndex: 110,
      fitGroups: [fit],
      paletteGroup: "skin",
      materialId: "skin",
      workAdventureCategory: "body",
      recipe: {
        kind: "face",
        params: {
          width: 6 + (i % 3),
          jaw: fit === "masculine-fit" ? 1 + (i % 2) : i % 2,
          brow: (i + 1) % 2,
          eyeSpacing: 2 + (i % 2),
          nose: i % 3,
          age: 1 + (i % 3),
        },
      },
    });
  masc.forEach((l, i) => out.push(make(i, l, "masculine-fit")));
  fem.forEach((l, i) => out.push(make(i, l, "feminine-fit")));
  return out;
}

function buildExpressions(): AssetDefinition[] {
  const kinds: [string, string][] = [
    ["neutral", "Neutral"],
    ["smile", "Smile"],
    ["focused", "Focused"],
    ["talk", "Talk"],
  ];
  return kinds.map(([k, label]) =>
    asset({
      id: `expression-${k}`,
      label,
      category: "expression",
      slot: "expression",
      zIndex: 130,
      fitGroups: ["universal"],
      paletteGroup: "skin",
      materialId: "skin",
      workAdventureCategory: "eyes",
      recipe: { kind: "expression", params: { expression: k } },
    }),
  );
}

function buildHair(): AssetDefinition[] {
  const masc = [
    ["shaved", "Shaved", 0, 0, 0],
    ["buzz", "Buzz Cut", 1, 0, 0],
    ["crew", "Crew Cut", 1, 0, 0],
    ["side-part", "Side Part", 2, 1, 0],
    ["slick", "Slicked Back", 2, 1, 0],
    ["short-wavy", "Short Wavy", 2, 1, 1],
    ["short-curly", "Short Curly", 2, 1, 1],
    ["cropped-coils", "Cropped Coils", 2, 1, 1],
    ["medium-coils", "Medium Coils", 3, 2, 1],
    ["short-locs", "Short Locs", 2, 2, 1],
    ["tied-locs", "Tied Locs", 2, 2, 0],
    ["shoulder", "Shoulder-Length", 3, 3, 1],
  ] as const;
  const fem = [
    ["pixie", "Pixie", 2, 1, 0],
    ["bob", "Bob", 2, 2, 1],
    ["long-bob", "Long Bob", 3, 2, 1],
    ["long-straight", "Long Straight", 3, 3, 0],
    ["long-wavy", "Long Wavy", 3, 3, 1],
    ["shoulder-curls", "Shoulder Curls", 3, 3, 1],
    ["short-coils", "Short Coils", 2, 1, 1],
    ["afro", "Professional Afro", 3, 2, 2],
    ["braids", "Braids", 3, 3, 1],
    ["locs", "Locs", 3, 3, 1],
    ["bun", "Executive Bun", 2, 1, 0],
    ["ponytail", "Professional Ponytail", 2, 2, 0],
  ] as const;
  const out: AssetDefinition[] = [];
  const make = (fit: FitGroup, [id, label, coverage, length, volume]: readonly [string, string, number, number, number]) =>
    asset({
      id: `hair-${fit === "masculine-fit" ? "m" : "f"}-${id}`,
      label,
      category: "hair",
      slot: "hair.front",
      zIndex: 200,
      fitGroups: [fit],
      paletteGroup: "hair",
      defaultPalette: "hair-dark-brown",
      materialId: "hair-matte",
      workAdventureCategory: "hairs",
      recipe: { kind: "hair", params: { coverage, length, volume, style: id } },
    });
  for (const h of masc) out.push(make("masculine-fit", h));
  for (const h of fem) out.push(make("feminine-fit", h));
  return out;
}

function buildFacialHair(): AssetDefinition[] {
  const items: [string, string, number][] = [
    ["light-stubble", "Light Stubble", 1],
    ["full-stubble", "Full Stubble", 1],
    ["pencil-mustache", "Pencil Mustache", 1],
    ["classic-mustache", "Classic Mustache", 2],
    ["chevron-mustache", "Chevron Mustache", 2],
    ["goatee", "Goatee", 2],
    ["circle-beard", "Circle Beard", 2],
    ["short-boxed", "Short Boxed Beard", 2],
    ["full-beard", "Full Beard", 2],
    ["tapered-beard", "Tapered Beard", 2],
    ["chin-strap", "Chin Strap", 1],
    ["soul-patch", "Soul Patch", 1],
  ];
  return items.map(([id, label, density]) =>
    asset({
      id: `facialhair-${id}`,
      label,
      category: "facialHair",
      slot: "facialHair",
      zIndex: 135,
      fitGroups: ["masculine-fit"],
      paletteGroup: "hair",
      defaultPalette: "hair-dark-brown",
      materialId: "hair-matte",
      workAdventureCategory: "hairs",
      recipe: {
        kind: "facialHair",
        params: { style: id.includes("mustache") ? "mustache" : id.replace("-beard", "").replace("light-", "").replace("full-", ""), density, id },
      },
    }),
  );
}

function buildHeadCoverings(): AssetDefinition[] {
  // occludesFront: whether the covering hides front hair.
  const items: [string, string, string, number, boolean][] = [
    ["hijab-classic", "Classic Hijab", "hijab", 1, true],
    ["hijab-draped", "Draped Hijab", "hijab", 2, true],
    ["turban-formal", "Formal Turban", "turban", 1, true],
    ["turban-wrapped", "Wrapped Turban", "turban", 1, true],
    ["dastar", "Dastar", "dastar", 1, true],
    ["headwrap-structured", "Structured Headwrap", "headwrap", 1, true],
    ["headwrap-knotted", "Knotted Headwrap", "headwrap", 1, true],
    ["kufi", "Kufi", "cap", 0, false],
    ["taqiyah", "Taqiyah", "cap", 0, false],
    ["kippah", "Kippah", "cap", 0, false],
    ["hat-brimmed", "Professional Brimmed Hat", "hat", 0, false],
    ["cap-formal", "Formal Cap", "cap", 0, false],
  ];
  return items.map(([id, label, style, drape, occludesFront]) =>
    asset({
      id: `headcovering-${id}`,
      label,
      category: "headCovering",
      slot: "headCovering.front",
      zIndex: 210,
      fitGroups: ["universal"],
      paletteGroup: "cover-charcoal",
      defaultPalette: "cover-charcoal",
      materialId: "cotton",
      workAdventureCategory: "hats",
      occludes: occludesFront ? (["hair.front"] as LayerSlot[]) : [],
      recipe: { kind: "headCovering", params: { style, drape, culturallyReviewed: true } },
    }),
  );
}

function buildOutfits(): { assets: AssetDefinition[]; systems: OutfitSystem[] } {
  const assets: AssetDefinition[] = [];
  const systems: OutfitSystem[] = [];

  type Part = "lower" | "base" | "shirt" | "outer" | "shoes" | "neckwear" | "pocket";
  const partMeta: Record<Part, { slot: LayerSlot; z: number; wa: WorkAdventureCategory; kind: string; part: string; material: string }> = {
    lower: { slot: "outfit.lower", z: 60, wa: "clothes", kind: "outfit", part: "lower", material: "wool-matte" },
    base: { slot: "outfit.base", z: 70, wa: "clothes", kind: "outfit", part: "base", material: "wool-matte" },
    shirt: { slot: "outfit.shirt", z: 75, wa: "clothes", kind: "outfit", part: "shirt", material: "cotton" },
    outer: { slot: "outfit.outer", z: 80, wa: "clothes", kind: "outfit", part: "outer", material: "wool-matte" },
    shoes: { slot: "outfit.shoes", z: 65, wa: "clothes", kind: "outfit", part: "shoes", material: "leather" },
    neckwear: { slot: "neckwear", z: 220, wa: "clothes", kind: "outfit", part: "neckwear", material: "silk" },
    pocket: { slot: "outfit.outer", z: 82, wa: "clothes", kind: "outfit", part: "pocket", material: "silk" },
  };

  interface OutfitSpec {
    id: string;
    label: string;
    fit: FitGroup;
    parts: Part[];
    extraParams?: Partial<Record<Part, Record<string, number | string>>>;
    colorways: { id: string; label: string; palettes: Partial<Record<LayerSlot, string>> }[];
    reviewed?: boolean;
  }

  const cw = (id: string, label: string, p: Partial<Record<LayerSlot, string>>) => ({ id, label, palettes: p });

  const specs: OutfitSpec[] = [
    {
      id: "suit-2p", label: "Classic Two-Piece Suit", fit: "masculine-fit",
      parts: ["lower", "shirt", "outer", "shoes", "neckwear"],
      extraParams: { neckwear: { neck: "tie" } },
      colorways: [
        cw("navy", "Navy", { "outfit.outer": "fabric-navy", "outfit.lower": "fabric-navy", "outfit.shirt": "shirt-white", "neckwear": "tie-burgundy", "outfit.shoes": "leather-black" }),
        cw("charcoal", "Charcoal", { "outfit.outer": "fabric-charcoal", "outfit.lower": "fabric-charcoal", "outfit.shirt": "shirt-blue", "neckwear": "tie-navy", "outfit.shoes": "leather-black" }),
        cw("graphite", "Graphite", { "outfit.outer": "fabric-graphite", "outfit.lower": "fabric-graphite", "outfit.shirt": "shirt-white", "neckwear": "tie-forest", "outfit.shoes": "leather-brown" }),
      ],
    },
    {
      id: "suit-3p", label: "Three-Piece Suit", fit: "masculine-fit",
      parts: ["lower", "shirt", "base", "outer", "shoes", "neckwear"],
      extraParams: { neckwear: { neck: "tie" } },
      colorways: [
        cw("navy", "Navy", { "outfit.outer": "fabric-navy", "outfit.base": "fabric-navy", "outfit.lower": "fabric-navy", "outfit.shirt": "shirt-white", "neckwear": "tie-gold", "outfit.shoes": "leather-black" }),
        cw("charcoal", "Charcoal", { "outfit.outer": "fabric-charcoal", "outfit.base": "fabric-graphite", "outfit.lower": "fabric-charcoal", "outfit.shirt": "shirt-blue", "neckwear": "tie-burgundy", "outfit.shoes": "leather-black" }),
        cw("forest", "Forest", { "outfit.outer": "fabric-forest", "outfit.base": "fabric-forest", "outfit.lower": "fabric-forest", "outfit.shirt": "shirt-white", "neckwear": "tie-gold", "outfit.shoes": "leather-brown" }),
      ],
    },
    {
      id: "pantsuit", label: "Modern Pantsuit", fit: "feminine-fit",
      parts: ["lower", "shirt", "outer", "shoes"],
      colorways: [
        cw("burgundy", "Burgundy", { "outfit.outer": "fabric-burgundy", "outfit.lower": "fabric-burgundy", "outfit.shirt": "shirt-white", "outfit.shoes": "leather-black" }),
        cw("navy", "Navy", { "outfit.outer": "fabric-navy", "outfit.lower": "fabric-navy", "outfit.shirt": "shirt-rose", "outfit.shoes": "leather-black" }),
        cw("slate", "Slate", { "outfit.outer": "fabric-slate", "outfit.lower": "fabric-slate", "outfit.shirt": "shirt-white", "outfit.shoes": "leather-brown" }),
      ],
    },
    {
      id: "skirt-suit", label: "Skirt Suit", fit: "feminine-fit",
      parts: ["lower", "shirt", "outer", "shoes"],
      extraParams: { lower: { skirt: 1 } },
      colorways: [
        cw("charcoal", "Charcoal", { "outfit.outer": "fabric-charcoal", "outfit.lower": "fabric-charcoal", "outfit.shirt": "shirt-white", "outfit.shoes": "leather-black" }),
        cw("taupe", "Taupe", { "outfit.outer": "fabric-taupe", "outfit.lower": "fabric-taupe", "outfit.shirt": "shirt-rose", "outfit.shoes": "leather-brown" }),
        cw("navy", "Navy", { "outfit.outer": "fabric-navy", "outfit.lower": "fabric-navy", "outfit.shirt": "shirt-blue", "outfit.shoes": "leather-black" }),
      ],
    },
    {
      id: "business-dress", label: "Tailored Business Dress", fit: "feminine-fit",
      parts: ["lower", "base", "shoes"],
      extraParams: { lower: { skirt: 1 }, base: { part: "base" } },
      colorways: [
        cw("burgundy", "Burgundy", { "outfit.base": "fabric-burgundy", "outfit.lower": "fabric-burgundy", "outfit.shoes": "leather-black" }),
        cw("forest", "Forest", { "outfit.base": "fabric-forest", "outfit.lower": "fabric-forest", "outfit.shoes": "leather-brown" }),
        cw("slate", "Slate", { "outfit.base": "fabric-slate", "outfit.lower": "fabric-slate", "outfit.shoes": "leather-black" }),
      ],
    },
    {
      id: "blazer-trousers", label: "Blazer & Tailored Trousers", fit: "universal",
      parts: ["lower", "shirt", "outer", "shoes"],
      colorways: [
        cw("navy-tan", "Navy / Tan", { "outfit.outer": "fabric-navy", "outfit.lower": "fabric-tan", "outfit.shirt": "shirt-white", "outfit.shoes": "leather-brown" }),
        cw("charcoal", "Charcoal", { "outfit.outer": "fabric-charcoal", "outfit.lower": "fabric-charcoal", "outfit.shirt": "shirt-blue", "outfit.shoes": "leather-black" }),
        cw("olive", "Olive", { "outfit.outer": "fabric-olive", "outfit.lower": "fabric-graphite", "outfit.shirt": "shirt-white", "outfit.shoes": "leather-brown" }),
      ],
    },
    {
      id: "blazer-blouse", label: "Blazer & Blouse", fit: "feminine-fit",
      parts: ["lower", "shirt", "outer", "shoes"],
      colorways: [
        cw("slate-rose", "Slate / Rose", { "outfit.outer": "fabric-slate", "outfit.lower": "fabric-slate", "outfit.shirt": "shirt-rose", "outfit.shoes": "leather-black" }),
        cw("navy", "Navy", { "outfit.outer": "fabric-navy", "outfit.lower": "fabric-navy", "outfit.shirt": "shirt-white", "outfit.shoes": "leather-black" }),
        cw("cream", "Cream", { "outfit.outer": "fabric-cream", "outfit.lower": "fabric-taupe", "outfit.shirt": "shirt-white", "outfit.shoes": "leather-brown" }),
      ],
    },
    {
      id: "turtleneck-jacket", label: "Turtleneck & Tailored Jacket", fit: "universal",
      parts: ["lower", "shirt", "outer", "shoes"],
      extraParams: { shirt: { part: "shirt" } },
      colorways: [
        cw("charcoal-black", "Charcoal / Black", { "outfit.outer": "fabric-charcoal", "outfit.lower": "fabric-charcoal", "outfit.shirt": "fabric-black", "outfit.shoes": "leather-black" }),
        cw("navy-cream", "Navy / Cream", { "outfit.outer": "fabric-navy", "outfit.lower": "fabric-navy", "outfit.shirt": "fabric-cream", "outfit.shoes": "leather-brown" }),
        cw("forest", "Forest", { "outfit.outer": "fabric-forest", "outfit.lower": "fabric-graphite", "outfit.shirt": "fabric-black", "outfit.shoes": "leather-black" }),
      ],
    },
    {
      id: "smart-casual", label: "Smart-Casual Executive", fit: "universal",
      parts: ["lower", "shirt", "outer", "shoes"],
      extraParams: { outer: { sheen: 0 } },
      colorways: [
        cw("navy", "Navy", { "outfit.outer": "fabric-navy", "outfit.lower": "fabric-tan", "outfit.shirt": "shirt-white", "outfit.shoes": "leather-brown" }),
        cw("olive", "Olive", { "outfit.outer": "fabric-olive", "outfit.lower": "fabric-taupe", "outfit.shirt": "shirt-blue", "outfit.shoes": "leather-brown" }),
        cw("graphite", "Graphite", { "outfit.outer": "fabric-graphite", "outfit.lower": "fabric-charcoal", "outfit.shirt": "shirt-white", "outfit.shoes": "leather-black" }),
      ],
    },
    {
      id: "tech-exec", label: "Technology Executive", fit: "universal",
      parts: ["lower", "shirt", "outer", "shoes"],
      extraParams: { outer: { sheen: 1 } },
      colorways: [
        cw("black", "All Black", { "outfit.outer": "fabric-black", "outfit.lower": "fabric-black", "outfit.shirt": "fabric-black", "outfit.shoes": "leather-black" }),
        cw("graphite", "Graphite", { "outfit.outer": "fabric-graphite", "outfit.lower": "fabric-graphite", "outfit.shirt": "shirt-gray", "outfit.shoes": "leather-black" }),
        cw("navy", "Navy", { "outfit.outer": "fabric-navy", "outfit.lower": "fabric-charcoal", "outfit.shirt": "shirt-white", "outfit.shoes": "leather-black" }),
      ],
    },
    {
      id: "black-tie", label: "Formal Board / Evening Event", fit: "universal",
      parts: ["lower", "shirt", "outer", "shoes", "neckwear", "pocket"],
      extraParams: { neckwear: { neck: "bowtie" }, outer: { sheen: 1 } },
      colorways: [
        cw("black", "Black Tie", { "outfit.outer": "fabric-black", "outfit.lower": "fabric-black", "outfit.shirt": "shirt-white", "neckwear": "fabric-black", "outfit.shoes": "leather-black" }),
        cw("midnight", "Midnight Navy", { "outfit.outer": "fabric-navy", "outfit.lower": "fabric-navy", "outfit.shirt": "shirt-white", "neckwear": "tie-navy", "outfit.shoes": "leather-black" }),
        cw("burgundy", "Burgundy Dinner", { "outfit.outer": "fabric-burgundy", "outfit.lower": "fabric-black", "outfit.shirt": "shirt-white", "neckwear": "fabric-black", "outfit.shoes": "leather-black" }),
      ],
    },
    {
      id: "cultural-formal-01", label: "Cultural Formalwear I", fit: "universal", reviewed: true,
      parts: ["lower", "base", "shoes", "neckwear"],
      extraParams: { base: { part: "base" }, neckwear: { neck: "scarf" } },
      colorways: [
        cw("cream", "Cream & Gold", { "outfit.base": "fabric-cream", "outfit.lower": "fabric-cream", "neckwear": "tie-gold", "outfit.shoes": "leather-brown" }),
        cw("forest", "Forest & Gold", { "outfit.base": "fabric-forest", "outfit.lower": "fabric-forest", "neckwear": "tie-gold", "outfit.shoes": "leather-black" }),
        cw("burgundy", "Burgundy", { "outfit.base": "fabric-burgundy", "outfit.lower": "fabric-burgundy", "neckwear": "tie-gold", "outfit.shoes": "leather-black" }),
      ],
    },
    {
      id: "cultural-formal-02", label: "Cultural Formalwear II", fit: "universal", reviewed: true,
      parts: ["lower", "base", "shoes"],
      extraParams: { base: { part: "base", sheen: 1 }, lower: { skirt: 1 } },
      colorways: [
        cw("navy-gold", "Navy & Gold", { "outfit.base": "fabric-navy", "outfit.lower": "fabric-navy", "outfit.shoes": "leather-black" }),
        cw("burgundy", "Burgundy", { "outfit.base": "fabric-burgundy", "outfit.lower": "fabric-burgundy", "outfit.shoes": "leather-black" }),
        cw("charcoal", "Charcoal", { "outfit.base": "fabric-charcoal", "outfit.lower": "fabric-charcoal", "outfit.shoes": "leather-brown" }),
      ],
    },
  ];

  for (const spec of specs) {
    const sublayers: string[] = [];
    for (const part of spec.parts) {
      const meta = partMeta[part];
      const id = `outfit-${spec.id}-${part}`;
      sublayers.push(id);
      const extra = spec.extraParams?.[part] ?? {};
      assets.push(
        asset({
          id,
          label: `${spec.label} — ${part}`,
          category: "outfit",
          slot: meta.slot,
          zIndex: meta.z,
          fitGroups: [spec.fit],
          paletteGroup: `outfit-${spec.id}`,
          defaultPalette: part === "shirt" ? "shirt-white" : part === "shoes" ? "leather-black" : "fabric-navy",
          materialId: meta.material,
          workAdventureCategory: meta.wa,
          recipe: { kind: "outfit", params: { part: meta.part, ...extra } },
        }),
      );
    }
    systems.push({
      id: spec.id,
      label: spec.label,
      fitGroups: [spec.fit],
      sublayers,
      colorways: spec.colorways,
      culturallyReviewed: spec.reviewed,
    });
  }

  return { assets, systems };
}

function buildAccessories(): AssetDefinition[] {
  interface AccSpec {
    id: string;
    label: string;
    slot: LayerSlot;
    z: number;
    wa: WorkAdventureCategory;
    material: string;
    palette: string;
    params: Record<string, number | string>;
    excludes?: string[];
  }
  const glassesExcl = ["accessory-glasses-round", "accessory-glasses-browline", "accessory-glasses-rect"];
  const handExcl = ["accessory-tablet", "accessory-clipboard", "accessory-phone", "accessory-portfolio", "accessory-briefcase"];
  const specs: AccSpec[] = [
    { id: "glasses-rect", label: "Rectangular Glasses", slot: "eyewear", z: 230, wa: "accessories", material: "glass", palette: "glass-clear", params: { acc: "glasses", shape: "rect" }, excludes: glassesExcl },
    { id: "glasses-round", label: "Round Glasses", slot: "eyewear", z: 230, wa: "accessories", material: "glass", palette: "glass-clear", params: { acc: "glasses", shape: "round" }, excludes: glassesExcl },
    { id: "glasses-browline", label: "Browline Glasses", slot: "eyewear", z: 230, wa: "accessories", material: "glass", palette: "glass-clear", params: { acc: "glasses", shape: "browline" }, excludes: glassesExcl },
    { id: "badge", label: "ID Badge", slot: "accessory.front", z: 240, wa: "accessories", material: "plastic", palette: "plastic-dark", params: { acc: "badge" } },
    { id: "lanyard", label: "Lanyard", slot: "accessory.front", z: 239, wa: "accessories", material: "cotton", palette: "fabric-lanyard", params: { acc: "lanyard" } },
    { id: "pin", label: "Lapel Pin", slot: "accessory.front", z: 241, wa: "accessories", material: "metal-polished", palette: "metal-gold", params: { acc: "pin" } },
    { id: "pocket-square", label: "Pocket Square", slot: "accessory.front", z: 238, wa: "accessories", material: "silk", palette: "tie-burgundy", params: { acc: "pocket-square" } },
    { id: "pen", label: "Pen", slot: "accessory.front", z: 242, wa: "accessories", material: "metal-polished", palette: "metal-steel", params: { acc: "pen" } },
    { id: "tablet", label: "Tablet", slot: "handheld", z: 250, wa: "accessories", material: "screen", palette: "screen-cyan", params: { acc: "tablet" }, excludes: handExcl },
    { id: "clipboard", label: "Clipboard", slot: "handheld", z: 250, wa: "accessories", material: "wood", palette: "fabric-tan", params: { acc: "clipboard" }, excludes: handExcl },
    { id: "watch", label: "Wristwatch", slot: "accessory.front", z: 243, wa: "accessories", material: "metal-polished", palette: "metal-steel", params: { acc: "watch" }, excludes: ["accessory-smartwatch"] },
    { id: "smartwatch", label: "Smartwatch", slot: "accessory.front", z: 243, wa: "accessories", material: "screen", palette: "screen-cyan", params: { acc: "smartwatch" }, excludes: ["accessory-watch"] },
    { id: "briefcase", label: "Briefcase", slot: "handheld", z: 40, wa: "accessories", material: "leather", palette: "leather-brown", params: { acc: "briefcase" }, excludes: handExcl },
    { id: "portfolio", label: "Portfolio Folder", slot: "handheld", z: 250, wa: "accessories", material: "leather", palette: "leather-black", params: { acc: "portfolio" }, excludes: handExcl },
    { id: "phone", label: "Phone", slot: "handheld", z: 250, wa: "accessories", material: "screen", palette: "plastic-dark", params: { acc: "phone" }, excludes: handExcl },
    { id: "earpiece", label: "Earpiece", slot: "accessory.front", z: 245, wa: "accessories", material: "plastic", palette: "plastic-dark", params: { acc: "earpiece" } },
    { id: "headset", label: "Conference Headset", slot: "accessory.front", z: 246, wa: "accessories", material: "plastic", palette: "plastic-dark", params: { acc: "headset" } },
  ];
  return specs.map((s) => {
    const id = `accessory-${s.id}`;
    return asset({
      id,
      label: s.label,
      category: "accessory",
      slot: s.slot,
      zIndex: s.z,
      fitGroups: ["universal"],
      paletteGroup: s.palette,
      defaultPalette: s.palette,
      materialId: s.material,
      workAdventureCategory: s.wa,
      // An asset never excludes itself (the mutual lists are declared inclusively).
      excludes: (s.excludes ?? []).filter((e) => e !== id),
      recipe: { kind: "accessory", params: s.params },
    });
  });
}

// ---------------------------------------------------------------------------
// Example executives
// ---------------------------------------------------------------------------

function buildExamples(): CharacterConfig[] {
  const now = "2026-01-01T00:00:00.000Z";
  const base = (o: Partial<CharacterConfig> & { characterId: string; displayName: string }): CharacterConfig => ({
    manifestVersion: "1.0.0",
    fitGroup: "universal",
    skinPalette: "skin-olive-03",
    face: "face-m-01",
    expression: "neutral",
    hair: null,
    hairColor: "hair-dark-brown",
    facialHair: null,
    facialHairColor: "hair-dark-brown",
    headCovering: null,
    outfitSystem: "suit-2p",
    outfitColorway: "navy",
    accessories: [],
    materialOverrides: {},
    direction: "down",
    state: "idle",
    createdAt: now,
    modifiedAt: now,
    ...o,
  });

  return [
    base({ characterId: "exec-ceo", displayName: "Managing Partner", fitGroup: "masculine-fit", skinPalette: "skin-olive-02", face: "face-m-03", expression: "focused", hair: "hair-m-side-part", hairColor: "hair-salt-pepper", facialHair: "facialhair-short-boxed", facialHairColor: "hair-salt-pepper", outfitSystem: "suit-3p", outfitColorway: "navy", accessories: ["accessory-glasses-rect", "accessory-watch", "accessory-pin"] }),
    base({ characterId: "exec-cio", displayName: "Chief Investment Officer", fitGroup: "feminine-fit", skinPalette: "skin-olive-05", face: "face-f-02", expression: "smile", hair: "hair-f-bun", hairColor: "hair-soft-black", outfitSystem: "pantsuit", outfitColorway: "burgundy", accessories: ["accessory-tablet", "accessory-smartwatch"] }),
    base({ characterId: "exec-counsel", displayName: "General Counsel", fitGroup: "feminine-fit", skinPalette: "skin-olive-01-light", face: "face-f-05", expression: "neutral", hair: null, headCovering: "headcovering-hijab-draped", outfitSystem: "skirt-suit", outfitColorway: "charcoal", accessories: ["accessory-glasses-browline", "accessory-portfolio"], materialOverrides: { "headcovering-hijab-draped": { palette: "cover-navy" } } }),
    base({ characterId: "exec-ops", displayName: "Head of Operations", fitGroup: "masculine-fit", skinPalette: "skin-olive-06-deep", face: "face-m-02", expression: "talk", hair: "hair-m-cropped-coils", hairColor: "hair-soft-black", facialHair: "facialhair-full-beard", facialHairColor: "hair-soft-black", outfitSystem: "blazer-trousers", outfitColorway: "navy-tan", accessories: ["accessory-clipboard", "accessory-lanyard"] }),
    base({ characterId: "exec-tech", displayName: "Chief Technology Officer", fitGroup: "universal", skinPalette: "skin-olive-04", face: "face-m-05", expression: "focused", hair: "hair-m-short-curly", hairColor: "hair-espresso", outfitSystem: "tech-exec", outfitColorway: "black", accessories: ["accessory-phone", "accessory-earpiece"] }),
    base({ characterId: "exec-advisor", displayName: "Senior Advisor", fitGroup: "masculine-fit", skinPalette: "skin-olive-03", face: "face-m-04", expression: "smile", hair: null, headCovering: "headcovering-turban-formal", outfitSystem: "suit-2p", outfitColorway: "charcoal", accessories: ["accessory-glasses-round", "accessory-briefcase"], materialOverrides: { "headcovering-turban-formal": { palette: "cover-burgundy" } } }),
    base({ characterId: "exec-capital", displayName: "Capital Markets Lead", fitGroup: "feminine-fit", skinPalette: "skin-olive-02", face: "face-f-03", expression: "neutral", hair: "hair-f-long-straight", hairColor: "hair-chestnut", outfitSystem: "blazer-blouse", outfitColorway: "slate-rose", accessories: ["accessory-headset", "accessory-smartwatch"] }),
    base({ characterId: "exec-chair", displayName: "Board Chair", fitGroup: "feminine-fit", skinPalette: "skin-olive-06-deep", face: "face-f-06", expression: "approve" as never, hair: "hair-f-afro", hairColor: "hair-white", outfitSystem: "black-tie", outfitColorway: "midnight", accessories: ["accessory-pin", "accessory-pocket-square"], state: "approve" }),
  ];
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

export function buildManifest(): Manifest {
  const { assets: outfitAssets, systems: outfitSystems } = buildOutfits();
  const assets = [
    ...buildFaces(),
    ...buildExpressions(),
    ...buildHair(),
    ...buildFacialHair(),
    ...buildHeadCoverings(),
    ...outfitAssets,
    ...buildAccessories(),
  ];

  const examples = buildExamples();
  // Fix example expression field: expression must be one of the 4 canonical.
  for (const ex of examples) {
    if (!["neutral", "smile", "focused", "talk"].includes(ex.expression)) {
      ex.expression = "neutral";
    }
  }

  return {
    schemaVersion: "1.0.0",
    packageVersion: "1.0.0",
    frame: { width: 32, height: 32, reviewScale: 8, directions: ALL_DIRS },
    animations: {
      idle: { framesPerDirection: 2, fps: 2, loop: true, columns: 2, rows: 4, width: 64, height: 128 },
      walk: { framesPerDirection: 3, fps: 8, loop: true, columns: 3, rows: 4, width: 96, height: 128 },
      talk: { framesPerDirection: 4, fps: 8, loop: true, columns: 4, rows: 4, width: 128, height: 128 },
      approve: { framesPerDirection: 4, fps: 6, loop: false, columns: 4, rows: 4, width: 128, height: 128 },
    },
    layerOrder: LAYER_ORDER,
    workAdventure: {
      categories: WORKADVENTURE_CATEGORIES,
      walkSheet: { columns: 3, rows: 4, width: 96, height: 128 },
    },
    palettes: buildPalettes(),
    materials: buildMaterials(),
    assets,
    outfitSystems,
    examples,
    attribution: {
      author: "FundExecs",
      license: "MIT",
      copyright: "© 2026 FundExecs. Original pixel-art system.",
      notes:
        "All character art is procedurally composited raster pixel art authored for FundExecs. No assets are copied from WorkAdventure, Spot, or any third-party product. WorkAdventure and Tiled are referenced only for format compatibility.",
    },
  };
}
