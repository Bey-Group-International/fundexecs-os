// The avatar contract for the Virtual Office's premium characters.
//
// A small, serializable description of how a character looks. The smooth-vector
// renderer reads it to draw a shaded figure; the customizer edits it; the
// presence payload broadcasts it; office_member_prefs persists it; the AI
// portrait pipeline turns it into a deterministic prompt. Plain data (no DOM),
// safe to import anywhere — server actions included.

import type { MemberRole } from "@/lib/supabase/database.types";

export interface AvatarConfig {
  /** Skin fill (hex). */
  skin: string;
  hair: HairStyle;
  /** Hair fill (hex). */
  hairColor: string;
  /** Iris color (hex). */
  eyes: string;
  outfit: OutfitStyle;
  /** Outfit fill (hex). */
  outfitColor: string;
  facialHair: FacialHair;
  accessory: Accessory;
  /** Body build, scales the silhouette. */
  build: Build;
}

export type HairStyle =
  | "short"
  | "long"
  | "bun"
  | "buzz"
  | "bald"
  | "ponytail"
  | "curly"
  | "mohawk";

export type OutfitStyle =
  | "tee"
  | "blazer"
  | "hoodie"
  | "turtleneck"
  | "dress_shirt"
  | "vneck";

export type Accessory =
  | "none"
  | "glasses"
  | "sunglasses"
  | "headset"
  | "cap"
  | "beanie"
  | "earrings";

export type FacialHair = "none" | "stubble" | "beard" | "mustache";

export type Build = "slim" | "regular" | "broad";

export const HAIR_STYLES: HairStyle[] = [
  "short",
  "long",
  "bun",
  "buzz",
  "bald",
  "ponytail",
  "curly",
  "mohawk",
];
export const OUTFIT_STYLES: OutfitStyle[] = [
  "tee",
  "blazer",
  "hoodie",
  "turtleneck",
  "dress_shirt",
  "vneck",
];
export const ACCESSORIES: Accessory[] = [
  "none",
  "glasses",
  "sunglasses",
  "headset",
  "cap",
  "beanie",
  "earrings",
];
export const FACIAL_HAIR: FacialHair[] = ["none", "stubble", "beard", "mustache"];
export const BUILDS: Build[] = ["slim", "regular", "broad"];

// Curated, theme-neutral swatches. Order is stable — the deterministic fallback
// picks by index, so don't reorder without intending to reshuffle.
export const SKIN_TONES: string[] = [
  "#ffdbb4",
  "#f4c9a1",
  "#eab58e",
  "#d69f6e",
  "#b57a48",
  "#8a5a34",
  "#6b4326",
  "#4a2e1a",
];

export const HAIR_COLORS: string[] = [
  "#1c1a1a",
  "#2b2320",
  "#54331b",
  "#8a5a2b",
  "#caa14a",
  "#b0b6bd",
  "#c65b3a",
  "#6d4bd8",
];

export const EYE_COLORS: string[] = [
  "#3b2a1a",
  "#5b3b1e",
  "#2f6d5a",
  "#2f5da8",
  "#6b7280",
];

// Institutional, tailored palette — muted, low-saturation business tones so the
// floor reads like a fund's office, not a startup. Order is stable (the
// deterministic fallback and the customizer swatch row pick by index):
// charcoal, navy, slate, graphite, camel, ivory, forest, burgundy, brass.
export const OUTFIT_COLORS: string[] = [
  "#2f3541", // charcoal
  "#26314b", // navy
  "#4a5568", // slate
  "#383d45", // graphite
  "#b08d57", // camel
  "#e8e2d4", // ivory
  "#31473b", // forest
  "#6b2c39", // burgundy
  "#9a7d3f", // brass
];

export const DEFAULT_AVATAR: AvatarConfig = {
  skin: SKIN_TONES[1],
  hair: "short",
  hairColor: HAIR_COLORS[1],
  eyes: EYE_COLORS[0],
  outfit: "blazer",
  outfitColor: OUTFIT_COLORS[0], // charcoal blazer
  facialHair: "none",
  accessory: "none",
  build: "regular",
};

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const at = <T>(arr: T[], n: number): T => arr[n % arr.length];

/** Deterministic avatar from an id — the fallback when a member hasn't set one. */
export function avatarForId(id: string): AvatarConfig {
  const h = hash(id);
  return {
    skin: at(SKIN_TONES, h),
    hair: at(HAIR_STYLES, h >> 2),
    hairColor: at(HAIR_COLORS, h >> 4),
    eyes: at(EYE_COLORS, h >> 6),
    outfit: at(OUTFIT_STYLES, h >> 8),
    outfitColor: at(OUTFIT_COLORS, h >> 10),
    facialHair: at(FACIAL_HAIR, h >> 13),
    accessory: at(ACCESSORIES, h >> 15),
    build: at(BUILDS, h >> 18),
  };
}

