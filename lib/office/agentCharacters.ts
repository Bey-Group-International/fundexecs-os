// Bespoke, deterministic pixel-character looks for the fifteen native agents.
//
// Each agent wears its brand `color` as a shirt so it stays recognizable next
// to its badges elsewhere in the app, then gets a hairstyle + role-fitting
// accessory so the fifteen read as distinct people on the office floor. Skin
// and hair color come from the deterministic catalog fallback, so every result
// is a fully valid AvatarConfig. Anything unmapped falls back to `avatarForId`.
import { AGENT_BY_KEY } from "@/lib/agents";
import {
  avatarForId,
  type Accessory,
  type AvatarConfig,
  type HairStyle,
} from "@/lib/office/avatarConfig";

/** The hand-picked hair + accessory per agent; shirt is the agent's brand color. */
const LOOKS: Record<string, { hair: HairStyle; accessory: Accessory }> = {
  // Run — heads-down analytical desk.
  analyst: { hair: "short", accessory: "headset" },
  diligence: { hair: "short", accessory: "glasses" },
  // Earn — the cross-hub coordinator; deliberately its own look.
  associate: { hair: "bun", accessory: "beanie" },
  // Execute — comms & books.
  investor_relations: { hair: "long", accessory: "headset" },
  portfolio_ops: { hair: "buzz", accessory: "cap" },
  fund_admin: { hair: "bald", accessory: "glasses" },
  // Source — the outward-facing pipeline crew.
  executive_advisor: { hair: "short", accessory: "none" },
  capital_raiser: { hair: "long", accessory: "none" },
  capital_connector: { hair: "short", accessory: "glasses" },
  deal_sourcer: { hair: "buzz", accessory: "cap" },
  rainmaker: { hair: "short", accessory: "none" },
  // Build — the studio.
  lead_generator: { hair: "bun", accessory: "headset" },
  pr_director: { hair: "long", accessory: "glasses" },
  seo_disruptor: { hair: "buzz", accessory: "beanie" },
  curator: { hair: "bun", accessory: "none" },
};

/**
 * The pixel-avatar config for an agent key. Uses the agent's brand color as the
 * shirt and its bespoke hair/accessory; skin and hair color are drawn from the
 * deterministic catalog. Falls back to `avatarForId` for any unknown key.
 */
export function agentAvatar(agentKey: string): AvatarConfig {
  const agent = AGENT_BY_KEY[agentKey as keyof typeof AGENT_BY_KEY];
  const look = LOOKS[agentKey];
  const base = avatarForId(agentKey);
  if (!agent || !look) return base;
  return {
    skin: base.skin,
    hair: look.hair,
    hairColor: base.hairColor,
    shirt: agent.color,
    accessory: look.accessory,
  };
}
