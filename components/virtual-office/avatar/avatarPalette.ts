/**
 * Executive avatar palettes.
 *
 * Every figure is a humanized executive: professional suit tones with a
 * role-colored accent (tie / pocket square / AI aura). Skin and hair tones
 * are varied so the floor reads as a real team, not cloned tokens.
 *
 * Colors are 0xRRGGBB integers for direct use with Phaser Graphics.
 */

import type { AgentId } from "../program/officeProgram";

export type AvatarKind = "user" | "remote" | "agent";

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
};

// A small spread of natural skin tones for team diversity.
const SKIN = [0xf1c9a5, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbb0, 0xd9a066];
const HAIR = [0x2b2320, 0x4a3728, 0x6b4a2f, 0x1a1a1a, 0x8a8a8a, 0x3a2a1a];

// Professional suit tones (charcoal, navy, slate, graphite, espresso).
const SUITS = [0x2b2f38, 0x1f2a3d, 0x33383f, 0x262b33, 0x3a2f2a];
const SHIRTS = [0xe8eef5, 0xdfe6ee, 0xf2ede2, 0xeaf0f6];

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
  };
}
