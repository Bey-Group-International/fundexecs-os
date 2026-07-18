/**
 * Human user avatar for the Executive Floor.
 *
 * The floor is populated by AI *executive agents* (see
 * `components/virtual-office/avatar/avatarPalette.ts`), each rendered from an
 * {@link AvatarSpec}. A signed-in human needs their *own* figure that is
 * visibly a person — not one of the AI agents and never the gold-coin mascot.
 * This module owns that human identity: a small, serializable
 * {@link UserAvatar} the user picks (gender presentation, wardrobe, accent,
 * role label, display name) plus the pure mapping that turns it into the same
 * {@link AvatarSpec} the Canvas2D / Phaser renderers already understand.
 *
 * Design goals:
 *  - **Dependency-free.** No React, no renderer imports beyond the `AvatarSpec`
 *    *type*. Safe to import on the server (e.g. when reading `user_metadata`).
 *  - **Deterministic.** Skin and hair tones derive from the display name, so a
 *    given user always looks the same across sessions and devices.
 *  - **Never a coin.** `kind` is always `"user"` and `coin` is always `false`.
 *
 * Colors are 0xRRGGBB integers to match the renderer, except {@link UserAvatar}
 * `accent`, which is a `#rrggbb` hex string so it round-trips cleanly through
 * JSON `user_metadata` and HTML swatch inputs.
 */

import type {
  AvatarSpec,
  AvatarBuild,
  AvatarHairStyle,
  AvatarGlasses,
  AvatarFacialHair,
} from "@/components/virtual-office/avatar/avatarPalette";

/**
 * A human user's chosen appearance. Small and JSON-serializable so it can live
 * in Supabase `user_metadata` and be validated with {@link parseUserAvatar}.
 */
export type UserAvatar = {
  /** Name shown on the floor label and in the picker. */
  displayName: string;
  /** Body / hair presentation. Drives build + hair silhouette. */
  genderStyle: "male" | "female" | "neutral";
  /** Wardrobe id — indexes into {@link WARDROBES}. */
  wardrobe: string;
  /** Signature accent (tie / pocket square) as a `#rrggbb` hex string. */
  accent: string;
  /** Private-market operator role, shown under the name. */
  roleLabel: string;
  /**
   * Optional explicit appearance overrides. When absent, skin/hair derive
   * deterministically from the display name and hairStyle/build follow the
   * {@link UserAvatar.genderStyle} preset — so avatars saved before these
   * fields existed still render exactly as before.
   */
  /** Explicit skin tone (`#rrggbb`); falls back to a name-derived tone. */
  skin?: string;
  /** Explicit hair color (`#rrggbb`); falls back to a name-derived tone. */
  hair?: string;
  /** Explicit hair silhouette; falls back to the presentation preset. */
  hairStyle?: AvatarHairStyle;
  /** Explicit body build; falls back to the presentation preset. */
  build?: AvatarBuild;
  /** Optional eyewear. Defaults to "none". */
  glasses?: AvatarGlasses;
  /** Optional facial hair. Defaults to "none". */
  facialHair?: AvatarFacialHair;
};

/** Selectable eyewear + facial-hair options for the character picker. */
export const GLASSES_OPTIONS: AvatarGlasses[] = ["none", "glasses"];
export const FACIAL_HAIR_OPTIONS: AvatarFacialHair[] = ["none", "stubble", "mustache", "beard"];

/** One executive wardrobe: a coordinated blazer / shirt / trouser palette. */
export type Wardrobe = {
  /** Stable id persisted in {@link UserAvatar.wardrobe}. */
  id: string;
  /** Human-readable label for the picker. */
  label: string;
  /** Blazer / jacket color (0xRRGGBB). */
  suit: number;
  /** Shirt / blouse color (0xRRGGBB). */
  shirt: number;
  /** Trouser / skirt color (0xRRGGBB). */
  trouser: number;
};

/**
 * Five tasteful executive wardrobes. Suit and shirt tones are drawn from the
 * same muted professional spread `avatarPalette` uses for the AI agents
 * (charcoal / navy / slate / graphite / espresso), each paired with a slightly
 * darker trouser so the figure reads with a grounded lower half.
 */
