// lib/office/avatarConfig.ts
// The "you" character — a compact, serializable AvatarConfig for a Virtual
// Office member. This is the module the `office_member_prefs.avatar` jsonb
// column has been reserved for since migration 20260720140000
// (office_member_avatar): each member designs their own paper-doll character in
// the Character Builder (app/(app)/office/builder) and it persists here.
//
// Design constraints (mirrors docs/avatars/AVATAR_SYSTEM_SPEC.md §4):
//   • Curated + accessible: every appearance choice is an id into a fixed
//     catalog of contrast-checked options — no free-form colors — so the
//     character always reads cleanly against the office floor and stays
//     deterministic (same config → same avatar on every client).
//   • Small + versioned: the whole character is a handful of string ids plus a
//     schema version, cheap to store in jsonb and forward-compatible.
//   • Renderer-agnostic data: this module holds ZERO drawing code — the pixel
//     sprite generator (lib/office/avatarSprite.ts) reads the resolved catalog
//     values. The same config could later drive a richer rig.

export const AVATAR_CONFIG_VERSION = 1 as const;

/** One selectable option in an appearance catalog. */
export interface AvatarOption {
  id: string;
  label: string;
}

/** A color option carries the resolved hex the renderer paints with. */
export interface AvatarColorOption extends AvatarOption {
  hex: string;
}

/** A body build affects the torso/shoulder silhouette. */
export const BODY_TYPES: readonly AvatarOption[] = [
  { id: "slim", label: "Slim" },
  { id: "regular", label: "Regular" },
  { id: "broad", label: "Broad" },
] as const;

/** Curated, contrast-checked skin tones (10). */
export const SKIN_TONES: readonly AvatarColorOption[] = [
  { id: "porcelain", label: "Porcelain", hex: "#f4d9c4" },
  { id: "fair", label: "Fair", hex: "#efc0a0" },
  { id: "light", label: "Light", hex: "#e3aa82" },
  { id: "tan", label: "Tan", hex: "#d8a074" },
  { id: "olive", label: "Olive", hex: "#c68b6a" },
  { id: "honey", label: "Honey", hex: "#b3793f" },
  { id: "brown", label: "Brown", hex: "#a3663f" },
  { id: "umber", label: "Umber", hex: "#82502f" },
  { id: "espresso", label: "Espresso", hex: "#71442a" },
  { id: "deep", label: "Deep", hex: "#4d2c1b" },
] as const;

/** Hair silhouettes (10). `bald` intentionally paints no hair. */
export const HAIR_STYLES: readonly AvatarOption[] = [
  { id: "bald", label: "Bald" },
  { id: "buzz", label: "Buzz" },
  { id: "short", label: "Short" },
  { id: "side", label: "Side part" },
  { id: "curly", label: "Curly" },
  { id: "afro", label: "Afro" },
  { id: "spiky", label: "Spiky" },
  { id: "bun", label: "Top bun" },
  { id: "ponytail", label: "Ponytail" },
  { id: "long", label: "Long" },
] as const;

/** Hair colors (also used for facial hair). */
export const HAIR_COLORS: readonly AvatarColorOption[] = [
  { id: "black", label: "Black", hex: "#211b17" },
  { id: "brown", label: "Brown", hex: "#4a3323" },
  { id: "chestnut", label: "Chestnut", hex: "#6f4b2e" },
  { id: "auburn", label: "Auburn", hex: "#8a4a2f" },
  { id: "blonde", label: "Blonde", hex: "#c79a52" },
  { id: "platinum", label: "Platinum", hex: "#d9cbb2" },
  { id: "gray", label: "Gray", hex: "#9aa0a6" },
] as const;

/** Facial hair. `none` paints nothing; the rest tint with the hair color. */
export const FACIAL_HAIR: readonly AvatarOption[] = [
  { id: "none", label: "Clean" },
  { id: "stubble", label: "Stubble" },
  { id: "moustache", label: "Moustache" },
  { id: "goatee", label: "Goatee" },
  { id: "beard", label: "Full beard" },
] as const;

/** Expression drives the mouth + brow of the face layer. */
export const EXPRESSIONS: readonly AvatarOption[] = [
  { id: "neutral", label: "Neutral" },
  { id: "smile", label: "Smile" },
  { id: "focused", label: "Focused" },
] as const;

