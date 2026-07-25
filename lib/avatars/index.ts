// lib/avatars/index.ts
// Renderer-agnostic avatar core (LIVING-EXECS M0). Public surface for the
// descriptor + self-model, plus a bridge that seeds a self-model for any office
// avatar from the existing AVATAR_BRAINS mapping (lib/brains/avatars.ts) so the
// office and the Brain stack share one identity.

export * from "@/lib/avatars/descriptor";
export * from "@/lib/avatars/self-model";

import { AVATAR_BRAIN_BY_ID, AVATAR_BRAIN_BY_SPRITE, type AvatarBrainLink } from "@/lib/brains/avatars";
import {
  defaultBehaviorProfile,
  type BehaviorProfile,
  type GoalSpec,
} from "@/lib/avatars/descriptor";
import { initState, type SelfState } from "@/lib/avatars/self-model";

function linkFor(idOrSprite: string): AvatarBrainLink | undefined {
  return AVATAR_BRAIN_BY_ID[idOrSprite] ?? AVATAR_BRAIN_BY_SPRITE[idOrSprite];
}

/** Roamer personas are client-facing; everyone else is desk-bound by default. */
const ROAMERS = new Set(["rm", "cr", "er"]);

/**
 * Seed a BehaviorProfile for an office avatar (by roster id or sprite key) from
 * its AVATAR_BRAINS entry — presence status shapes the drive baselines, and
 * roamers get a more social, client-facing profile. Returns null for an unknown
 * avatar. This is defaults-only tuning; a full descriptor can override any of it.
 */
export function behaviorProfileForAvatar(idOrSprite: string): BehaviorProfile | null {
  const link = linkFor(idOrSprite);
  if (!link) return null;

  const energy = link.status === "away" ? 0.45 : link.status === "busy" ? 0.6 : 0.8;
  const focus = link.status === "busy" ? 0.75 : 0.6;
  const roamer = ROAMERS.has(link.id);
  const social = roamer ? 0.75 : 0.5;

  const goals: GoalSpec[] = [
    { id: "core_work", kind: "work", priority: link.status === "busy" ? 0.9 : 0.75 },
  ];
  if (roamer) goals.push({ id: "network", kind: "social", priority: 0.7 });

  return defaultBehaviorProfile({
    baseline: { energy, focus, social },
    goals,
    homeZone: roamer ? "trading_floor" : "command_center",
    roamProfile: roamer ? "client_facing" : "desk_bound",
    socialBias: social,
    personality: {
      extraversion: roamer ? 0.75 : 0.5,
      conscientiousness: link.status === "busy" ? 0.85 : 0.65,
      openness: 0.55,
      agreeableness: 0.6,
      stability: 0.65,
    },
  });
}

/** Build an initial self-model SelfState for an office avatar, or null if unknown. */
export function selfModelForAvatar(idOrSprite: string): SelfState | null {
  const profile = behaviorProfileForAvatar(idOrSprite);
  return profile ? initState(profile) : null;
}