export const WARDROBES: Wardrobe[] = [
  { id: "charcoal", label: "Charcoal", suit: 0x2b2f38, shirt: 0xe8eef5, trouser: 0x23262d },
  { id: "navy", label: "Navy", suit: 0x1f2a3d, shirt: 0xdfe6ee, trouser: 0x18202f },
  { id: "slate", label: "Slate", suit: 0x33383f, shirt: 0xeaf0f6, trouser: 0x262b31 },
  { id: "graphite", label: "Graphite", suit: 0x262b33, shirt: 0xf2ede2, trouser: 0x1c2027 },
  { id: "espresso", label: "Espresso", suit: 0x3a2f2a, shirt: 0xf2ede2, trouser: 0x2a221e },
  // Expanded set — more executive palettes to choose from.
  { id: "midnight", label: "Midnight", suit: 0x1a2436, shirt: 0xdbe4f0, trouser: 0x141b29 },
  { id: "olive", label: "Olive", suit: 0x3b3d2a, shirt: 0xeef0e2, trouser: 0x2c2e1f },
  { id: "oxblood", label: "Oxblood", suit: 0x3d2226, shirt: 0xf0e6e2, trouser: 0x2b1619 },
  { id: "dove", label: "Dove", suit: 0x4a4e57, shirt: 0xf2f5f9, trouser: 0x3a3d45 },
  { id: "ink", label: "Ink", suit: 0x1c1c22, shirt: 0xe6e8ee, trouser: 0x141419 },
];

/**
 * Signature accent colors (tie / pocket square). Gold leads — it is the
 * office's house color — followed by a few restrained executive tones.
 */
export const AVATAR_ACCENTS: string[] = [
  "#c9a84c", // gold (house color)
  "#9b3b47", // burgundy
  "#2f8f83", // teal
  "#3a6ea5", // royal blue
  "#3f7d4f", // forest green
  "#9aa4b2", // silver
  "#b87333", // copper
  "#7d4a8f", // plum
  "#4aa3d6", // sky
  "#d9694a", // coral
];

/**
 * Selectable skin tones and hair colors, as `#rrggbb` strings so they
 * round-trip through JSON `user_metadata`. These mirror the module-local
 * SKIN / HAIR spreads (same values, same order) used for name-derived
 * fallbacks, so a chosen swatch and the auto-assigned default look identical.
 */
// The first six mirror the name-derived SKIN / HAIR fallback spreads (below);
// the remainder are extra selectable tones. Keep the leading six in order so
// the auto-assigned default always maps onto a shown swatch.
export const SKIN_TONES: string[] = ["#f1c9a5", "#e0a878", "#c68642", "#8d5524", "#ffdbb0", "#d9a066", "#f7d9bf", "#a9713f", "#5b3820"];
export const HAIR_COLORS: string[] = ["#2b2320", "#4a3728", "#6b4a2f", "#1a1a1a", "#8a8a8a", "#3a2a1a", "#6e3b1f", "#cdb894", "#b0b0b8"];

/** Selectable hair silhouettes and body builds the renderer supports. */
export const HAIR_STYLES: AvatarHairStyle[] = ["short", "textured", "tied", "bald"];
export const BUILDS: AvatarBuild[] = ["slim", "regular", "broad"];

/**
 * The hair-style + build a presentation preset seeds. The picker applies these
 * when the user switches Male/Female/Neutral, but the user can then override
 * either independently, and the same values are the render-time fallback when a
 * stored avatar has no explicit `hairStyle` / `build`.
 */
export function presentationDefaults(g: UserAvatar["genderStyle"]): { hairStyle: AvatarHairStyle; build: AvatarBuild } {
  if (g === "female") return { hairStyle: "tied", build: "slim" };
  if (g === "male") return { hairStyle: "short", build: "broad" };
  return { hairStyle: "short", build: "regular" };
}

/** Private-market operator roles a user can present as. */
export const ROLE_LABELS: string[] = [
  "Managing Partner",
  "Operating Partner",
  "Capital Partner",
  "Principal",
  "Associate",
  "Analyst",
  "Deal Lead",
  "CFO",
  "Investor Relations",
  "Advisor",
  "Operator",
];

/**
 * The out-of-the-box user avatar: a neutral figure in the first wardrobe
 * (Charcoal) with the house gold accent, labeled "Managing Partner" and named
 * "You". Used as the fallback whenever stored metadata is missing or invalid.
 */
export const DEFAULT_USER_AVATAR: UserAvatar = {
  displayName: "You",
  genderStyle: "neutral",
  wardrobe: WARDROBES[0].id,
  accent: AVATAR_ACCENTS[0],
  roleLabel: ROLE_LABELS[0],
};

/**
 * A curated one-click look. Appearance only — applying a preset never touches
 * the display name or role, so an operator keeps their identity while trying on
 * a coordinated wardrobe/accent/silhouette. Every field references an existing
 * swatch/enum so a preset always round-trips cleanly through {@link parseUserAvatar}.
 */
