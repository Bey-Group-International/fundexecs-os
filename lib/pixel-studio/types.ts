/**
 * FundExecs Pixel Character & Map Studio — core domain types.
 *
 * This module is the single TypeScript source of truth for the raster
 * pixel-art system that replaces the legacy vector avatar. Everything here is
 * pure data: no DOM, no canvas, no React — so it can be unit-tested under the
 * repo's `ts-jest` (node) preset and imported by both the browser UI and the
 * Node build/validation scripts.
 *
 * Design contract (see docs/pixel-studio/IMPLEMENTATION_README.md):
 *   - Native frame is 32×32. Review scale is 8× → 256×256 per frame.
 *   - Four directions, ordered: down, left, right, up (WorkAdventure order).
 *   - Four animation states: idle, walk, talk, approve.
 *   - Palettes declare *semantic roles*, not unordered color lists.
 *   - Assets declare compatibility/occlusion data — never hardcoded in UI.
 */

export const DIRECTIONS = ["down", "left", "right", "up"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ANIMATION_STATES = ["idle", "walk", "talk", "approve"] as const;
export type AnimationState = (typeof ANIMATION_STATES)[number];

/** Ordered semantic palette roles. Order matters: shadow → light ramp. */
export const PALETTE_ROLES = [
  "deepShadow",
  "shadow",
  "base",
  "midtone",
  "highlight",
  "specular",
] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

/** The internal (rich) layer model — collapsed to 6 WA categories on export. */
export const LAYER_ORDER = [
  "shadow",
  "accessory.back",
  "hair.back",
  "headCovering.back",
  "body.skin",
  "outfit.lower",
  "outfit.base",
  "outfit.shirt",
  "outfit.outer",
  "outfit.shoes",
  "face.base",
  "face.features",
  "expression",
  "facialHair",
  "hair.front",
  "headCovering.front",
  "neckwear",
  "eyewear",
  "accessory.front",
  "handheld",
  "state.effect",
] as const;
export type LayerSlot = (typeof LAYER_ORDER)[number];

/** The six WorkAdventure Woka export categories. */
export const WORKADVENTURE_CATEGORIES = [
  "body",
  "eyes",
  "hairs",
  "clothes",
  "hats",
  "accessories",
] as const;
export type WorkAdventureCategory = (typeof WORKADVENTURE_CATEGORIES)[number];

/** High-level asset categories used by the studio UI navigation. */
export const ASSET_CATEGORIES = [
  "skin",
  "face",
  "expression",
  "hair",
  "facialHair",
  "headCovering",
  "outfit",
  "accessory",
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** Compatibility "fit" tags. Data-only — never a rendering restriction. */
export type FitGroup = "masculine-fit" | "feminine-fit" | "universal";

// ---------------------------------------------------------------------------
// Palettes & materials
// ---------------------------------------------------------------------------

export interface PaletteDefinition {
  id: string;
  label: string;
  /** Grouping key e.g. "skin", "hair", "wool-navy" for swap targeting. */
  group: string;
  /** Exact hex (#rrggbb) or rgba() per semantic role. */
  colors: Record<PaletteRole, string>;
}

/** Physically-based material description used only by PBR Showcase mode. */
export interface MaterialDefinition {
  id: string;
  label: string;
  /** 0..1 microfacet roughness. */
  roughness: number;
  /** 0..1 metallic factor. */
  metallic: number;
  /** 0..1 ambient-occlusion baseline. */
  ao: number;
  /** 0..1 dielectric specular intensity. */
  specular: number;
  /** 0..1 emissive strength (screens, indicator LEDs). */
  emissive: number;
  /** Height/normal relief strength, in native pixels. */
  relief: number;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export interface AnimationDefinition {
  framesPerDirection: number;
  fps: number;
  loop: boolean;
  /** Sheet grid for this state (WA walk is the canonical 3×4 / 96×128). */
  columns: number;
  rows: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * A procedural draw recipe. Rather than shipping thousands of hand-authored
 * PNGs, each asset carries deterministic pixel-shape parameters that the
 * compositor paints at integer coordinates with smoothing disabled. This is
 * genuine raster pixel art (deliberate hard-edged pixel clusters); it is NOT
 * runtime vector rendering — there are no paths, curves, or anti-aliasing.
 */
export interface PixelRecipe {
  /** Painter family the compositor dispatches on (matches category/slot). */
  kind: string;
  /** Numeric/string shape parameters unique to each registered asset. */
  params: Record<string, number | string | boolean | number[]>;
}

export interface AssetFiles {
  /** Native 1× sprite-sheet paths keyed by animation state (when pre-baked). */
  native?: Partial<Record<AnimationState, string>>;
  /** 8× review sheet paths keyed by state (when pre-baked). */
  review8x?: Partial<Record<AnimationState, string>>;
  /** Optional PBR mask paths keyed by mask type. */
  materialMasks?: Record<string, string>;
}

export interface AssetDefinition {
  id: string;
  label: string;
  category: AssetCategory;
  slot: LayerSlot;
  zIndex: number;
  fitGroups: FitGroup[];
  directions: Direction[];
  states: AnimationState[];
  /** Palette group this asset recolors against (e.g. "skin", "hair"). */
  paletteGroup: string;
  /** Default palette id if the config does not override. */
  defaultPalette?: string;
  materialId: string;
  workAdventureCategory: WorkAdventureCategory;
  /** Asset/category ids that must also be present. */
  requires: string[];
  /** Asset/category ids that cannot co-exist. */
  excludes: string[];
  /** Layer slots this asset hides when active. */
  occludes: LayerSlot[];
  anchor: { x: number; y: number };
  frame: { width: number; height: number };
  recipe: PixelRecipe;
  files?: AssetFiles;
  /** Stable content hash for change detection / cache-busting. */
  assetVersion: string;
}

// ---------------------------------------------------------------------------
// Outfit systems (assembled from sublayer assets)
// ---------------------------------------------------------------------------

export interface OutfitColorway {
  id: string;
  label: string;
  /** Palette id per sublayer slot. */
  palettes: Partial<Record<LayerSlot, string>>;
}

export interface OutfitSystem {
  id: string;
  label: string;
  fitGroups: FitGroup[];
  /** Ordered sublayer asset ids that compose this outfit. */
  sublayers: string[];
  colorways: OutfitColorway[];
  culturallyReviewed?: boolean;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface ManifestFrame {
  width: number;
  height: number;
  reviewScale: number;
  directions: readonly Direction[];
}

export interface Manifest {
  schemaVersion: string;
  packageVersion: string;
  frame: ManifestFrame;
  animations: Record<AnimationState, AnimationDefinition>;
  layerOrder: readonly LayerSlot[];
  workAdventure: {
    categories: readonly WorkAdventureCategory[];
    walkSheet: { columns: number; rows: number; width: number; height: number };
  };
  palettes: Record<string, PaletteDefinition>;
  materials: Record<string, MaterialDefinition>;
  assets: AssetDefinition[];
  outfitSystems: OutfitSystem[];
  examples: CharacterConfig[];
  attribution: {
    author: string;
    license: string;
    copyright: string;
    notes: string;
  };
}

// ---------------------------------------------------------------------------
// Character configuration (saved doc)
// ---------------------------------------------------------------------------

export interface CharacterConfig {
  characterId: string;
  displayName: string;
  manifestVersion: string;
  seed?: number;
  fitGroup: FitGroup;
  skinPalette: string;
  face: string;
  expression: string;
  hair: string | null;
  hairColor: string;
  facialHair: string | null;
  facialHairColor: string;
  headCovering: string | null;
  outfitSystem: string;
  outfitColorway: string;
  accessories: string[];
  /** Per-asset palette/material overrides keyed by asset id. */
  materialOverrides: Record<string, { palette?: string; material?: string }>;
  direction: Direction;
  state: AnimationState;
  createdAt: string;
  modifiedAt: string;
}

// ---------------------------------------------------------------------------
// Map project
// ---------------------------------------------------------------------------

export const MAP_LAYERS = [
  "exterior",
  "ground",
  "floor",
  "walls",
  "furniture",
  "technology",
  "signage",
  "screens",
  "decor",
  "collisions",
  "interactions",
  "spawns",
  "entrances",
  "exits",
  "overhead",
] as const;
export type MapLayerId = (typeof MAP_LAYERS)[number];

export interface MapTilePlacement {
  /** Object/tile asset id from the map asset registry. */
  assetId: string;
  x: number;
  y: number;
  rotation?: 0 | 90 | 180 | 270;
  props?: Record<string, string | number | boolean>;
}

export interface MapLayer {
  id: MapLayerId;
  label: string;
  visible: boolean;
  locked: boolean;
  placements: MapTilePlacement[];
}

export interface MapProject {
  mapId: string;
  name: string;
  description: string;
  schemaVersion: string;
  width: number;
  height: number;
  tileSize: 32;
  layers: MapLayer[];
  branding: {
    logoAssetId?: string;
    primaryColor: string;
    secondaryColor: string;
    companyName: string;
  };
  attribution: { author: string; license: string; copyright: string };
  createdAt: string;
  modifiedAt: string;
}

// ---------------------------------------------------------------------------
// Export bundle metadata
// ---------------------------------------------------------------------------

export interface CompatibilityReportEntry {
  requirement: string;
  status: "ok" | "missing" | "unsupported" | "flattened" | "warning";
  detail: string;
}

export interface CompatibilityReport {
  target: string;
  generatedAt: string;
  entries: CompatibilityReportEntry[];
  ok: boolean;
}

export interface ExportBundleFile {
  path: string;
  /** base64 for binary (png/zip), utf8 for text. */
  encoding: "base64" | "utf8";
  content: string;
}

export interface ExportBundle {
  kind: "workadventure-character" | "fundexecs-character" | "map";
  name: string;
  files: ExportBundleFile[];
  report: CompatibilityReport;
}
