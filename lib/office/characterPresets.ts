// lib/office/characterPresets.ts
// The ready-made office characters a member can pick in the Character Studio.
// Each preset points at a pre-rendered walk ATLAS in the office's canonical
// format (768×1024, 3 cols × 4 rows of 256px cells; rows = down/up/left/right,
// 3 walk frames) — the exact layout the office floor renders for staff and for
// the member's "you" avatar (public/office/map.html). The atlases were sliced
// from the source sprite sheets by scripts/office/slice-characters.mjs.
//
// Picking a preset stores its id on AvatarConfig.preset; the office then renders
// that atlas directly instead of the procedural sprite (lib/office/avatarSprite).

export interface CharacterPreset {
  /** Stable id, persisted on AvatarConfig.preset. */
  id: string;
  /** Short human label shown on the picker tile. */
  label: string;
  /** Public path to the 768×1024 walk atlas. */
  atlas: string;
  /** Public path to the front portrait used on the picker tile. */
  portrait: string;
}

const BASE = "/assets/fundexecs/user-characters";
const preset = (id: string, label: string): CharacterPreset => ({
  id,
  label,
  atlas: `${BASE}/${id}/walk.png`,
  portrait: `${BASE}/${id}/portrait.png`,
});

/** The curated gallery order. */
export const CHARACTER_PRESETS: readonly CharacterPreset[] = [
  preset("auburn-hoodie", "Auburn curls, grey hoodie"),
  preset("blue-shirt", "Blue shirt, brown hair"),
  preset("green-sweater", "Green sweater, glasses"),
  preset("maroon-shirt", "Maroon shirt, dark hair"),
  preset("navy-beard", "Navy shirt, beard"),
  preset("gold-blouse", "Gold blouse, locs"),
  preset("teal-blazer", "Teal blazer, long hair"),
  preset("lavender-cardigan", "Lavender cardigan, blonde"),
  preset("emerald-wave", "Emerald top, wavy hair"),
  preset("coral-jacket", "Coral jacket, brown hair"),
] as const;

const BY_ID = new Map(CHARACTER_PRESETS.map((p) => [p.id, p]));

/** Whether an id names a known preset. */
export const isCharacterPreset = (id: unknown): id is string =>
  typeof id === "string" && BY_ID.has(id);

/** Resolve a preset by id, or null when the id is unknown / empty. */
export const getCharacterPreset = (id: string | null | undefined): CharacterPreset | null =>
  (id && BY_ID.get(id)) || null;
