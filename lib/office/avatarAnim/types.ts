/**
 * Data model for the OpenToonz-inspired avatar keyframe engine.
 *
 * A {@link Clip} is the web-native analogue of an OpenToonz xsheet column set:
 * named channels (bones/parameters) each carry a track of keyframes, and the
 * engine tweens between them at runtime. Everything is plain JSON-serialisable
 * data so clips can be authored declaratively (and, later, in an editor).
 */
import type { Easing } from "./easing";

/**
 * A driven parameter — the avatar's "bones" for a rigless 2.5D figure. Each is
 * a scalar the renderer reads (a pixel offset, an angle, or a 0..1 amount).
 * Kept as a string union so the sampler output is a typed record.
 */
export type AnimChannel =
  | "breatheY" // vertical body bob, px
  | "breatheScale" // subtle chest expansion, multiplier around 1
  | "leanX" // torso lean, px
  | "headTilt" // head rotation, degrees
  | "armSwing" // arm swing amount, -1..1
  | "thinkPulse" // thinking-dot intensity, 0..1
  | "gestureRaise" // hand/arm raise for present/wave, 0..1
  | "bounce"; // celebratory vertical pop, px

/** One keyframe: hold `value` at time `t` (ms), easing INTO the next key. */
export type Keyframe = {
  /** Time within the clip, in milliseconds. */
  t: number;
  /** Channel value at this key. */
  value: number;
  /** How to tween from this key to the next. Defaults to easeInOut. */
  ease?: Easing;
};

/** A keyframe track for a single channel. Keys must be sorted by `t`. */
export type Track = {
  channel: AnimChannel;
  keys: Keyframe[];
};

/** A named animation clip — a set of channel tracks over a fixed duration. */
export type Clip = {
  name: string;
  /** Total length in ms. For looping clips, the sampler wraps modulo this. */
  durationMs: number;
  /** Loop forever (idle/breathe/walk) vs. play once (wave, celebrate). */
  loop: boolean;
  tracks: Track[];
};

/** The sampled output of a clip at a moment in time: channel → value. */
export type AnimSample = Partial<Record<AnimChannel, number>>;