export type AvatarPreset = {
  id: string;
  label: string;
  genderStyle: UserAvatar["genderStyle"];
  wardrobe: string;
  accent: string;
  skin: string;
  hair: string;
  hairStyle: AvatarHairStyle;
  build: AvatarBuild;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "closer",     label: "The Closer",     genderStyle: "male",    wardrobe: "charcoal", accent: "#c9a84c", skin: "#e0a878", hair: "#2b2320", hairStyle: "short",    build: "broad"   },
  { id: "strategist", label: "The Strategist", genderStyle: "female",  wardrobe: "navy",     accent: "#2f8f83", skin: "#f1c9a5", hair: "#4a3728", hairStyle: "tied",     build: "slim"    },
  { id: "rainmaker",  label: "The Rainmaker",  genderStyle: "male",    wardrobe: "espresso", accent: "#9b3b47", skin: "#c68642", hair: "#1a1a1a", hairStyle: "textured", build: "regular" },
  { id: "analyst",    label: "The Analyst",    genderStyle: "neutral", wardrobe: "slate",    accent: "#4aa3d6", skin: "#ffdbb0", hair: "#6b4a2f", hairStyle: "short",    build: "slim"    },
  { id: "diplomat",   label: "The Diplomat",   genderStyle: "female",  wardrobe: "dove",     accent: "#7d4a8f", skin: "#8d5524", hair: "#2b2320", hairStyle: "tied",     build: "regular" },
  { id: "founder",    label: "The Founder",    genderStyle: "male",    wardrobe: "midnight", accent: "#b87333", skin: "#d9a066", hair: "#3a2a1a", hairStyle: "textured", build: "broad"   },
  { id: "steward",    label: "The Steward",    genderStyle: "neutral", wardrobe: "ink",      accent: "#64748b", skin: "#f7d9bf", hair: "#8a8a8a", hairStyle: "short",    build: "regular" },
  { id: "builder",    label: "The Builder",    genderStyle: "female",  wardrobe: "olive",    accent: "#3f7d4f", skin: "#a9713f", hair: "#1a1a1a", hairStyle: "textured", build: "regular" },
];

/** Apply a preset's look to an avatar, preserving its display name and role. */
export function applyAvatarPreset(a: UserAvatar, p: AvatarPreset): UserAvatar {
  return {
    ...a,
    genderStyle: p.genderStyle,
    wardrobe: p.wardrobe,
    accent: p.accent,
    skin: p.skin,
    hair: p.hair,
    hairStyle: p.hairStyle,
    build: p.build,
  };
}

// A small spread of natural skin/hair tones, mirroring avatarPalette's SKIN /
// HAIR arrays so a user reads as part of the same team. Duplicated (not
// imported) to keep this module dependency-free and server-safe.
const SKIN = [0xf1c9a5, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbb0, 0xd9a066];
const HAIR = [0x2b2320, 0x4a3728, 0x6b4a2f, 0x1a1a1a, 0x8a8a8a, 0x3a2a1a];

/** Deterministic index into `arr` from a string key (stable hash). */
function pick<T>(arr: T[], key: string, salt = 0): T {
  let h = salt;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
  return arr[h % arr.length];
}

/** Parse a `#rrggbb` (or `rrggbb`) hex string to a 0xRRGGBB int. */
function hexToInt(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

/** Format a 0xRRGGBB int as a `#rrggbb` string. */
function intToHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** True for a `#rrggbb` or `rrggbb` hex string. */
function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v);
}

/**
 * The effective skin tone hex — the explicit override if set, else the
 * deterministic name-derived tone. Lets the picker highlight the tone the
 * figure is actually rendering, whether chosen or auto-assigned.
 */
export function effectiveSkin(a: UserAvatar): string {
  return isHex(a.skin) ? intToHex(hexToInt(a.skin!)) : intToHex(pick(SKIN, a.displayName || "You", 3));
}

/** The effective hair color hex — explicit override if set, else name-derived. */
export function effectiveHair(a: UserAvatar): string {
  return isHex(a.hair) ? intToHex(hexToInt(a.hair!)) : intToHex(pick(HAIR, a.displayName || "You", 7));
}

/** Look up a wardrobe by id, falling back to the first entry. */
function wardrobeFor(id: string): Wardrobe {
  return WARDROBES.find((w) => w.id === id) ?? WARDROBES[0];
}

/**
 * Map a {@link UserAvatar} to the renderer's {@link AvatarSpec}.
 *
 * Presentation → silhouette:
 *  - `female`  → slim build, tied hair (top knot)
 *  - `male`    → broad build, short hair
 *  - `neutral` → regular build, short hair
 *
 * Wardrobe id selects suit / shirt / trouser (fallback: first wardrobe). The
 * accent hex becomes the tie/pocket-square color. Skin and hair tones are
 * chosen deterministically from the display name so the figure is stable.
 * `kind` is always `"user"` and `coin` is always `false` — a user is never the
 * coin mascot.
 */
