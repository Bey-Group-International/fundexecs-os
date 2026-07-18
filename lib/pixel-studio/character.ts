/**
 * Character domain — config construction, seeded randomization (with category
 * locks), migration across manifest versions, and compact share serialization.
 */
import { AssetRegistry } from "./asset-registry";
import { SeededRng, seedFromString } from "./rng";
import {
  type AnimationState,
  type AssetCategory,
  type CharacterConfig,
  type Direction,
  type FitGroup,
  type Manifest,
} from "./types";

export const RANDOMIZABLE_CATEGORIES = [
  "skin",
  "face",
  "expression",
  "hair",
  "hairColor",
  "facialHair",
  "headCovering",
  "outfit",
  "accessory",
] as const;
export type RandomizableCategory = (typeof RANDOMIZABLE_CATEGORIES)[number];

let idCounter = 0;
/** Stable-ish id (deterministic in tests when seededId provided). */
export function newCharacterId(seededId?: string): string {
  if (seededId) return `char-${seedFromString(seededId).toString(16)}`;
  idCounter += 1;
  return `char-${idCounter.toString(16)}-${(seedFromString(String(idCounter)) % 0xffff).toString(16)}`;
}

const ISO = "1970-01-01T00:00:00.000Z";

export function defaultConfig(manifest: Manifest, timestamp = ISO): CharacterConfig {
  return {
    characterId: newCharacterId("default"),
    displayName: "New Executive",
    manifestVersion: manifest.packageVersion,
    fitGroup: "universal",
    skinPalette: "skin-olive-03",
    face: "face-m-01",
    expression: "neutral",
    hair: "hair-m-side-part",
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
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
}

/**
 * Seeded randomization. `locked` categories are preserved from `base`. The same
 * (seed, manifest version, locks, base) always yields the same avatar.
 */
export function randomize(
  registry: AssetRegistry,
  base: CharacterConfig,
  seed: number,
  locked: Set<RandomizableCategory> = new Set(),
): CharacterConfig {
  const m = registry.manifest;
  const rng = new SeededRng(seed);
  const next: CharacterConfig = { ...base, seed, modifiedAt: base.modifiedAt };

  const fitGroups: FitGroup[] = ["masculine-fit", "feminine-fit"];
  const fit = locked.has("face") ? base.fitGroup : rng.pick(fitGroups);
  next.fitGroup = fit;

  const pickIn = (cat: AssetCategory): string | null => {
    const opts = registry.compatibleWith(cat, fit);
    return opts.length ? rng.pick(opts).id : null;
  };
  const paletteIn = (group: string): string => {
    const opts = Object.values(m.palettes).filter((p) => p.group === group);
    return rng.pick(opts).id;
  };

  if (!locked.has("skin")) next.skinPalette = paletteIn("skin");
  if (!locked.has("face")) next.face = pickIn("face") ?? base.face;
  if (!locked.has("expression")) next.expression = rng.pick(["neutral", "smile", "focused", "talk"]);
  if (!locked.has("hairColor")) next.hairColor = paletteIn("hair");

  // Head covering ~30% of the time; when present, front hair is occluded anyway.
  if (!locked.has("headCovering")) {
    next.headCovering = rng.chance(0.3) ? pickIn("headCovering") : null;
  }
  if (!locked.has("hair")) {
    next.hair = next.headCovering ? base.hair : pickIn("hair");
  }
  if (!locked.has("facialHair")) {
    next.facialHair = fit === "masculine-fit" && rng.chance(0.5) ? pickIn("facialHair") : null;
    next.facialHairColor = next.hairColor;
  }

  if (!locked.has("outfit")) {
    const outfits = m.outfitSystems.filter(
      (o) => o.fitGroups.includes("universal") || o.fitGroups.includes(fit),
    );
    const outfit = rng.pick(outfits);
    next.outfitSystem = outfit.id;
    next.outfitColorway = rng.pick(outfit.colorways).id;
  }

  if (!locked.has("accessory")) {
    const accessories = registry.category("accessory");
    const chosen: string[] = [];
    const count = rng.int(0, 3);
    const pool = [...accessories];
    for (let i = 0; i < count && pool.length; i++) {
      const idx = rng.int(0, pool.length - 1);
      const acc = pool.splice(idx, 1)[0];
      // Respect mutual exclusions already chosen.
      if (chosen.some((c) => acc.excludes.includes(c) || registry.require(c).excludes.includes(acc.id)))
        continue;
      chosen.push(acc.id);
    }
    next.accessories = chosen;
  }

  next.materialOverrides = locked.has("outfit") ? base.materialOverrides : {};
  return next;
}

// --- Migration ------------------------------------------------------------

export interface MigrationResult {
  config: CharacterConfig;
  changed: boolean;
  notes: string[];
}

/**
 * Migrate a possibly-old config to the current manifest. Non-breaking updates
 * keep the config loadable; unknown asset ids fall back to defaults with a note.
 */
export function migrateConfig(registry: AssetRegistry, raw: CharacterConfig): MigrationResult {
  const m = registry.manifest;
  const notes: string[] = [];
  const config: CharacterConfig = { ...defaultConfig(m), ...raw };
  let changed = raw.manifestVersion !== m.packageVersion;

  const ensureAsset = (id: string | null, fallback: string | null, label: string): string | null => {
    if (id === null) return null;
    if (registry.get(id)) return id;
    notes.push(`Unknown ${label} "${id}" → ${fallback ?? "removed"}`);
    changed = true;
    return fallback;
  };
  config.face = ensureAsset(config.face, "face-m-01", "face") ?? "face-m-01";
  config.hair = ensureAsset(config.hair, null, "hair");
  config.facialHair = ensureAsset(config.facialHair, null, "facial hair");
  config.headCovering = ensureAsset(config.headCovering, null, "head covering");
  config.accessories = config.accessories.filter((a) => {
    if (registry.get(a)) return true;
    notes.push(`Dropped unknown accessory "${a}"`);
    changed = true;
    return false;
  });

  if (!m.palettes[config.skinPalette]) {
    notes.push(`Unknown skin "${config.skinPalette}" → skin-olive-03`);
    config.skinPalette = "skin-olive-03";
    changed = true;
  }
  if (!m.outfitSystems.some((o) => o.id === config.outfitSystem)) {
    notes.push(`Unknown outfit "${config.outfitSystem}" → suit-2p`);
    config.outfitSystem = "suit-2p";
    config.outfitColorway = "navy";
    changed = true;
  }

  config.manifestVersion = m.packageVersion;
  return { config, changed, notes };
}

// --- Serialization / share ------------------------------------------------

/** Round-trippable JSON string for export. */
export function serializeConfig(config: CharacterConfig): string {
  return JSON.stringify(config, null, 2);
}

export function parseConfig(json: string): CharacterConfig {
  const obj = JSON.parse(json) as CharacterConfig;
  if (!obj || typeof obj !== "object" || !obj.characterId) {
    throw new Error("Not a valid character configuration");
  }
  return obj;
}

/** Compact base64url share token (URL-safe), suitable for ?c= links. */
export function encodeShare(config: CharacterConfig): string {
  const json = JSON.stringify(config);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(token: string): CharacterConfig {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const json =
    typeof atob === "function"
      ? decodeURIComponent(escape(atob(b64)))
      : Buffer.from(b64, "base64").toString("utf8");
  return parseConfig(json);
}

export const DIRECTIONS_UI: { id: Direction; label: string }[] = [
  { id: "down", label: "Front (Down)" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "up", label: "Back (Up)" },
];

export const STATES_UI: { id: AnimationState; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "walk", label: "Walk" },
  { id: "talk", label: "Talk" },
  { id: "approve", label: "Approve" },
];
