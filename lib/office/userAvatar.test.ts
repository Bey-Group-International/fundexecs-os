import {
  DEFAULT_USER_AVATAR,
  SKIN_TONES,
  HAIR_COLORS,
  presentationDefaults,
  effectiveSkin,
  effectiveHair,
  parseUserAvatar,
  userAvatarSpec,
  type UserAvatar,
} from "./userAvatar";

describe("userAvatar — appearance overrides", () => {
  it("keeps presentation presets as the hairStyle/build fallback", () => {
    expect(presentationDefaults("female")).toEqual({ hairStyle: "tied", build: "slim" });
    expect(presentationDefaults("male")).toEqual({ hairStyle: "short", build: "broad" });
    expect(presentationDefaults("neutral")).toEqual({ hairStyle: "short", build: "regular" });
  });

  it("derives skin/hair from the name when no explicit tone is set", () => {
    const a: UserAvatar = { ...DEFAULT_USER_AVATAR, displayName: "Priya" };
    // Deterministic: same name → same tone, and it names a real swatch.
    expect(effectiveSkin(a)).toBe(effectiveSkin({ ...a }));
    expect(SKIN_TONES).toContain(effectiveSkin(a));
    expect(HAIR_COLORS).toContain(effectiveHair(a));
  });

  it("lets explicit overrides win over presentation + name derivation", () => {
    const a: UserAvatar = {
      ...DEFAULT_USER_AVATAR,
      genderStyle: "female", // preset would give tied / slim
      skin: "#c68642",
      hair: "#1a1a1a",
      hairStyle: "short",
      build: "broad",
    };
    const spec = userAvatarSpec(a);
    expect(spec.hairStyle).toBe("short");
    expect(spec.build).toBe("broad");
    expect(spec.skin).toBe(0xc68642);
    expect(spec.hair).toBe(0x1a1a1a);
    expect(spec.kind).toBe("user");
    expect(spec.coin).toBe(false);
  });

  it("falls back to the preset silhouette when overrides are absent", () => {
    const spec = userAvatarSpec({ ...DEFAULT_USER_AVATAR, genderStyle: "male" });
    expect(spec.build).toBe("broad");
    expect(spec.hairStyle).toBe("short");
  });
});

describe("userAvatar — parse (backward compatible)", () => {
  it("parses a pre-appearance-fields avatar unchanged", () => {
    const legacy = { displayName: "Old", genderStyle: "neutral", wardrobe: "navy", accent: "#c9a84c", roleLabel: "Analyst" };
    const parsed = parseUserAvatar(legacy);
    expect(parsed).toEqual(legacy);
    // No appearance keys leak in.
    expect(parsed).not.toHaveProperty("skin");
    expect(parsed).not.toHaveProperty("build");
  });

  it("keeps valid appearance overrides and drops invalid ones", () => {
    const parsed = parseUserAvatar({
      displayName: "New",
      genderStyle: "female",
      wardrobe: "slate",
      accent: "#2f8f83",
      roleLabel: "Principal",
      skin: SKIN_TONES[2],
      hair: "#not-a-color",
      hairStyle: "bald",
      build: "wrong",
    });
    expect(parsed?.skin).toBe(SKIN_TONES[2]);
    expect(parsed?.hairStyle).toBe("bald");
    expect(parsed).not.toHaveProperty("hair"); // invalid hex dropped
    expect(parsed).not.toHaveProperty("build"); // invalid enum dropped
  });

  it("still rejects a non-object or a bad genderStyle", () => {
    expect(parseUserAvatar(null)).toBeNull();
    expect(parseUserAvatar({ genderStyle: "robot" })).toBeNull();
  });
});
