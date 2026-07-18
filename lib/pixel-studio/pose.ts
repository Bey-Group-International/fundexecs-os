/**
 * Pose model — turns an (animation state, direction, frame index) into concrete
 * per-frame offsets the painters read. Centralizing this keeps every body part
 * synchronized across the shared frame grid (arms, legs, head all agree on the
 * same walk phase) and makes the animation contract testable in isolation.
 */
import type { AnimationState, Direction } from "./types";

export interface Pose {
  /** Whole-figure vertical offset in native pixels (never moves the feet). */
  bodyDY: number;
  /** Extra head-only vertical offset (nods, talk bob). */
  headDY: number;
  /** Leg swing: -1 = left forward, 0 = neutral, +1 = right forward. */
  legPhase: -1 | 0 | 1;
  /** Arm swing (opposes the legs during a walk). */
  armPhase: -1 | 0 | 1;
  /** Eyes closed this frame (idle blink / talk emphasis). */
  blink: boolean;
  /** Mouth openness 0..2 (talk + approve). */
  mouthOpen: 0 | 1 | 2;
  /** Optional professional gesture during approve. */
  gesture: "none" | "nod" | "thumb";
}

const NEUTRAL: Pose = {
  bodyDY: 0,
  headDY: 0,
  legPhase: 0,
  armPhase: 0,
  blink: false,
  mouthOpen: 0,
  gesture: "none",
};

/** Deterministic pose for a given state/direction/frame. */
export function poseFor(state: AnimationState, _dir: Direction, frame: number): Pose {
  switch (state) {
    case "walk": {
      const legs: (-1 | 0 | 1)[] = [-1, 0, 1];
      const leg = legs[frame % 3];
      return { ...NEUTRAL, legPhase: leg, armPhase: (-leg as -1 | 0 | 1), bodyDY: frame % 3 === 1 ? -1 : 0 };
    }
    case "idle": {
      // Feet stay planted; only a blink + 1px chest breath on frame 1.
      return { ...NEUTRAL, blink: frame % 2 === 1, bodyDY: 0 };
    }
    case "talk": {
      const mouths: (0 | 1 | 2)[] = [0, 1, 2, 1];
      const nod = [0, 0, 1, 0][frame % 4];
      return { ...NEUTRAL, mouthOpen: mouths[frame % 4], headDY: nod };
    }
    case "approve": {
      // A dignified nod plus a small thumb gesture mid-animation.
      const nod = [0, 1, 1, 0][frame % 4];
      const gesture = frame % 4 === 1 || frame % 4 === 2 ? "thumb" : "nod";
      return { ...NEUTRAL, headDY: nod, gesture, mouthOpen: frame % 4 === 2 ? 1 : 0 };
    }
    default:
      return NEUTRAL;
  }
}