export function userAvatarSpec(a: UserAvatar): AvatarSpec {
  const w = wardrobeFor(a.wardrobe);
  const accentHex = /^#?[0-9a-fA-F]{6}$/.test(a.accent)
    ? a.accent
    : DEFAULT_USER_AVATAR.accent;

  // Explicit appearance overrides win; otherwise fall back to the presentation
  // preset (build / hair style) and the name-derived tones (skin / hair) — so
  // avatars saved before these controls existed render exactly as before.
  const preset = presentationDefaults(a.genderStyle);
  const build: AvatarSpec["build"] = BUILDS.includes(a.build as AvatarBuild) ? a.build : preset.build;
  const hairStyle: AvatarSpec["hairStyle"] = HAIR_STYLES.includes(a.hairStyle as AvatarHairStyle)
    ? a.hairStyle
    : preset.hairStyle;
  const skin = isHex(a.skin) ? hexToInt(a.skin) : pick(SKIN, a.displayName || "You", 3);
  const hair = isHex(a.hair) ? hexToInt(a.hair) : pick(HAIR, a.displayName || "You", 7);

  return {
    skin,
    hair,
    suit: w.suit,
    shirt: w.shirt,
    accent: hexToInt(accentHex),
    trouser: w.trouser,
    kind: "user",
    prop: "none",
    build,
    hairStyle,
    glasses: GLASSES_OPTIONS.includes(a.glasses as AvatarGlasses) ? a.glasses : "none",
    facialHair: FACIAL_HAIR_OPTIONS.includes(a.facialHair as AvatarFacialHair) ? a.facialHair : "none",
    coin: false,
  };
}

/** Narrow an unknown to one of the valid gender styles. */
function isGenderStyle(v: unknown): v is UserAvatar["genderStyle"] {
  return v === "male" || v === "female" || v === "neutral";
}

/**
 * Safely validate an unknown value (typically from Supabase `user_metadata`)
 * into a {@link UserAvatar}.
 *
 * Returns `null` when `raw` is not a plain object or lacks a valid
 * `genderStyle`. String fields fall back to {@link DEFAULT_USER_AVATAR} when
 * missing or of the wrong type. Unknown `wardrobe` ids and malformed / unknown
 * `accent` values are clamped to the defaults so the result always renders.
 */
export function parseUserAvatar(raw: unknown): UserAvatar | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (!isGenderStyle(o.genderStyle)) return null;

  const displayName =
    typeof o.displayName === "string" && o.displayName.trim()
      ? o.displayName
      : DEFAULT_USER_AVATAR.displayName;

  const wardrobe =
    typeof o.wardrobe === "string" && WARDROBES.some((w) => w.id === o.wardrobe)
      ? o.wardrobe
      : DEFAULT_USER_AVATAR.wardrobe;

  const accent =
    typeof o.accent === "string" && AVATAR_ACCENTS.includes(o.accent)
      ? o.accent
      : DEFAULT_USER_AVATAR.accent;

  const roleLabel =
    typeof o.roleLabel === "string" && o.roleLabel.trim()
      ? o.roleLabel
      : DEFAULT_USER_AVATAR.roleLabel;

  // Optional appearance overrides — only kept when they name a valid swatch /
  // enum. Anything unknown is dropped so the render-time fallback applies.
  const skin = typeof o.skin === "string" && SKIN_TONES.includes(o.skin) ? o.skin : undefined;
  const hair = typeof o.hair === "string" && HAIR_COLORS.includes(o.hair) ? o.hair : undefined;
  const hairStyle = HAIR_STYLES.includes(o.hairStyle as AvatarHairStyle)
    ? (o.hairStyle as AvatarHairStyle)
    : undefined;
  const build = BUILDS.includes(o.build as AvatarBuild) ? (o.build as AvatarBuild) : undefined;
  // Only keep eyewear / facial hair when they name a valid option and aren't the
  // "none" default — so a plain avatar stays free of these keys (backward compat).
  const glasses =
    GLASSES_OPTIONS.includes(o.glasses as AvatarGlasses) && o.glasses !== "none"
      ? (o.glasses as AvatarGlasses)
      : undefined;
  const facialHair =
    FACIAL_HAIR_OPTIONS.includes(o.facialHair as AvatarFacialHair) && o.facialHair !== "none"
      ? (o.facialHair as AvatarFacialHair)
      : undefined;

  return {
    displayName,
    genderStyle: o.genderStyle,
    wardrobe,
    accent,
    roleLabel,
    ...(skin ? { skin } : {}),
    ...(hair ? { hair } : {}),
    ...(hairStyle ? { hairStyle } : {}),
    ...(build ? { build } : {}),
    ...(glasses ? { glasses } : {}),
    ...(facialHair ? { facialHair } : {}),
  };
}
