/**
 * Easing curves — the "inbetweening" of the keyframe engine.
 *
 * OpenToonz interpolates between drawn keys with speed curves; this is the
 * web-native equivalent: a small set of pure, unit-interval easing functions a
 * keyframe names to shape how it tweens into the next. All map [0,1] → [0,1]
 * with f(0)=0 and f(1)=1.
 */
export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "sine" | "hold";

export const EASINGS: Record<Easing, (t: number) => number> = {
  /** Constant speed. */
  linear: (t) => t,
  /** Accelerate from rest (quadratic). */
  easeIn: (t) => t * t,
  /** Decelerate to rest (quadratic). */
  easeOut: (t) => t * (2 - t),
  /** Smooth acceleration + deceleration (cubic smoothstep). */
  easeInOut: (t) => t * t * (3 - 2 * t),
  /** Sinusoidal ease-in-out — the natural curve for breathing/sway. */
  sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  /** Step: hold the start value until the next key (no tween). */
  hold: () => 0,
};

/** Apply a named easing, clamping t to [0,1]. */
export function ease(name: Easing, t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return (EASINGS[name] ?? EASINGS.linear)(clamped);
}
