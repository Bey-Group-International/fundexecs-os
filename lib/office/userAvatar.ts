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

import type { AvatarSpec } from "@/components/virtual-office/avatar/avatarPalette";

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
};

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
];

/** Private-market operator roles a user can present as. */
export const ROLE_LABELS: string[] = [
  "Managing Partner",
  "Principal",
  "Associate",
  "Analyst",
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

  const build: AvatarSpec["build"] =
    a.genderStyle === "female" ? "slim" : a.genderStyle === "male" ? "broad" : "regular";
  const hairStyle: AvatarSpec["hairStyle"] = a.genderStyle === "female" ? "tied" : "short";

  return {
    skin: pick(SKIN, a.displayName || "You", 3),
    hair: pick(HAIR, a.displayName || "You", 7),
    suit: w.suit,
    shirt: w.shirt,
    accent: hexToInt(accentHex),
    trouser: w.trouser,
    kind: "user",
    prop: "none",
    build,
    hairStyle,
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

  return { displayName, genderStyle: o.genderStyle, wardrobe, accent, roleLabel };
}
