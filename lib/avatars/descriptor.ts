// lib/avatars/descriptor.ts
// The Avatar Descriptor — a compact, versioned, renderer-agnostic profile that
// carries an avatar's APPEARANCE and BEHAVIOR together (see
// docs/avatars/AVATAR_SYSTEM_SPEC.md §4.4 / §5.6). This is the shared contract
// the appearance, animation, behavior, and self-model modules all read; it is
// deliberately free of any DOM/rendering types so the same descriptor can drive
// the Phase-0/1 2.5D sprite office today and a Phase-2 3D rig later.

import type { AvatarStatus } from "@/lib/brains/avatars";
import type { BrainKey } from "@/lib/brains/types";

export type { AvatarStatus };

/** `human` = rigged biped; `mascot` = the coin (simplified rig, same behavior surface). */
export type Archetype = "human" | "mascot";

export interface BodySpec {
  /** Reference height in metres (spec §2.2: 1.55–1.95 human; ~1.2 mascot). */
  height: number;
  build?: string;
  /** Normalized morph sliders in [-1, 1]: shoulders, chest, waist, hips, muscle, … */
  morphs?: Record<string, number>;
}

/** One modular customization layer, resolved in paint order (spec §4.1). */
export interface LayerSpec {
  slot: string;
  item: string;
  palette?: Record<string, string>;
  /** Attachment anchor for held/accessory items, e.g. "hand_r". */
  anchor?: string;
}

export interface AppearanceSpec {
  archetype: Archetype;
  body: BodySpec;
  skin?: { tone: string };
  hair?: { style: string; color: string };
  face?: { preset?: string; morphs?: Record<string, number> };
  layers: LayerSpec[];
  materials?: Record<string, string>;
}

/** OCEAN-style personality, each in [0, 1] (spec §5.6). */
export interface Personality {
  extraversion: number;
  conscientiousness: number;
  openness: number;
  agreeableness: number;
  stability: number;
}

export type GoalKind = "work" | "social" | "idle" | "reactive";

export interface GoalSpec {
  id: string;
  kind: GoalKind;
  /** Relative priority in [0, 1]. */
  priority: number;
  /** Completion in [0, 1]; optional, defaults to 0. */
  progress?: number;
}

export interface BehaviorProfile {
  personality: Personality;
  /** Homeostatic baselines each drive relaxes toward, in [0, 1]. */
  baseline: { energy: number; focus: number; social: number };
  goals: GoalSpec[];
  /** The zone this avatar returns to on the safe fallback (spec §5.3). */
  homeZone: string;
  roamProfile?: "client_facing" | "desk_bound" | string;
  /** Bias toward social behaviors, [0, 1]. */
  socialBias: number;
  voice: { tone: string; verbosity: "concise" | "detailed" | string };
}

export interface AvatarDescriptor {
  schema: "fundexecs.avatar/1.0";
  id: string;
  identity: { role: string; displayName?: string; pronouns?: string };
  /** The Brain that powers this avatar (see lib/brains/avatars.ts), or null. */
  brainKey?: BrainKey | null;
  status?: AvatarStatus;
  appearance: AppearanceSpec;
  behavior: BehaviorProfile;
}

/** Clamp helper shared by descriptor + self-model math. */
export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** A neutral, valid BehaviorProfile — a base to spread persona overrides onto. */
export function defaultBehaviorProfile(overrides: Partial<BehaviorProfile> = {}): BehaviorProfile {
  return {
    personality: {
      extraversion: 0.5,
      conscientiousness: 0.6,
      openness: 0.5,
      agreeableness: 0.6,
      stability: 0.6,
      ...(overrides.personality ?? {}),
    },
    baseline: { energy: 0.7, focus: 0.6, social: 0.5, ...(overrides.baseline ?? {}) },
    goals: overrides.goals ?? [{ id: "work", kind: "work", priority: 0.7 }],
    homeZone: overrides.homeZone ?? "command_center",
    roamProfile: overrides.roamProfile ?? "desk_bound",
    socialBias: overrides.socialBias ?? 0.5,
    voice: { tone: "measured", verbosity: "concise", ...(overrides.voice ?? {}) },
  };
}
