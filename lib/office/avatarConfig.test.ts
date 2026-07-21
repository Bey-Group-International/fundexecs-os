import {
  CATEGORY_META,
  COSMETIC_LAYERS,
  categoryOptions,
  isCosmeticUnlocked,
  optionsFor,
  type CosmeticCategory,
} from "@/lib/office/avatarConfig";
import type { MemberRole } from "@/lib/supabase/database.types";

// The leadership-reserved outfit tones (burgundy, brass).
const LEADERSHIP_COLORS = ["#6b2c39", "#9a7d3f"];

describe("cosmetic categories", () => {
  it("COSMETIC_LAYERS covers all 9 categories with metadata", () => {
    expect(COSMETIC_LAYERS).toHaveLength(9);
    expect(new Set(COSMETIC_LAYERS).size).toBe(9);
    for (const cat of COSMETIC_LAYERS) {
      const meta = CATEGORY_META[cat];
      expect(meta).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(["swatch", "option"]).toContain(meta.kind);
    }
  });

  it("categoryOptions returns a non-empty catalog for every category", () => {
    for (const cat of COSMETIC_LAYERS) {
      expect(categoryOptions(cat).length).toBeGreaterThan(0);
    }
  });
});

describe("role gating", () => {
  const privileged: MemberRole[] = ["owner", "admin"];
  const plain: MemberRole[] = ["member", "viewer"];

  it("hides leadership-only outfit colors from non-privileged roles", () => {
    for (const role of plain) {
      const opts = optionsFor("outfitColor", { role });
      for (const color of LEADERSHIP_COLORS) {
        expect(opts).not.toContain(color);
      }
      // The base palette is still available.
      expect(opts).toContain("#2f3541"); // charcoal
    }
  });

  it("includes leadership-only outfit colors for owner and admin", () => {
    for (const role of privileged) {
      const opts = optionsFor("outfitColor", { role });
      for (const color of LEADERSHIP_COLORS) {
        expect(opts).toContain(color);
      }
      // owners/admins see the full catalog, nothing removed.
      expect(opts).toEqual(categoryOptions("outfitColor"));
    }
  });

  it("defaults to fully unlocked when the role is null/undefined", () => {
    expect(optionsFor("outfitColor", { role: null })).toEqual(
      categoryOptions("outfitColor"),
    );
    expect(optionsFor("outfitColor", {})).toEqual(
      categoryOptions("outfitColor"),
    );
  });

  it("never gates non-outfit-color categories", () => {
    const others = COSMETIC_LAYERS.filter(
      (c): c is CosmeticCategory => c !== "outfitColor",
    );
    for (const cat of others) {
      expect(optionsFor(cat, { role: "viewer" })).toEqual(categoryOptions(cat));
    }
  });

  it("isCosmeticUnlocked is a total predicate that never throws", () => {
    expect(isCosmeticUnlocked("outfitColor", "#9a7d3f", { role: "viewer" })).toBe(
      false,
    );
    expect(isCosmeticUnlocked("outfitColor", "#9a7d3f", { role: "owner" })).toBe(
      true,
    );
    expect(isCosmeticUnlocked("skin", "not-a-real-value", { role: "viewer" })).toBe(
      true,
    );
  });
});
