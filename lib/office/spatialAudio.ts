// Pure spatial-audio helpers for the Virtual Office proximity voice layer.
//
// DOM-free math so it stays unit-testable and can be shared by the voice hook.
// `gainForDistance` maps a peer's tile-space distance to a playback volume in
// [0, 1] that fades with distance, delegating the falloff curve to the shared
// proximity model so a peer's audio volume and their avatar's opacity stay in
// lockstep (the same smoothstep ramp drives both).
import { PROXIMITY_RADIUS } from "./layout";
import { proximityVolume } from "./presence";

/**
 * Spatial-audio gain for a peer `dist` tiles away: 1 when co-located, smoothly
 * falling to 0 at (and beyond) `radius`. Delegates to `proximityVolume` so the
 * audio falloff matches the visual proximity fade exactly. Non-finite input
 * (e.g. a peer with no known position) is treated as out of range → 0.
 */
export function gainForDistance(
  dist: number,
  radius: number = PROXIMITY_RADIUS,
): number {
  if (!Number.isFinite(dist)) return 0;
  return proximityVolume(dist, radius);
}

/**
 * Clamp a value into [0, 1] — a defensive guard before assigning to an
 * `HTMLAudioElement.volume`, which throws on out-of-range or NaN values.
 */
export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
