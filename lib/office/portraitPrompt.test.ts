import { portraitPrompt, SAFE_STYLE_SUFFIX } from "./portraitPrompt";
import { DEFAULT_AVATAR, avatarForId, type AvatarConfig } from "./avatarConfig";

describe("portraitPrompt", () => {
  it("is deterministic — same config yields the same string", () => {
    expect(portraitPrompt(DEFAULT_AVATAR)).toBe(portraitPrompt(DEFAULT_AVATAR));
    const a = avatarForId("member-42");
    expect(portraitPrompt(a)).toBe(portraitPrompt(avatarForId("member-42")));
  });

  it("mentions the key attributes for a fully-specified config", () => {
    const config: AvatarConfig = {
      skin: "#8a5a34", // "brown"
      hair: "curly",
      hairColor: "#caa14a", // "blonde"
      eyes: "#2f5da8", // "blue"
      outfit: "blazer",
      outfitColor: "#4f46e5", // "indigo"
      facialHair: "beard",
      accessory: "glasses",
      build: "broad",
    };
    const prompt = portraitPrompt(config);
    expect(prompt).toContain("brown skin");
    expect(prompt).toContain("blonde curly hair");
    expect(prompt).toContain("blue eyes");
    expect(prompt).toContain("indigo a tailored blazer");
    expect(prompt).toContain("full beard");
    expect(prompt).toContain("glasses");
    expect(prompt).toContain("broad build");
    expect(prompt).toContain(SAFE_STYLE_SUFFIX);
  });

  it("reads as a premium studio headshot prompt", () => {
    const prompt = portraitPrompt(DEFAULT_AVATAR).toLowerCase();
    expect(prompt).toContain("studio headshot portrait");
    expect(prompt).toContain("corporate");
  });

  it("omits facial hair and accessory when set to none", () => {
    const config: AvatarConfig = {
      ...DEFAULT_AVATAR,
      facialHair: "none",
      accessory: "none",
    };
    const prompt = portraitPrompt(config);
    expect(prompt).not.toContain("beard");
    expect(prompt).not.toContain("wearing glasses");
  });

  it("describes a bald head without a hair color prefix", () => {
    const config: AvatarConfig = { ...DEFAULT_AVATAR, hair: "bald" };
    const prompt = portraitPrompt(config);
    expect(prompt).toContain("shaved bald head");
  });
});
