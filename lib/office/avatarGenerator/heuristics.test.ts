import {
  hexToRgb,
  rgbToHex,
  colorDistance,
  nearestPaletteColor,
  toneConfidence,
  validateImageMeta,
  analysisToAvatar,
  buildProfiles,
  MAX_IMAGE_BYTES,
} from "./heuristics";
import { SKIN_TONES, HAIR_COLORS, DEFAULT_USER_AVATAR, type UserAvatar } from "../userAvatar";
import type { AvatarAttributeAnalysis } from "./types";

describe("colour math", () => {
  it("round-trips hex ↔ rgb", () => {
    expect(rgbToHex(hexToRgb("#c68642"))).toBe("#c68642");
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(rgbToHex({ r: 300, g: -5, b: 128 })).toBe("#ff0080"); // clamps
  });

  it("distance is zero for identical colours and positive otherwise", () => {
    expect(colorDistance({ r: 10, g: 20, b: 30 }, { r: 10, g: 20, b: 30 })).toBe(0);
    expect(colorDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeGreaterThan(0);
  });

  it("nearestPaletteColor returns an exact match when present", () => {
    expect(nearestPaletteColor(hexToRgb("#8d5524"), SKIN_TONES)).toBe("#8d5524");
    expect(nearestPaletteColor(hexToRgb("#1a1a1a"), HAIR_COLORS)).toBe("#1a1a1a");
  });

  it("nearestPaletteColor snaps a near colour to the closest swatch", () => {
    // A hair tone close to espresso #2b2320 but not exact.
    const chosen = nearestPaletteColor({ r: 0x2c, g: 0x24, b: 0x21 }, HAIR_COLORS);
    expect(chosen).toBe("#2b2320");
  });

  it("toneConfidence is high for near colours and low for far ones", () => {
    expect(toneConfidence(hexToRgb("#8d5524"), "#8d5524")).toBe(1);
    expect(toneConfidence({ r: 255, g: 255, b: 255 }, "#000000")).toBe(0);
  });
});

describe("validateImageMeta", () => {
  const ok = { type: "image/png", size: 1024, width: 800, height: 800 };
  it("accepts a well-formed image", () => {
    expect(validateImageMeta(ok)).toEqual({ ok: true });
  });
  it("rejects an unsupported type", () => {
    const r = validateImageMeta({ ...ok, type: "image/gif" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unsupported_type");
  });
  it("rejects an oversized file", () => {
    const r = validateImageMeta({ ...ok, size: MAX_IMAGE_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("too_large");
  });
  it("rejects a too-small image", () => {
    const r = validateImageMeta({ ...ok, width: 120, height: 800 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("too_small");
  });
  it("accepts case-insensitive mime types", () => {
    expect(validateImageMeta({ ...ok, type: "IMAGE/JPEG" })).toEqual({ ok: true });
  });
});

describe("analysisToAvatar", () => {
  const base: UserAvatar = { ...DEFAULT_USER_AVATAR, displayName: "Dana", roleLabel: "Principal", genderStyle: "female" };
  const analysis: AvatarAttributeAnalysis = {
    skinHex: "#e0a878",
    hairHex: "#4a3728",
    faceCount: 1,
    confidence: { skin: 0.9, hair: 0.8 },
  };

  it("preserves identity and snaps tones to the palette", () => {
    const a = analysisToAvatar(analysis, base);
    expect(a.displayName).toBe("Dana");
    expect(a.roleLabel).toBe("Principal");
    expect(SKIN_TONES).toContain(a.skin);
    expect(HAIR_COLORS).toContain(a.hair);
    expect(a.skin).toBe("#e0a878");
    expect(a.hair).toBe("#4a3728");
  });

  it("seeds hairStyle/build from the presentation when unset", () => {
    const a = analysisToAvatar(analysis, base);
    expect(a.hairStyle).toBe("tied"); // female preset
    expect(a.build).toBe("slim");
  });
});

describe("buildProfiles", () => {
  const base: UserAvatar = { ...DEFAULT_USER_AVATAR };
  const analysis: AvatarAttributeAnalysis = { skinHex: "#c68642", hairHex: "#2b2320", faceCount: 1, confidence: {} };

  it("produces a primary plus the requested number of distinct alternatives", () => {
    const { primary, alternatives } = buildProfiles(analysis, base, 2);
    expect(primary.label).toBe("Primary");
    expect(alternatives).toHaveLength(2);
    // Alternatives keep the same face but vary wardrobe/accent.
    for (const alt of alternatives) {
      expect(alt.avatar.skin).toBe(primary.avatar.skin);
      expect(alt.avatar.hair).toBe(primary.avatar.hair);
    }
    expect(alternatives[0].avatar.wardrobe).not.toBe(alternatives[1].avatar.wardrobe);
    expect(new Set([primary.id, ...alternatives.map((a) => a.id)]).size).toBe(3);
  });

  it("is deterministic (no randomness)", () => {
    const a = buildProfiles(analysis, base, 3);
    const b = buildProfiles(analysis, base, 3);
    expect(a).toEqual(b);
  });

  it("handles a zero alternatives request", () => {
    const { alternatives } = buildProfiles(analysis, base, 0);
    expect(alternatives).toEqual([]);
  });
});