/** Office attire (10). Each outfit resolves its shape in the renderer; color below. */
export const OUTFITS: readonly AvatarOption[] = [
  { id: "suit", label: "Two-piece suit" },
  { id: "blazer", label: "Blazer & tee" },
  { id: "shirt", label: "Dress shirt" },
  { id: "polo", label: "Polo" },
  { id: "tee", label: "T-shirt" },
  { id: "turtleneck", label: "Turtleneck" },
  { id: "sweater", label: "Sweater" },
  { id: "vest", label: "Suit vest" },
  { id: "hoodie", label: "Quarter-zip" },
  { id: "dress", label: "Sheath dress" },
] as const;

/** Curated garment palette (primary fill), contrast-checked against the floor.
 * The second row mirrors the FundExecs persona signature hues so a member can
 * dress in the staff palette (Curator violet, Lead-Gen orange, PR magenta,
 * Capital-Raiser gold, Exec/SEO royal, Rainmaker emerald). */
export const OUTFIT_COLORS: readonly AvatarColorOption[] = [
  { id: "charcoal", label: "Charcoal", hex: "#2b3240" },
  { id: "navy", label: "Navy", hex: "#1e3a5f" },
  { id: "forest", label: "Forest", hex: "#1f4d38" },
  { id: "burgundy", label: "Burgundy", hex: "#5f2230" },
  { id: "slate", label: "Slate", hex: "#3f4a58" },
  { id: "camel", label: "Camel", hex: "#8a6a3f" },
  { id: "plum", label: "Plum", hex: "#4a2f52" },
  { id: "teal", label: "Teal", hex: "#1f5158" },
  { id: "violet", label: "Violet", hex: "#5b3f8f" },
  { id: "royal", label: "Royal", hex: "#2f56a8" },
  { id: "emerald", label: "Emerald", hex: "#227a4e" },
  { id: "gold", label: "Gold", hex: "#b5892a" },
  { id: "orange", label: "Orange", hex: "#c0602a" },
  { id: "magenta", label: "Magenta", hex: "#a83a72" },
] as const;

/** Eyewear (10). `none` paints nothing. */
export const EYEWEAR: readonly AvatarOption[] = [
  { id: "none", label: "None" },
  { id: "glasses", label: "Glasses" },
  { id: "round", label: "Round" },
  { id: "sunglasses", label: "Sunglasses" },
  { id: "aviators", label: "Aviators" },
  { id: "readers", label: "Readers" },
  { id: "monocle", label: "Monocle" },
  { id: "goggles", label: "Goggles" },
  { id: "visor", label: "Visor" },
  { id: "eyepatch", label: "Eyepatch" },
] as const;

/** Headwear (10). `none` paints nothing; some hats hide the hair top. */
export const HEADWEAR: readonly AvatarOption[] = [
  { id: "none", label: "None" },
  { id: "cap", label: "Ball cap" },
  { id: "beanie", label: "Beanie" },
  { id: "fedora", label: "Fedora" },
  { id: "beret", label: "Beret" },
  { id: "headband", label: "Headband" },
  { id: "headphones", label: "Headphones" },
  { id: "hardhat", label: "Hard hat" },
  { id: "sunvisor", label: "Sun visor" },
  { id: "crown", label: "Crown" },
] as const;

/** Worn accessories (10) — neck/chest/wrist items. `none` paints nothing. */
export const ACCESSORIES: readonly AvatarOption[] = [
  { id: "none", label: "None" },
  { id: "lanyard", label: "Lanyard" },
  { id: "tie_clip", label: "Tie clip" },
  { id: "scarf", label: "Scarf" },
  { id: "watch", label: "Watch" },
  { id: "necklace", label: "Necklace" },
  { id: "earrings", label: "Earrings" },
  { id: "lapel_pin", label: "Lapel pin" },
  { id: "suspenders", label: "Suspenders" },
  { id: "badge", label: "Badge" },
] as const;

/** A held prop, carried in one hand — mirrors how each persona holds a role
 * item (clipboard, money bag). `none` paints empty hands. */
export const HOLDING: readonly AvatarOption[] = [
  { id: "none", label: "Nothing" },
  { id: "briefcase", label: "Briefcase" },
  { id: "coffee", label: "Coffee" },
  { id: "tablet", label: "Tablet" },
  { id: "phone", label: "Phone" },
] as const;

/** Presence status — mirrors the office roster's status ring (STC in map.html). */
export const STATUSES: readonly AvatarColorOption[] = [
  { id: "available", label: "Available", hex: "#34d399" },
  { id: "busy", label: "Busy", hex: "#f5b342" },
  { id: "away", label: "Away", hex: "#94a3b8" },
  { id: "dnd", label: "Do not disturb", hex: "#ef5a6a" },
] as const;

/**
 * A member's character. Appearance is stored as catalog ids (not raw colors) so
 * choices stay curated and forward-compatible; `displayName` is free text.
 */
