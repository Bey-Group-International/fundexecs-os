// Turns an AvatarConfig into a deterministic, premium-headshot image prompt.
//
// PURE and side-effect free (no DOM, no env, no I/O) — safe to import anywhere,
// server or client, and trivially unit-testable. The same config always yields
// the same string, so a cached portrait can be keyed on the prompt if desired.
//
// The catalog values (hex swatches, style enums) are mapped to human-readable
// descriptors here; anything outside the catalog degrades to a literal token so
// a stale/hand-edited config still produces a usable prompt rather than throwing.

import {
  type AvatarConfig,
  SKIN_TONES,
  HAIR_COLORS,
  EYE_COLORS,
  OUTFIT_COLORS,
} from "@/lib/office/avatarConfig";

// A fixed tail appended to every prompt: the studio look plus lightweight
// safety framing. Kept as a named export so tests and the provider guard can
// reference the exact wording.
export const SAFE_STYLE_SUFFIX =
  "soft key lighting, shallow depth of field, neutral studio background, " +
  "high detail, sharp focus, corporate, tasteful, fully clothed, " +
  "single person, safe for work";

const zip = <T extends string>(hexes: string[], labels: T[]): Record<string, T> =>
  hexes.reduce<Record<string, T>>((acc, hex, i) => {
    acc[hex] = labels[i];
    return acc;
  }, {});

// Descriptor tables are index-aligned with the catalogs in avatarConfig.ts.
const SKIN_LABELS = zip(SKIN_TONES, [
  "fair",
  "light",
  "light tan",
  "tan",
  "medium brown",
  "brown",
  "deep brown",
  "dark brown",
]);

const HAIR_COLOR_LABELS = zip(HAIR_COLORS, [
  "black",
  "dark brown",
  "brown",
  "light brown",
  "blonde",
  "grey",
  "auburn",
  "violet",
]);

const EYE_LABELS = zip(EYE_COLORS, [
  "dark brown",
  "brown",
  "green",
  "blue",
  "grey",
]);

const OUTFIT_COLOR_LABELS = zip(OUTFIT_COLORS, [
  "indigo",
  "sky blue",
  "teal",
  "orange",
  "lime green",
  "rose",
  "purple",
  "gold",
  "charcoal",
  "light grey",
]);

const HAIR_STYLE_LABELS: Record<AvatarConfig["hair"], string> = {
  short: "short hair",
  long: "long hair",
  bun: "hair tied in a bun",
  buzz: "a buzz cut",
  bald: "a shaved bald head",
  ponytail: "a ponytail",
  curly: "curly hair",
  mohawk: "a mohawk",
};

const OUTFIT_STYLE_LABELS: Record<AvatarConfig["outfit"], string> = {
  tee: "a t-shirt",
  blazer: "a tailored blazer",
  hoodie: "a hoodie",
  turtleneck: "a turtleneck",
  dress_shirt: "a crisp dress shirt",
  vneck: "a v-neck sweater",
};

const FACIAL_HAIR_LABELS: Record<AvatarConfig["facialHair"], string | null> = {
  none: null,
  stubble: "light stubble",
  beard: "a full beard",
  mustache: "a mustache",
};

const ACCESSORY_LABELS: Record<AvatarConfig["accessory"], string | null> = {
  none: null,
  glasses: "wearing glasses",
  sunglasses: "wearing sunglasses",
  headset: "wearing a headset",
  cap: "wearing a cap",
  beanie: "wearing a beanie",
  earrings: "wearing earrings",
};

const BUILD_LABELS: Record<AvatarConfig["build"], string> = {
  slim: "a slim build",
  regular: "an average build",
  broad: "a broad build",
};

const label = <T extends string>(map: Record<string, T>, key: string): string =>
  map[key] ?? key;

/**
 * Build a deterministic, premium studio-headshot prompt from an avatar config.
 * Describes skin tone, hairstyle + color, eye color, outfit style + color,
 * build, and (when present) facial hair and accessory, then appends the shared
 * style/safety suffix. Same config in → same string out.
 */
export function portraitPrompt(config: AvatarConfig): string {
  const skin = label(SKIN_LABELS, config.skin);
  const hairColor = label(HAIR_COLOR_LABELS, config.hairColor);
  const hair = HAIR_STYLE_LABELS[config.hair] ?? config.hair;
  const eyes = label(EYE_LABELS, config.eyes);
  const outfit = OUTFIT_STYLE_LABELS[config.outfit] ?? config.outfit;
  const outfitColor = label(OUTFIT_COLOR_LABELS, config.outfitColor);
  const build = BUILD_LABELS[config.build] ?? config.build;

  const traits: string[] = [
    `${skin} skin`,
    config.hair === "bald" ? hair : `${hairColor} ${hair}`,
    `${eyes} eyes`,
    `${build}`,
  ];

  const facialHair = FACIAL_HAIR_LABELS[config.facialHair];
  if (facialHair) traits.push(facialHair);

  const accessory = ACCESSORY_LABELS[config.accessory];
  if (accessory) traits.push(accessory);

  const wearing = `wearing ${outfitColor} ${outfit}`;

  return (
    `Professional studio headshot portrait of a person with ` +
    `${traits.join(", ")}, ${wearing}, ` +
    `${SAFE_STYLE_SUFFIX}`
  );
}
