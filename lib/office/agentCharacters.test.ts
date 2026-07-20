import { AGENTS } from "@/lib/agents";
import { agentAvatar } from "@/lib/office/agentCharacters";
import {
  ACCESSORIES,
  HAIR_COLORS,
  HAIR_STYLES,
  SHIRT_COLORS,
  SKIN_TONES,
} from "@/lib/office/avatarConfig";

describe("agentAvatar", () => {
  it("yields a valid AvatarConfig for every agent key", () => {
    for (const agent of AGENTS) {
      const config = agentAvatar(agent.key);

      // Enum members must be valid.
      expect(HAIR_STYLES).toContain(config.hair);
      expect(ACCESSORIES).toContain(config.accessory);

      // Skin and hair colors come from the catalog.
      expect(SKIN_TONES).toContain(config.skin);
      expect(HAIR_COLORS).toContain(config.hairColor);

      // Shirt is either a catalog color or the agent's own brand color.
      const shirtOk =
        SHIRT_COLORS.includes(config.shirt) || config.shirt === agent.color;
      expect(shirtOk).toBe(true);
    }
  });

  it("wears each agent's brand color as the shirt", () => {
    for (const agent of AGENTS) {
      expect(agentAvatar(agent.key).shirt).toBe(agent.color);
    }
  });

  it("is deterministic", () => {
    for (const agent of AGENTS) {
      expect(agentAvatar(agent.key)).toEqual(agentAvatar(agent.key));
    }
  });

  it("gives distinct-enough looks (not all identical)", () => {
    const signatures = new Set(
      AGENTS.map((a) => {
        const c = agentAvatar(a.key);
        return `${c.hair}|${c.accessory}|${c.shirt}`;
      }),
    );
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("falls back to a valid config for an unknown key", () => {
    const config = agentAvatar("not_a_real_agent");
    expect(HAIR_STYLES).toContain(config.hair);
    expect(ACCESSORIES).toContain(config.accessory);
    expect(SKIN_TONES).toContain(config.skin);
  });
});
