/**
 * The tweening core — sample a clip at a point in time.
 *
 * Pure and deterministic: given a clip and a time, return each channel's
 * interpolated value. This is where "inbetweening" happens — between two
 * keyframes the value is eased along the earlier key's curve. No renderer, no
 * clock; the caller owns time, so this is fully unit-testable.
 */
import type { Clip, Track, AnimSample } from "./types";
import { ease } from "./easing";

/** Interpolated value of one track at time `t` (ms), clamped to the key range. */
export function sampleTrack(track: Track, t: number): number {
  const keys = track.keys;
  if (keys.length === 0) return 0;
  if (keys.length === 1 || t <= keys[0].t) return keys[0].value;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.value;

  // Find the segment [k0, k1] containing t.
  let k0 = keys[0];
  let k1 = keys[1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) {
      k0 = keys[i];
      k1 = keys[i + 1];
      break;
    }
  }
  const span = k1.t - k0.t;
  if (span <= 0) return k1.value;
  const local = (t - k0.t) / span;
  const eased = ease(k0.ease ?? "easeInOut", local);
  return k0.value + (k1.value - k0.value) * eased;
}

/**
 * Sample every channel of a clip at time `tMs`. Looping clips wrap modulo the
 * duration; one-shots clamp to the end. Returns a sparse record — only the
 * channels the clip actually drives.
 */
export function sampleClip(clip: Clip, tMs: number): AnimSample {
  let t = tMs;
  if (clip.loop && clip.durationMs > 0) {
    t = ((tMs % clip.durationMs) + clip.durationMs) % clip.durationMs;
  } else if (t > clip.durationMs) {
    t = clip.durationMs;
  } else if (t < 0) {
    t = 0;
  }
  const out: AnimSample = {};
  for (const track of clip.tracks) {
    out[track.channel] = sampleTrack(track, t);
  }
  return out;
}

/** True once a non-looping clip has run past its duration. */
export function isClipFinished(clip: Clip, tMs: number): boolean {
  return !clip.loop && tMs >= clip.durationMs;
}
