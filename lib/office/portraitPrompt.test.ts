import { portraitPromptFor } from "@/lib/office/portraitPrompt";
import { DEFAULT_AVATAR_CONFIG, type AvatarConfig } from "@/lib/office/avatarConfig";

const cfg = (over: Partial<AvatarConfig> = {}): AvatarConfig => ({
  ...DEFAULT_AVATAR_CONFIG,
  ...over,
});

describe("portraitPromptFor", () => {
  it("always leads with the vector/SVG style contract", () => {
    const p = portraitPromptFor(cfg());
    expect(p).toMatch(/svg/i);
    expect(p).toMatch(/flat-vector|cel shading/i);
  });

  it("describes the resolved appearance in plain words", () => {
    const p = portraitPromptFor(
      cfg({
        skin: "olive",
        hair: "curly",
        hairColor: "auburn",
        outfit: "blazer",
        outfitColor: "emerald",
        expression: "smile",
      }),
    );
    expect(p).toMatch(/auburn curly hair/i);
    expect(p).toMatch(/olive skin tone/i);
    expect(p).toMatch(/emerald blazer/i);
    expect(p).toMatch(/smile expression/i);
  });

  it("omits every 'none' selection instead of asking for the absence", () => {
    const p = portraitPromptFor(
      cfg({ eyewear: "none", headwear: "none", accessories: "none", holding: "none" }),
    );
    expect(p).not.toMatch(/none/i);
    expect(p).not.toMatch(/wearing null/i);
  });

  it("includes eyewear, headwear, accessory and held prop when chosen", () => {
    const p = portraitPromptFor(
      cfg({ eyewear: "glasses", headwear: "beanie", accessories: "lanyard", holding: "coffee" }),
    );
    expect(p).toMatch(/glasses/i);
    expect(p).toMatch(/beanie/i);
    expect(p).toMatch(/lanyard/i);
    expect(p).toMatch(/coffee/i);
  });

  it("handles a bald head without dangling a hair color", () => {
    const p = portraitPromptFor(cfg({ hair: "bald", hairColor: "black" }));
    expect(p).toMatch(/bald head/i);
    expect(p).not.toMatch(/black bald/i);
  });

  it("is deterministic for the same config", () => {
    const c = cfg({ skin: "deep", outfit: "turtleneck" });
    expect(portraitPromptFor(c)).toBe(portraitPromptFor(c));
  });

  it("normalizes junk input rather than throwing", () => {
    // Out-of-catalog ids fall back to defaults via normalizeAvatarConfig.
    const p = portraitPromptFor({ skin: "chartreuse", outfit: "spacesuit" } as unknown as AvatarConfig);
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });
});
