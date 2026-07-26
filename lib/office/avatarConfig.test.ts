import {
  ACCESSORIES,
  AVATAR_CONFIG_VERSION,
  BODY_TYPES,
  DEFAULT_AVATAR_CONFIG,
  EXPRESSIONS,
  EYEWEAR,
  FACIAL_HAIR,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADWEAR,
  HOLDING,
  MAX_DISPLAY_NAME,
  OUTFITS,
  OUTFIT_COLORS,
  SKIN_TONES,
  STATUSES,
  initialsFor,
  normalizeAvatarConfig,
  outfitHex,
  skinHex,
  statusHex,
  type AvatarConfig,
} from "@/lib/office/avatarConfig";

const CATALOGS = [
  ["body", BODY_TYPES],
  ["skin", SKIN_TONES],
  ["hair", HAIR_STYLES],
  ["hairColor", HAIR_COLORS],
  ["facialHair", FACIAL_HAIR],
  ["expression", EXPRESSIONS],
  ["outfit", OUTFITS],
  ["outfitColor", OUTFIT_COLORS],
  ["eyewear", EYEWEAR],
  ["headwear", HEADWEAR],
  ["accessories", ACCESSORIES],
  ["holding", HOLDING],
  ["status", STATUSES],
] as const;

const TEN = ["skin", "hair", "outfit", "eyewear", "headwear", "accessories"] as const;
const TEN_CATALOGS = { skin: SKIN_TONES, hair: HAIR_STYLES, outfit: OUTFITS, eyewear: EYEWEAR, headwear: HEADWEAR, accessories: ACCESSORIES };

describe("avatarConfig · catalogs", () => {
  it("every catalog has unique, non-empty ids and labels", () => {
    for (const [, catalog] of CATALOGS) {
      const ids = catalog.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const o of catalog) {
        expect(o.id.length).toBeGreaterThan(0);
        expect(o.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("the default config only references valid catalog ids", () => {
    for (const [key, catalog] of CATALOGS) {
      const id = DEFAULT_AVATAR_CONFIG[key as keyof AvatarConfig];
      expect(catalog.some((o) => o.id === id)).toBe(true);
    }
    expect(DEFAULT_AVATAR_CONFIG.v).toBe(AVATAR_CONFIG_VERSION);
  });

  it("color catalogs expose 6-digit hex values", () => {
    for (const catalog of [SKIN_TONES, HAIR_COLORS, OUTFIT_COLORS, STATUSES]) {
      for (const o of catalog) expect(o.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("avatarConfig · normalizeAvatarConfig", () => {
  it("returns the default for null / non-object / garbage input", () => {
    for (const bad of [null, undefined, 42, "x", [], true]) {
      expect(normalizeAvatarConfig(bad)).toEqual(DEFAULT_AVATAR_CONFIG);
    }
  });

  it("drops unknown option ids back to the default per-field", () => {
    const c = normalizeAvatarConfig({
      body: "gigantic",
      skin: "neon",
      outfit: "spacesuit",
      status: "vibing",
    });
    expect(c.body).toBe(DEFAULT_AVATAR_CONFIG.body);
    expect(c.skin).toBe(DEFAULT_AVATAR_CONFIG.skin);
    expect(c.outfit).toBe(DEFAULT_AVATAR_CONFIG.outfit);
    expect(c.status).toBe(DEFAULT_AVATAR_CONFIG.status);
  });

  it("keeps valid ids untouched and stamps the current version", () => {
    const c = normalizeAvatarConfig({
      v: 999,
      body: "broad",
      skin: "deep",
      hair: "curly",
      hairColor: "gray",
      facialHair: "beard",
      expression: "smile",
      outfit: "dress",
      outfitColor: "plum",
      eyewear: "aviators",
      headwear: "fedora",
      accessories: "scarf",
      holding: "coffee",
      status: "busy",
    });
    expect(c.v).toBe(AVATAR_CONFIG_VERSION);
    expect(c).toMatchObject({
      body: "broad",
      skin: "deep",
      hair: "curly",
      outfit: "dress",
      eyewear: "aviators",
      headwear: "fedora",
      accessories: "scarf",
      holding: "coffee",
      status: "busy",
    });
  });

  it("offers exactly 10 variations for each customization category", () => {
    for (const key of TEN) expect(TEN_CATALOGS[key]).toHaveLength(10);
  });

  it("migrates a legacy single `accessory` id into the split fields", () => {
    expect(normalizeAvatarConfig({ accessory: "glasses" }).eyewear).toBe("glasses");
    expect(normalizeAvatarConfig({ accessory: "sunglasses" }).eyewear).toBe("sunglasses");
    expect(normalizeAvatarConfig({ accessory: "headset" }).headwear).toBe("headphones");
    expect(normalizeAvatarConfig({ accessory: "lanyard" }).accessories).toBe("lanyard");
    // an explicit new-field value wins over the legacy fan-out
    expect(normalizeAvatarConfig({ accessory: "glasses", eyewear: "round" }).eyewear).toBe("round");
  });

  it("trims and length-caps the display name", () => {
    expect(normalizeAvatarConfig({ displayName: "  Ada Lovelace  " }).displayName).toBe(
      "Ada Lovelace",
    );
    const long = "x".repeat(MAX_DISPLAY_NAME + 20);
    expect(normalizeAvatarConfig({ displayName: long }).displayName).toHaveLength(MAX_DISPLAY_NAME);
    expect(normalizeAvatarConfig({ displayName: 123 }).displayName).toBe("");
  });

  it("is idempotent", () => {
    const once = normalizeAvatarConfig({ body: "slim", outfit: "hoodie", displayName: " Jo " });
    expect(normalizeAvatarConfig(once)).toEqual(once);
  });
});

describe("avatarConfig · resolvers", () => {
  it("resolve hexes from the config, falling back safely", () => {
    expect(skinHex(DEFAULT_AVATAR_CONFIG)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(outfitHex(DEFAULT_AVATAR_CONFIG)).toMatch(/^#[0-9a-f]{6}$/i);
    // Fallback: a config carrying an unknown id still yields the first catalog hex.
    expect(statusHex({ ...DEFAULT_AVATAR_CONFIG, status: "???" })).toBe(STATUSES[0].hex);
  });

  it("derives sensible initials", () => {
    expect(initialsFor("")).toBe("ME");
    expect(initialsFor("Grace")).toBe("GR");
    expect(initialsFor("Grace Hopper")).toBe("GH");
    expect(initialsFor("  ada  b  lovelace ")).toBe("AL");
  });
});
