/**
 * Executive avatar palettes.
 *
 * Every figure is a humanized executive: professional suit tones with a
 * role-colored accent (tie / pocket square / AI aura). Skin and hair tones
 * are varied so the floor reads as a real team, not cloned tokens.
 *
 * Colors are 0xRRGGBB integers for direct use with Phaser Graphics.
 *
 * ── Rendering-layer note ──────────────────────────────────────────────────
 * The `prop`, `build`, and `hairStyle` fields exist purely so the current
 * Canvas2D `ExecutiveAvatar` can differentiate executives by role and
 * silhouette (MetaHuman-inspired "distinct clothing silhouette / role
 * attire"). When the renderer is later swapped for a Three.js/WebGPU,
 * Unity WebGL, or Unreal Pixel-Streaming layer, this same AvatarSpec maps
 * cleanly onto a material/mesh/rig selection — the office intelligence,
 * NPC behavior, and workflow-state layers never see these fields.
 */

import type { AgentId } from "../program/officeProgram";

export type AvatarKind = "user" | "remote" | "agent";

/**
 * A small role-signifying object the executive carries while working.
 * Rendered only during active work states so the prop *means* something
 * (a working analyst holds a chart; an idle one does not).
 */
export type AvatarProp =
  | "none"
  | "command"      // Earn — command node / signal rings
  | "files"        // Associate — deal file cards
  | "folder"       // Principal — executive review folder
  | "chart"        // Analyst — model / bar chart
  | "shield"       // Risk & Compliance — controls shield
  | "document"     // Legal — document with stamp
  | "envelope"     // Investor Relations — LP communication
  | "capital"      // Treasury — capital / settlement stack
  | "kpi"          // Portfolio Ops — KPI board
  | "calendar"     // Ops / Admin — fund-admin calendar
  | "network";     // Business Dev — relationship map

/** Silhouette weight — subtly varies shoulder width and torso taper. */
export type AvatarBuild = "slim" | "regular" | "broad";

/** Hair silhouette — varies the crown/back-of-head shape. */
export type AvatarHairStyle = "short" | "textured" | "tied" | "bald";

/** Optional eyewear drawn over the eyes (front + profile). */
export type AvatarGlasses = "none" | "glasses";

/** Optional facial hair drawn over the lower face (front + profile). */
export type AvatarFacialHair = "none" | "stubble" | "mustache" | "beard";

export type AvatarSpec = {
  skin: number;
  hair: number;
  /** Blazer / jacket color — kept in muted executive tones. */
  suit: number;
  /** Shirt / blouse under the jacket. */
  shirt: number;
  /** Tie / pocket-square / accent — the role's identity color. */
  accent: number;
  /** Trouser / skirt color. */
  trouser: number;
  kind: AvatarKind;
  /** Role-signifying object carried while working. Defaults to "none". */
  prop?: AvatarProp;
  /** Silhouette weight. Defaults to "regular". */
  build?: AvatarBuild;
  /** Hair silhouette. Defaults to "short". */
  hairStyle?: AvatarHairStyle;
  /** Eyewear. Defaults to "none". */
  glasses?: AvatarGlasses;
  /** Facial hair. Defaults to "none". */
  facialHair?: AvatarFacialHair;
  /**
   * When true the figure renders as the gold-coin mascot (Earn) instead of a
   * humanized executive — a round coin body with a friendly face, stubby arms
   * with white gloves, and little shoes. Uses `accent` as the coin's gold.
   */
  coin?: boolean;
};

// A small spread of natural skin tones for team diversity.
const SKIN = [0xf1c9a5, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbb0, 0xd9a066];
const HAIR = [0x2b2320, 0x4a3728, 0x6b4a2f, 0x1a1a1a, 0x8a8a8a, 0x3a2a1a];

// Professional suit tones (charcoal, navy, slate, graphite, espresso).
const SUITS = [0x2b2f38, 0x1f2a3d, 0x33383f, 0x262b33, 0x3a2f2a];
const SHIRTS = [0xe8eef5, 0xdfe6ee, 0xf2ede2, 0xeaf0f6];

const BUILDS: AvatarBuild[] = ["slim", "regular", "broad"];
const HAIR_STYLES: AvatarHairStyle[] = ["short", "textured", "tied"];

/** Deterministic role prop so each executive reads by function. */
const AGENT_PROP: Record<AgentId, AvatarProp> = {
  earn: "command",
  associate: "files",
  principal: "folder",
  analyst: "chart",
  risk: "shield",
  legal: "document",
  investor_relations: "envelope",
  treasury: "capital",
  portfolio_ops: "kpi",
  ops_admin: "calendar",
  business_dev: "network",
};

function hexToInt(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

/** Deterministic index from a string key. */
function pick<T>(arr: T[], key: string, salt = 0): T {
  let h = salt;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
  return arr[h % arr.length];
}

/** Build an executive spec for a program agent, keyed to its accent color. */
export function agentAvatarSpec(agentId: AgentId, accentHex: string): AvatarSpec {
  return {
    skin: pick(SKIN, agentId, 3),
    hair: pick(HAIR, agentId, 7),
    suit: pick(SUITS, agentId, 1),
    shirt: pick(SHIRTS, agentId, 5),
    accent: hexToInt(accentHex),
    trouser: pick(SUITS, agentId, 4),
    kind: "agent",
    prop: AGENT_PROP[agentId] ?? "none",
    build: pick(BUILDS, agentId, 11),
    hairStyle: pick(HAIR_STYLES, agentId, 13),
    // Earn is the fund's gold-coin mascot — rendered as a coin, not a suit.
    coin: agentId === "earn",
  };
}

/** The local user: charcoal suit with a signature gold accent. */
export const USER_SPEC: AvatarSpec = {
  skin: 0xf1c9a5,
  hair: 0x2b2320,
  suit: 0x23262d,
  shirt: 0xeef2f7,
  accent: 0xc9a84c,
  trouser: 0x1c1f24,
  kind: "user",
  prop: "none",
  build: "regular",
  hairStyle: "short",
};

/** Remote human executives — distinct suit/accent derived from their id. */
export function remoteAvatarSpec(playerId: string): AvatarSpec {
  const accents = [0x38bdf8, 0x22c55e, 0xf472b6, 0x818cf8, 0xfb923c, 0x2dd4bf];
  return {
    skin: pick(SKIN, playerId, 2),
    hair: pick(HAIR, playerId, 9),
    suit: pick(SUITS, playerId, 6),
    shirt: pick(SHIRTS, playerId, 8),
    accent: pick(accents, playerId, 4),
    trouser: pick(SUITS, playerId, 3),
    kind: "remote",
    prop: "none",
    build: pick(BUILDS, playerId, 17),
    hairStyle: pick(HAIR_STYLES, playerId, 19),
  };
}
