/**
 * FundExecs OS — 3D avatar animation-state machine (pure, testable).
 *
 * Maps an agent's program `AgentState` to a concrete animation clip and a
 * cross-fade plan for the 3D office. Kept separate from `ThreeOfficeRenderer`
 * (which owns the Three.js `AnimationMixer`) so the state→clip logic is pure and
 * unit-testable, and so a rigged glTF can be dropped in later without touching
 * the mapping: author the clips named in `AVATAR_CLIPS`, and the renderer
 * cross-fades between them per this module.
 *
 * Concept aligns with `the-delegation`'s state-machine-driven NPCs and the
 * Unity-style animation set the Phaser `ExecutiveAvatar` already models — but
 * this is an independent native implementation over our `AgentState`.
 */

import type { AgentState } from "../program/officeProgram";

/** The canonical clip names a rigged office avatar glTF must provide. */
export const AVATAR_CLIPS = [
  "idle",
  "walk",
  "type",
  "talk",
  "review",
  "present",
  "celebrate",
] as const;

export type AvatarClip = (typeof AVATAR_CLIPS)[number];

/** How a clip should play. */
export type ClipPlan = {
  clip: AvatarClip;
  /** Whether the clip loops (false = play once, then hold the last frame). */
  loop: boolean;
  /** Cross-fade duration into this clip, milliseconds. */
  crossfadeMs: number;
};

const DEFAULT_CROSSFADE = 250;

/** Base clip for each program state. `moving` is the only inherently locomotive
 *  state; everything else is a stationary desk/among-peers animation. */
const STATE_TO_CLIP: Record<AgentState, ClipPlan> = {
  idle: { clip: "idle", loop: true, crossfadeMs: DEFAULT_CROSSFADE },
  listening: { clip: "idle", loop: true, crossfadeMs: DEFAULT_CROSSFADE },
  classifying: { clip: "type", loop: true, crossfadeMs: DEFAULT_CROSSFADE },
  assigned: { clip: "idle", loop: true, crossfadeMs: DEFAULT_CROSSFADE },
  moving: { clip: "walk", loop: true, crossfadeMs: 150 },
  working: { clip: "type", loop: true, crossfadeMs: DEFAULT_CROSSFADE },
  collaborating: { clip: "talk", loop: true, crossfadeMs: DEFAULT_CROSSFADE },
  waiting_for_approval: { clip: "idle", loop: true, crossfadeMs: DEFAULT_CROSSFADE },
  reviewing: { clip: "review", loop: true, crossfadeMs: DEFAULT_CROSSFADE },
  complete: { clip: "celebrate", loop: false, crossfadeMs: 180 },
  blocked: { clip: "idle", loop: true, crossfadeMs: DEFAULT_CROSSFADE },
};

/** Options that can override the state's base clip. */
export type ClipContext = {
  /** Seated at a desk: a seated actor can't walk, so `walk` becomes `type`. */
  seated?: boolean;
  /** Actively traversing a path: forces `walk` regardless of state. */
  moving?: boolean;
};

/**
 * Resolve the clip an actor should play. Precedence:
 *   1. `ctx.moving` (mid-path) → `walk`, unless seated (then `type`).
 *   2. the state's base clip, with `walk` downgraded to `type` when seated.
 */
export function resolveClipPlan(state: AgentState, ctx: ClipContext = {}): ClipPlan {
  if (ctx.moving) {
    return ctx.seated
      ? { clip: "type", loop: true, crossfadeMs: DEFAULT_CROSSFADE }
      : { clip: "walk", loop: true, crossfadeMs: 150 };
  }
  const base = STATE_TO_CLIP[state];
  if (ctx.seated && base.clip === "walk") {
    return { clip: "type", loop: true, crossfadeMs: DEFAULT_CROSSFADE };
  }
  return base;
}

/** Convenience: just the clip name for a state/context. */
export function resolveClip(state: AgentState, ctx: ClipContext = {}): AvatarClip {
  return resolveClipPlan(state, ctx).clip;
}

/** A planned cross-fade between two clips (or `null` when already on target). */
export type Transition = { from: AvatarClip; to: AvatarClip; crossfadeMs: number } | null;

/**
 * Plan the cross-fade from the currently playing clip to the clip the new
 * state/context wants. Returns `null` when no change is needed, so the renderer
 * can skip a redundant mixer cross-fade.
 */
export function planTransition(current: AvatarClip, state: AgentState, ctx: ClipContext = {}): Transition {
  const target = resolveClipPlan(state, ctx);
  if (target.clip === current) return null;
  return { from: current, to: target.clip, crossfadeMs: target.crossfadeMs };
}