export interface AvatarConfig {
  v: typeof AVATAR_CONFIG_VERSION;
  displayName: string;
  body: string;
  skin: string;
  hair: string;
  hairColor: string;
  facialHair: string;
  expression: string;
  outfit: string;
  outfitColor: string;
  eyewear: string;
  headwear: string;
  accessories: string;
  holding: string;
  status: string;
}

/** The neutral starting character shown when a member has never saved one. */
export const DEFAULT_AVATAR_CONFIG: AvatarConfig = {
  v: AVATAR_CONFIG_VERSION,
  displayName: "",
  body: "regular",
  skin: "tan",
  hair: "short",
  hairColor: "brown",
  facialHair: "none",
  expression: "neutral",
  outfit: "suit",
  outfitColor: "navy",
  eyewear: "none",
  headwear: "none",
  accessories: "none",
  holding: "none",
  status: "available",
};

/** The longest display name we persist / render. */
export const MAX_DISPLAY_NAME = 40;

// ── Resolution helpers ──────────────────────────────────────────────────────
// Every getter falls back to the catalog's first entry so an unknown id (older
// client, hand-edited jsonb) still renders something valid instead of throwing.

function pick<T extends AvatarOption>(catalog: readonly T[], id: string): T {
  return catalog.find((o) => o.id === id) ?? catalog[0];
}

const isOptionId = (catalog: readonly AvatarOption[], id: unknown): id is string =>
  typeof id === "string" && catalog.some((o) => o.id === id);

export const skinHex = (c: AvatarConfig): string => pick(SKIN_TONES, c.skin).hex;
export const hairHex = (c: AvatarConfig): string => pick(HAIR_COLORS, c.hairColor).hex;
export const outfitHex = (c: AvatarConfig): string => pick(OUTFIT_COLORS, c.outfitColor).hex;
export const statusHex = (c: AvatarConfig): string => pick(STATUSES, c.status).hex;
export const statusLabel = (c: AvatarConfig): string => pick(STATUSES, c.status).label;

/** Two initials for the roster chip, derived from the display name. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "ME";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Coerce anything (a partial config, stale jsonb, `null`) into a valid
 * AvatarConfig: unknown option ids fall back to the default, the display name is
 * trimmed and length-capped, and the version is stamped current. Pure and total
 * — never throws — so it is safe to run on RLS-fed data and on form input alike.
 */
export function normalizeAvatarConfig(input: unknown): AvatarConfig {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  // The catalog-backed (string-valued) fields — everything except `v` and the
  // free-text `displayName`.
  type OptionKey = Exclude<keyof AvatarConfig, "v" | "displayName">;
  const field = (catalog: readonly AvatarOption[], key: OptionKey): string =>
    isOptionId(catalog, src[key]) ? (src[key] as string) : DEFAULT_AVATAR_CONFIG[key];

  const rawName = typeof src.displayName === "string" ? src.displayName : "";

  // Back-compat: an older config carried a single `accessory` id spanning eyewear,
  // headwear, and worn items. Fan it out to the new fields when the new ones are
  // absent, so a saved character keeps its glasses / headset / lanyard.
  const legacy = typeof src.accessory === "string" ? src.accessory : "";
  const src2: Record<string, unknown> = { ...src };
  if (src2.eyewear === undefined && (legacy === "glasses" || legacy === "sunglasses")) src2.eyewear = legacy;
  if (src2.headwear === undefined && legacy === "headset") src2.headwear = "headphones";
  if (src2.accessories === undefined && legacy === "lanyard") src2.accessories = "lanyard";
  const field2 = (catalog: readonly AvatarOption[], key: OptionKey): string =>
    isOptionId(catalog, src2[key]) ? (src2[key] as string) : DEFAULT_AVATAR_CONFIG[key];

  return {
    v: AVATAR_CONFIG_VERSION,
    displayName: rawName.trim().slice(0, MAX_DISPLAY_NAME),
    body: field(BODY_TYPES, "body"),
    skin: field(SKIN_TONES, "skin"),
    hair: field(HAIR_STYLES, "hair"),
    hairColor: field(HAIR_COLORS, "hairColor"),
    facialHair: field(FACIAL_HAIR, "facialHair"),
    expression: field(EXPRESSIONS, "expression"),
    outfit: field(OUTFITS, "outfit"),
    outfitColor: field(OUTFIT_COLORS, "outfitColor"),
    eyewear: field2(EYEWEAR, "eyewear"),
    headwear: field2(HEADWEAR, "headwear"),
    accessories: field2(ACCESSORIES, "accessories"),
    holding: field(HOLDING, "holding"),
    status: field(STATUSES, "status"),
  };
}
