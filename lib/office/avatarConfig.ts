// The avatar contract for the Virtual Office's pixel-art characters.
//
// A small, serializable description of how a character looks. The pixel-sprite
// engine reads it to compose a sprite; the customizer edits it; the presence
// payload broadcasts it; office_member_prefs persists it. Kept as plain data
// (no DOM) so it is safe to import anywhere — server actions included.

export interface AvatarConfig {
  /** Skin fill (hex) — face and hands. */
  skin: string;
  /** Hairstyle key; the sprite engine implements exactly these. */
  hair: HairStyle;
  /** Hair fill (hex). */
  hairColor: string;
  /** Shirt / torso fill (hex). */
  shirt: string;
  /** Worn accessory; "none" for bare. */
  accessory: Accessory;
}

export type HairStyle = "short" | "long" | "bun" | "buzz" | "bald";
export type Accessory = "none" | "glasses" | "headset" | "cap" | "beanie";

export const HAIR_STYLES: HairStyle[] = ["short", "long", "bun", "buzz", "bald"];
export const ACCESSORIES: Accessory[] = [
  "none",
  "glasses",
  "headset",
  "cap",
  "beanie",
];

// Curated, theme-neutral swatches. Order is stable — the deterministic
// fallback picks by index, so don't reorder without intending to reshuffle.
export const SKIN_TONES: string[] = [
  "#f6d0b0",
  "#eab58e",
  "#d69f6e",
  "#b57a48",
  "#8a5a34",
  "#5c3a22",
];

export const HAIR_COLORS: string[] = [
  "#2b2320",
  "#54331b",
  "#8a5a2b",
  "#caa14a",
  "#9aa0a6",
  "#c65b3a",
];

export const SHIRT_COLORS: string[] = [
  "#6366f1",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#84cc16",
  "#06b6d4",
  "#a855f7",
  "#eab308",
];

export const DEFAULT_AVATAR: AvatarConfig = {
  skin: SKIN_TONES[1],
  hair: "short",
  hairColor: HAIR_COLORS[0],
  shirt: SHIRT_COLORS[0],
  accessory: "none",
};

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic avatar from an id — the fallback when a member hasn't set one. */
export function avatarForId(id: string): AvatarConfig {
  const h = hash(id);
  return {
    skin: SKIN_TONES[h % SKIN_TONES.length],
    hair: HAIR_STYLES[(h >> 3) % HAIR_STYLES.length],
    hairColor: HAIR_COLORS[(h >> 6) % HAIR_COLORS.length],
    shirt: SHIRT_COLORS[(h >> 9) % SHIRT_COLORS.length],
    accessory: ACCESSORIES[(h >> 12) % ACCESSORIES.length],
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
  return {
    skin: hex(r.skin, SKIN_TONES, base.skin),
    hair: pick(r.hair, HAIR_STYLES, base.hair),
    hairColor: hex(r.hairColor, HAIR_COLORS, base.hairColor),
    shirt: hex(r.shirt, SHIRT_COLORS, base.shirt),
    accessory: pick(r.accessory, ACCESSORIES, base.accessory),
  };
}

export type Facing = "down" | "up" | "left" | "right";