/** Coerce arbitrary/partial input into a valid config (for persistence reads). */
export function parseAvatar(raw: unknown, fallbackId = "anon"): AvatarConfig {
  const base = avatarForId(fallbackId);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: T[], dflt: T): T =>
    typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : dflt;
  const hex = (v: unknown, allowed: string[], dflt: string): string =>
    typeof v === "string" && allowed.includes(v) ? v : dflt;
  // Legacy rows used `shirt` for the outfit color — carry it forward.
  const legacyOutfit =
    typeof r.shirt === "string" && OUTFIT_COLORS.includes(r.shirt)
      ? r.shirt
      : undefined;
  return {
    skin: hex(r.skin, SKIN_TONES, base.skin),
    hair: pick(r.hair, HAIR_STYLES, base.hair),
    hairColor: hex(r.hairColor, HAIR_COLORS, base.hairColor),
    eyes: hex(r.eyes, EYE_COLORS, base.eyes),
    outfit: pick(r.outfit, OUTFIT_STYLES, base.outfit),
    outfitColor: hex(r.outfitColor, OUTFIT_COLORS, legacyOutfit ?? base.outfitColor),
    facialHair: pick(r.facialHair, FACIAL_HAIR, base.facialHair),
    accessory: pick(r.accessory, ACCESSORIES, base.accessory),
    build: pick(r.build, BUILDS, base.build),
  };
}

// ---------------------------------------------------------------------------
// Cosmetic categories — the tabbed customizer's vocabulary. Each category maps
// to one AvatarConfig field, carries display metadata, exposes its catalog, and
// can be role-gated. Kept here (next to the catalogs) so the gating rules and
// the option lists stay in lock-step. Adding a category means: extend the union,
// add it to COSMETIC_LAYERS + CATEGORY_META, and wire it in categoryOptions.
// ---------------------------------------------------------------------------

export type CosmeticCategory =
  | "skin"
  | "hair"
  | "hairColor"
  | "eyes"
  | "outfit"
  | "outfitColor"
  | "facialHair"
  | "accessory"
  | "build";

/**
 * The ordered category list. Drives the customizer's tab row and documents the
 * intended draw order (skin first, layered cosmetics after) — the same order the
 * fields sit in on AvatarConfig.
 */
export const COSMETIC_LAYERS: CosmeticCategory[] = [
  "skin",
  "hair",
  "hairColor",
  "eyes",
  "outfit",
  "outfitColor",
  "facialHair",
  "accessory",
  "build",
];

/**
 * Per-category display metadata. `kind` tells the customizer which control to
 * render: "swatch" is a color grid (values are hex), "option" is a labeled
 * choice grid (values are enum keys).
 */
export const CATEGORY_META: Record<
  CosmeticCategory,
  { label: string; kind: "swatch" | "option" }
> = {
  skin: { label: "Skin", kind: "swatch" },
  hair: { label: "Hair", kind: "option" },
  hairColor: { label: "Hair color", kind: "swatch" },
  eyes: { label: "Eyes", kind: "swatch" },
  outfit: { label: "Outfit", kind: "option" },
  outfitColor: { label: "Outfit color", kind: "swatch" },
  facialHair: { label: "Facial hair", kind: "option" },
  accessory: { label: "Accessory", kind: "option" },
  build: { label: "Build", kind: "option" },
};

// The AvatarConfig field each category edits — the category names match the
// field names, but this keeps the coupling explicit and type-checked.
const CATEGORY_FIELD: Record<CosmeticCategory, keyof AvatarConfig> = {
  skin: "skin",
  hair: "hair",
  hairColor: "hairColor",
  eyes: "eyes",
  outfit: "outfit",
  outfitColor: "outfitColor",
  facialHair: "facialHair",
  accessory: "accessory",
  build: "build",
};

/** The AvatarConfig field a category writes to (skin, hair, hairColor, …). */
export function categoryField(cat: CosmeticCategory): keyof AvatarConfig {
  return CATEGORY_FIELD[cat];
}

/** The full catalog of option values for a category (before any gating). */
export function categoryOptions(cat: CosmeticCategory): string[] {
  switch (cat) {
    case "skin":
      return SKIN_TONES;
    case "hair":
      return HAIR_STYLES;
    case "hairColor":
      return HAIR_COLORS;
    case "eyes":
      return EYE_COLORS;
    case "outfit":
      return OUTFIT_STYLES;
    case "outfitColor":
      return OUTFIT_COLORS;
    case "facialHair":
      return FACIAL_HAIR;
    case "accessory":
      return ACCESSORIES;
    case "build":
      return BUILDS;
  }
}

// Leadership-only cosmetics. The two richest boardroom outfit tones — burgundy
// and brass — are reserved for owners and admins; everyone else gets the tailored
// business palette. Add future prestige unlocks to this table.
const LEADERSHIP_ROLES: ReadonlySet<MemberRole> = new Set<MemberRole>([
  "owner",
  "admin",
]);

const LEADERSHIP_OUTFIT_COLORS: ReadonlySet<string> = new Set<string>([
  "#6b2c39", // burgundy
  "#9a7d3f", // brass
]);

/**
 * Whether a given cosmetic value is available to a viewer. A predicate seam so
 * the customizer can filter (or lock) options and the persistence layer can
 * validate. Never throws; when the role is unknown (null/undefined) everything
 * is unlocked so anonymous/loading states never hide the base wardrobe.
 */
export function isCosmeticUnlocked(
  cat: CosmeticCategory,
  value: string,
  ctx: { role?: MemberRole | null },
): boolean {
  if (cat === "outfitColor" && LEADERSHIP_OUTFIT_COLORS.has(value)) {
    const role = ctx.role;
    if (!role) return true;
    return LEADERSHIP_ROLES.has(role);
  }
  return true;
}

/** A category's catalog filtered down to the values the viewer may pick. */
export function optionsFor(
  cat: CosmeticCategory,
  ctx: { role?: MemberRole | null },
): string[] {
  return categoryOptions(cat).filter((value) =>
    isCosmeticUnlocked(cat, value, ctx),
  );
}

export type Facing = "down" | "up" | "left" | "right";
