import { agentAvatar } from "@/lib/office/agentCharacters";
import { AGENTS } from "@/lib/agents";
import {
  ACCESSORIES,
  BUILDS,
  EYE_COLORS,
  FACIAL_HAIR,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFIT_COLORS,
  OUTFIT_STYLES,
  SKIN_TONES,
} from "@/lib/office/avatarConfig";

describe("agentAvatar", () => {
  it("yields a fully valid expanded config for every agent key", () => {
    for (const agent of AGENTS) {
      const a = agentAvatar(agent.key);
      expect(SKIN_TONES).toContain(a.skin);
      expect(HAIR_STYLES).toContain(a.hair);
      expect(HAIR_COLORS).toContain(a.hairColor);
      expect(EYE_COLORS).toContain(a.eyes);
      expect(OUTFIT_STYLES).toContain(a.outfit);
      expect(OUTFIT_COLORS).toContain(a.outfitColor);
      expect(FACIAL_HAIR).toContain(a.facialHair);
      expect(ACCESSORIES).toContain(a.accessory);
      expect(BUILDS).toContain(a.build);
    }
  });

  it("is deterministic", () => {
    for (const agent of AGENTS) {
      expect(agentAvatar(agent.key)).toEqual(agentAvatar(agent.key));
    }
  });

  it("gives the fifteen agents distinct looks", () => {
    const sigs = new Set(
      AGENTS.map((a) => {
        const c = agentAvatar(a.key);
        return `${c.hair}|${c.outfit}|${c.accessory}|${c.facialHair}|${c.build}|${c.outfitColor}`;
      }),
    );
    // Allow a little overlap but expect broad variety across fifteen agents.
    expect(sigs.size).toBeGreaterThanOrEqual(12);
  });

  it("falls back to a valid config for an unknown key", () => {
    const a = agentAvatar("not_a_real_agent");
    expect(SKIN_TONES).toContain(a.skin);
    expect(OUTFIT_COLORS).toContain(a.outfitColor);
    expect(HAIR_STYLES).toContain(a.hair);
  });

  it("snaps the outfit color to a catalog swatch for every agent", () => {
    for (const agent of AGENTS) {
      expect(OUTFIT_COLORS).toContain(agentAvatar(agent.key).outfitColor);
    }
  });
});
