// Bespoke, deterministic looks for the fifteen native agents, expressed as the
// expanded AvatarConfig the smooth-vector renderer reads.
//
// Each agent keeps its brand `color` as its outfit (so it stays recognizable
// next to its badges elsewhere), snapping to the nearest OUTFIT_COLORS swatch
// when the brand hue isn't an exact catalog entry. Senior/advisory roles wear
// blazers or turtlenecks; comms roles (IR, Analyst, Lead Gen) wear headsets;
// Diligence wears glasses; the rest get a role-fitting hairstyle, facial hair,
// accessory, and build so the fifteen read as distinct people on the floor.
// Skin, hair color and eyes come from the deterministic catalog fallback, so
// every result is a fully valid config. Anything unmapped falls back to
// `avatarForId`.
import { AGENT_BY_KEY } from "@/lib/agents";
import {
  OUTFIT_COLORS,
  avatarForId,
  type Accessory,
  type AvatarConfig,
  type Build,
  type FacialHair,
  type HairStyle,
  type OutfitStyle,
} from "@/lib/office/avatarConfig";

interface Look {
  hair: HairStyle;
  outfit: OutfitStyle;
  facialHair: FacialHair;
  accessory: Accessory;
  build: Build;
}

const LOOKS: Record<string, Look> = {
  // Run — heads-down analytical desk.
  analyst: {
    hair: "short",
    outfit: "dress_shirt",
    facialHair: "stubble",
    accessory: "headset",
    build: "regular",
  },
  diligence: {
    hair: "short",
    outfit: "vneck",
    facialHair: "beard",
    accessory: "glasses",
    build: "regular",
  },
  // Earn — the cross-hub coordinator; deliberately its own look.
  associate: {
    hair: "bun",
    outfit: "hoodie",
    facialHair: "none",
    accessory: "beanie",
    build: "slim",
  },
  // Execute — comms & books.
  investor_relations: {
    hair: "long",
    outfit: "blazer",
    facialHair: "none",
    accessory: "headset",
    build: "regular",
  },
  portfolio_ops: {
    hair: "buzz",
    outfit: "tee",
    facialHair: "stubble",
    accessory: "cap",
    build: "broad",
  },
  fund_admin: {
    hair: "bald",
    outfit: "dress_shirt",
    facialHair: "mustache",
    accessory: "glasses",
    build: "regular",
  },
  // Source — the outward-facing pipeline crew (polished, senior).
  executive_advisor: {
    hair: "short",
    outfit: "turtleneck",
    facialHair: "none",
    accessory: "none",
    build: "slim",
  },
  capital_raiser: {
    hair: "long",
    outfit: "blazer",
    facialHair: "none",
    accessory: "earrings",
    build: "regular",
  },
  capital_connector: {
    hair: "short",
    outfit: "blazer",
    facialHair: "beard",
    accessory: "glasses",
    build: "regular",
  },
  deal_sourcer: {
    hair: "buzz",
    outfit: "turtleneck",
    facialHair: "stubble",
    accessory: "cap",
    build: "broad",
  },
  rainmaker: {
    hair: "curly",
    outfit: "blazer",
    facialHair: "none",
    accessory: "sunglasses",
    build: "regular",
  },
  // Build — the studio.
  lead_generator: {
    hair: "ponytail",
    outfit: "tee",
    facialHair: "none",
    accessory: "headset",
    build: "slim",
  },
  pr_director: {
    hair: "long",
    outfit: "turtleneck",
    facialHair: "none",
    accessory: "glasses",
    build: "regular",
  },
  seo_disruptor: {
    hair: "mohawk",
    outfit: "hoodie",
    facialHair: "stubble",
    accessory: "beanie",
    build: "slim",
  },
  curator: {
    hair: "bun",
    outfit: "vneck",
    facialHair: "none",
    accessory: "earrings",
    build: "regular",
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** The catalog outfit color closest to a brand hue (exact match wins). */
function nearestOutfitColor(hex: string): string {
  if (OUTFIT_COLORS.includes(hex)) return hex;
  const [r, g, b] = hexToRgb(hex);
  let best = OUTFIT_COLORS[0];
  let bestD = Infinity;
  for (const c of OUTFIT_COLORS) {
    const [cr, cg, cb] = hexToRgb(c);
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * The expanded avatar config for an agent key. Uses the agent's brand color as
 * the outfit (snapped to the nearest catalog swatch) and its bespoke look;
 * skin, hair color and eyes are drawn from the deterministic catalog. Falls
 * back to `avatarForId` for any unknown key.
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
    eyes: base.eyes,
    outfit: look.outfit,
    outfitColor: nearestOutfitColor(agent.color),
    facialHair: look.facialHair,
    accessory: look.accessory,
    build: look.build,
  };
}
