// lib/office/portraitPrompt.ts
// Turns a member's AvatarConfig into a text prompt for the AI portrait
// generator (lib/office/imagegen.ts). The portrait is the "hero" rendering of a
// character — a persona-style pixel-art bust shown in the Character Studio and
// on the roster card — while the procedural sprite (lib/office/avatarSprite.ts)
// keeps walking the floor. Both read the same config, so the two stay in sync.
//
// Pure + deterministic: given a config it returns the same string, with no I/O.
// It only reads the shared catalogs so the wording always tracks the labels a
// member actually picked in the Studio.
import {
  ACCESSORIES,
  BODY_TYPES,
  EXPRESSIONS,
  EYEWEAR,
  FACIAL_HAIR,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADWEAR,
  HOLDING,
  OUTFITS,
  OUTFIT_COLORS,
  SKIN_TONES,
  normalizeAvatarConfig,
  type AvatarConfig,
  type AvatarOption,
} from "./avatarConfig";

/** Lower-cased label for an id, or "" when the id is the catalog's "none". */
function labelOf(catalog: readonly AvatarOption[], id: string): string {
  const opt = catalog.find((o) => o.id === id);
  if (!opt || opt.id === "none") return "";
  return opt.label.toLowerCase();
}

/** The visual style contract that makes a portrait read like the office cast:
 * 16-bit chibi pixel-art, big rounded head, thick outline, soft warm shading. */
const STYLE_PREAMBLE =
  "16-bit chibi pixel-art business character portrait, single character, " +
  "front-facing bust from the chest up, big rounded friendly head, large " +
  "expressive eyes, thick dark outline, soft cel shading with warm highlights, " +
  "clean limited palette, crisp pixels, centered composition, flat plain " +
  "transparent background, no text, no watermark, no border";

/**
 * Build the portrait generation prompt for a character. The result is a compact,
 * comma-separated description: the fixed style contract first, then the member's
 * resolved appearance (skin, hair, facial hair, outfit + color, eyewear,
 * headwear, worn accessory, held prop, expression), then a quality suffix. Any
 * "none" selection is simply omitted so the prompt never asks for "no glasses".
 */
export function portraitPromptFor(input: AvatarConfig): string {
  const c = normalizeAvatarConfig(input);

  const build = labelOf(BODY_TYPES, c.body);
  const skin = labelOf(SKIN_TONES, c.skin);
  const hairStyle = labelOf(HAIR_STYLES, c.hair);
  const hairColor = labelOf(HAIR_COLORS, c.hairColor);
  const facialHair = labelOf(FACIAL_HAIR, c.facialHair);
  const expression = labelOf(EXPRESSIONS, c.expression);
  const outfit = labelOf(OUTFITS, c.outfit);
  const outfitColor = labelOf(OUTFIT_COLORS, c.outfitColor);
  const eyewear = labelOf(EYEWEAR, c.eyewear);
  const headwear = labelOf(HEADWEAR, c.headwear);
  const accessory = labelOf(ACCESSORIES, c.accessories);
  const holding = labelOf(HOLDING, c.holding);

  const parts: string[] = [];

  // Hair (style + color) reads best as one phrase; "bald" carries no color.
  if (hairStyle === "bald") parts.push("bald head");
  else if (hairStyle) parts.push(`${hairColor} ${hairStyle} hair`.trim());

  if (skin) parts.push(`${skin} skin tone`);
  if (build) parts.push(`${build} build`);
  if (facialHair) parts.push(facialHair === "clean" ? "clean-shaven" : facialHair);
  if (outfit) parts.push(outfitColor ? `wearing a ${outfitColor} ${outfit}` : `wearing a ${outfit}`);
  if (eyewear) parts.push(`wearing ${eyewear}`);
  if (headwear) parts.push(`wearing a ${headwear}`);
  if (accessory) parts.push(`with a ${accessory}`);
  if (holding) parts.push(`holding a ${holding}`);
  if (expression) parts.push(`${expression} expression`);

  const description = parts.join(", ");
  return `${STYLE_PREAMBLE}. A professional office worker: ${description}.`;
}
