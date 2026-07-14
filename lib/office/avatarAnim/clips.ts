/**
 * The avatar clip library — the declarative "xsheet".
 *
 * Named, hand-authored keyframe clips the runtime plays on the floor. Kept as
 * plain data (no renderer) so they're portable and testable, and so a future
 * editor could read/write the same shape. Amplitudes are deliberately restrained
 * to preserve the institutional 2.5D look — this is subtle, credible motion, not
 * cartoon squash-and-stretch.
 */
import type { Clip } from "./types";

export type ClipName =
  | "idleBreathe"
  | "think"
  | "present"
  | "type"
  | "review"
  | "wave"
  | "celebrate"
  | "nod";

/** A calm, asymmetric breathing loop: a quicker inhale, a held top, a slow exhale. */
const idleBreathe: Clip = {
  name: "idleBreathe",
  durationMs: 4200,
  loop: true,
  tracks: [
    {
      channel: "breatheY",
      keys: [
        { t: 0, value: 0.4, ease: "sine" },
        { t: 1400, value: -0.4, ease: "easeOut" },
        { t: 1900, value: -0.4, ease: "sine" },
        { t: 4200, value: 0.4, ease: "sine" },
      ],
    },
    {
      channel: "breatheScale",
      keys: [
        { t: 0, value: 1.0, ease: "sine" },
        { t: 1400, value: 1.015, ease: "sine" },
        { t: 1900, value: 1.015, ease: "sine" },
        { t: 4200, value: 1.0, ease: "sine" },
      ],
    },
  ],
};

/** Thinking-dot pulse, 0 → 1 → 0. */
const think: Clip = {
  name: "think",
  durationMs: 900,
  loop: true,
  tracks: [
    {
      channel: "thinkPulse",
      keys: [
        { t: 0, value: 0, ease: "sine" },
        { t: 450, value: 1, ease: "sine" },
        { t: 900, value: 0, ease: "sine" },
      ],
    },
  ],
};

/** Presenting: a slow torso sway with a raised gesturing hand. */
const present: Clip = {
  name: "present",
  durationMs: 2000,
  loop: true,
  tracks: [
    { channel: "gestureRaise", keys: [{ t: 0, value: 0.85 }, { t: 2000, value: 0.85 }] },
    {
      channel: "leanX",
      keys: [
        { t: 0, value: -0.8, ease: "sine" },
        { t: 1000, value: 0.8, ease: "sine" },
        { t: 2000, value: -0.8, ease: "sine" },
      ],
    },
    {
      channel: "armSwing",
      keys: [
        { t: 0, value: 0.25, ease: "sine" },
        { t: 1000, value: -0.25, ease: "sine" },
        { t: 2000, value: 0.25, ease: "sine" },
      ],
    },
  ],
};

/** Typing: a brisk, small keystroke flutter. */
const type: Clip = {
  name: "type",
  durationMs: 460,
  loop: true,
  tracks: [
    {
      channel: "armSwing",
      keys: [
        { t: 0, value: -0.35, ease: "easeInOut" },
        { t: 230, value: 0.35, ease: "easeInOut" },
        { t: 460, value: -0.35, ease: "easeInOut" },
      ],
    },
    { channel: "breatheY", keys: [{ t: 0, value: 0.2 }, { t: 230, value: -0.1 }, { t: 460, value: 0.2 }] },
  ],
};

/** Reviewing: a gentle head tilt and page-bob. */
const review: Clip = {
  name: "review",
  durationMs: 2400,
  loop: true,
  tracks: [
    {
      channel: "headTilt",
      keys: [
        { t: 0, value: -3, ease: "sine" },
        { t: 1200, value: 3, ease: "sine" },
        { t: 2400, value: -3, ease: "sine" },
      ],
    },
    {
      channel: "breatheY",
      keys: [
        { t: 0, value: 0.5, ease: "sine" },
        { t: 1200, value: -0.3, ease: "sine" },
        { t: 2400, value: 0.5, ease: "sine" },
      ],
    },
  ],
};

/** Wave — a one-shot greeting: raise, oscillate, lower. */
const wave: Clip = {
  name: "wave",
  durationMs: 1300,
  loop: false,
  tracks: [
    {
      channel: "gestureRaise",
      keys: [
        { t: 0, value: 0, ease: "easeOut" },
        { t: 250, value: 1, ease: "sine" },
        { t: 1050, value: 1, ease: "easeIn" },
        { t: 1300, value: 0 },
      ],
    },
    {
      channel: "armSwing",
      keys: [
        { t: 250, value: -0.6, ease: "sine" },
        { t: 550, value: 0.6, ease: "sine" },
        { t: 850, value: -0.6, ease: "sine" },
        { t: 1050, value: 0, ease: "sine" },
      ],
    },
  ],
};

/** Celebrate — a one-shot vertical pop with a raised arm. */
const celebrate: Clip = {
  name: "celebrate",
  durationMs: 1400,
  loop: false,
  tracks: [
    {
      channel: "bounce",
      keys: [
        { t: 0, value: 0, ease: "easeOut" },
        { t: 200, value: -3.5, ease: "easeIn" },
        { t: 500, value: 0, ease: "easeOut" },
        { t: 700, value: -2.5, ease: "easeIn" },
        { t: 1000, value: 0, ease: "sine" },
        { t: 1400, value: 0 },
      ],
    },
    { channel: "gestureRaise", keys: [{ t: 0, value: 0, ease: "easeOut" }, { t: 200, value: 1 }, { t: 1100, value: 1, ease: "easeIn" }, { t: 1400, value: 0 }] },
  ],
};

/** Nod — a one-shot acknowledgment dip. */
const nod: Clip = {
  name: "nod",
  durationMs: 480,
  loop: false,
  tracks: [
    {
      channel: "headTilt",
      keys: [
        { t: 0, value: 0, ease: "easeIn" },
        { t: 200, value: 8, ease: "easeOut" },
        { t: 480, value: 0, ease: "sine" },
      ],
    },
  ],
};

export const CLIPS: Record<ClipName, Clip> = {
  idleBreathe,
  think,
  present,
  type,
  review,
  wave,
  celebrate,
  nod,
};

export function getClip(name: ClipName): Clip {
  return CLIPS[name];
}
