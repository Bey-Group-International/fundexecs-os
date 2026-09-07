// lib/meetings/backgrounds.ts
// What a camera background is, and when to stop drawing one.
//
// The effect itself is a per-frame job: segment the person out of the camera
// frame, then paint something else behind them. That work belongs in the
// browser (see background-processor.ts). What lives here is everything the
// decision rests on and nothing that needs a canvas — which effects exist, how
// strong a blur is at a given frame size, what a native template looks like,
// what an uploaded file has to satisfy, and the point at which an effect is
// costing the call more than it is worth.
//
// Pure: no DOM, no Web Audio, no WASM. The processor calls into these rules so
// they can be tested without a GPU.

export type BlurStrength = "light" | "heavy";

export type BackgroundEffect =
  | { kind: "none" }
  | { kind: "blur"; strength: BlurStrength }
  | { kind: "template"; id: string }
  | { kind: "custom"; id: string };

export const NO_BACKGROUND: BackgroundEffect = { kind: "none" };

/** Where a member's background choice is remembered between calls. */
export const BACKGROUND_PREF_KEY = "fundexecs.meeting.background";

// ── Blur ─────────────────────────────────────────────────────────────────────

// Expressed as a fraction of frame width rather than a pixel count. A 20px blur
// is a heavy veil on a 640-wide frame and barely a smudge on a 1920-wide one, so
// a fixed radius would mean the same setting looked different on every camera.
const BLUR_FRACTION: Record<BlurStrength, number> = {
  light: 0.008,
  heavy: 0.024,
};

/** Blur radius in pixels for a strength at a given frame width. */
export function blurRadiusPx(strength: BlurStrength, frameWidth: number): number {
  const width = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : 640;
  return Math.max(2, Math.round(width * BLUR_FRACTION[strength]));
}

// ── Mask quality ─────────────────────────────────────────────────────────────

// Segmentation gives a hard yes/no per pixel, and both of its failure modes are
// visible on a face. The edge is a staircase where hair meets background, and
// the classification flickers frame to frame, so that staircase crawls. These
// two numbers are what turn a cut-out into something that reads as depth of
// field.

/**
 * How much of each new mask to believe, against the mask before it.
 *
 * Low enough to stop edges shimmering, high enough that turning your head does
 * not drag a ghost of where you were. At 24fps a value of 0.5 settles within
 * about three frames — under an eighth of a second, which is below the point
 * anyone reads as lag.
 */
export const MASK_SMOOTHING = 0.5;

/** Feather radius as a fraction of frame width. */
const FEATHER_FRACTION = 0.004;

/** How far to soften the mask edge, in pixels, at a given frame width. */
export function maskFeatherPx(frameWidth: number): number {
  const width = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : 640;
  return Math.max(1, Math.round(width * FEATHER_FRACTION));
}

/**
 * Blend a new mask into the running one, in place.
 *
 * Writes into `previous` and returns it: this runs on every pixel of every
 * frame, and allocating a second buffer 24 times a second is exactly the kind
 * of garbage the frame budget cannot absorb.
 *
 * `next` is MediaPipe's category mask, where 0 is background and anything else
 * is the person. `previous` is 0-255 coverage.
 */
export function blendMask(
  previous: Uint8ClampedArray,
  next: Uint8Array,
  alpha: number = MASK_SMOOTHING,
): Uint8ClampedArray {
  const a = Math.max(0, Math.min(1, alpha));
  const n = Math.min(previous.length, next.length);
  for (let i = 0; i < n; i++) {
    const target = next[i] === 0 ? 0 : 255;
    previous[i] += (target - previous[i]) * a;
  }
  return previous;
}

// ── Native templates ─────────────────────────────────────────────────────────

export interface GradientStop {
  /** 0-1 along the gradient axis. */
  at: number;
  color: string;
}

export interface BackgroundTemplate {
  id: string;
  name: string;
  /** Gradient axis in normalized frame coordinates, from [x0,y0] to [x1,y1]. */
  from: [number, number];
  to: [number, number];
  stops: GradientStop[];
  /** A second pass over the gradient. Drawn subtly — a background is scenery. */
  overlay: "none" | "grid" | "glow" | "horizon";
  /** True when the person will be read against a dark field. */
  dark: boolean;
}

// Built from the tokens in app/globals.css rather than from photographs: the
// palette is the brand, it scales to any camera resolution, and it adds no
// binary assets to the repository. Deep fields come first — a face reads better
// against a dark background than a bright one on most webcams.
export const NATIVE_TEMPLATES: BackgroundTemplate[] = [
  {
    id: "neural",
    name: "Neural",
    from: [0, 0],
    to: [1, 1],
    stops: [
      { at: 0, color: "rgb(9 20 38)" },
      { at: 0.55, color: "rgb(23 46 90)" },
      { at: 1, color: "rgb(29 78 216)" },
    ],
    overlay: "glow",
    dark: true,
  },
  {
    id: "terminal",
    name: "Terminal",
    from: [0, 0],
    to: [0, 1],
    stops: [
      { at: 0, color: "rgb(12 24 44)" },
      { at: 1, color: "rgb(9 20 38)" },
    ],
    overlay: "grid",
    dark: true,
  },
  {
    id: "gold-horizon",
    name: "Gold Horizon",
    from: [0, 1],
    to: [0, 0],
    stops: [
      { at: 0, color: "rgb(34 20 4)" },
      { at: 0.5, color: "rgb(120 60 10)" },
      { at: 1, color: "rgb(217 119 6)" },
    ],
    overlay: "horizon",
    dark: true,
  },
  {
    id: "boardroom",
    name: "Boardroom",
    from: [0, 0],
    to: [1, 1],
    stops: [
      { at: 0, color: "rgb(240 245 252)" },
      { at: 1, color: "rgb(210 224 243)" },
    ],
    overlay: "none",
    dark: false,
  },
];

export function templateById(id: string): BackgroundTemplate | null {
  return NATIVE_TEMPLATES.find((t) => t.id === id) ?? null;
}

// ── Uploads ──────────────────────────────────────────────────────────────────

export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type UploadRejection =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Whether a chosen file can be used as a background.
 *
 * Rejections carry the sentence shown to the person who picked the file, not a
 * code — there is exactly one place this is reported and a code would only be
 * translated back into these words.
 */
export function validateBackgroundUpload(file: { type: string; size: number }): UploadRejection {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "Backgrounds must be a JPEG, PNG or WebP image." };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, reason: "That file appears to be empty." };
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    const mb = Math.round((UPLOAD_MAX_BYTES / (1024 * 1024)) * 10) / 10;
    return { ok: false, reason: `Backgrounds must be under ${mb}MB.` };
  }
  return { ok: true };
}

// ── Cost ─────────────────────────────────────────────────────────────────────

/** Above this per-frame cost the effect is not keeping up with the camera. */
export const FRAME_BUDGET_MS = 45;

/** How many consecutive over-budget frames count as "not keeping up". */
export const SLOW_FRAME_RUN = 45;

export type SuspendReason = "bandwidth" | "cpu";

export interface SuspendDecision {
  suspend: boolean;
  reason: SuspendReason | null;
}

/**
 * Whether to stop applying the effect.
 *
 * Two ways a background stops being worth its cost. The call may already be
 * shedding video to protect audio, in which case decorating the frames that
 * remain is the wrong priority. Or segmentation may simply be too slow for this
 * machine — and a frozen face against a beautiful background is worse than a
 * moving face against a real room.
 *
 * The slow-frame test wants a sustained run rather than an average: one long
 * frame is a garbage collection pause, not a verdict on the hardware.
 */
export function shouldSuspendEffect(input: {
  bwMode: "normal" | "degraded" | "audio-only";
  consecutiveSlowFrames: number;
}): SuspendDecision {
  if (input.bwMode === "audio-only") return { suspend: true, reason: "bandwidth" };
  if (input.consecutiveSlowFrames >= SLOW_FRAME_RUN) return { suspend: true, reason: "cpu" };
  return { suspend: false, reason: null };
}

/** What to tell someone whose background just switched itself off. */
export function suspensionMessage(reason: SuspendReason): string {
  if (reason === "bandwidth") {
    return "Background effect paused — the connection is tight, so video is being kept simple.";
  }
  return "Background effect paused — it was slowing your video down on this device.";
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * A background choice as a single string, for localStorage.
 *
 * Encoded rather than JSON so a value written by an older build is either a
 * shape this understands or is ignored — a half-parsed object could otherwise
 * put someone into a call with a background they never chose.
 */
export function encodeEffect(effect: BackgroundEffect): string {
  if (effect.kind === "none") return "none";
  if (effect.kind === "blur") return `blur:${effect.strength}`;
  return `${effect.kind}:${effect.id}`;
}

export function decodeEffect(raw: string | null | undefined): BackgroundEffect {
  if (!raw) return NO_BACKGROUND;
  if (raw === "none") return NO_BACKGROUND;

  const sep = raw.indexOf(":");
  if (sep <= 0) return NO_BACKGROUND;
  const kind = raw.slice(0, sep);
  const value = raw.slice(sep + 1);
  if (!value) return NO_BACKGROUND;

  if (kind === "blur") {
    return value === "light" || value === "heavy" ? { kind: "blur", strength: value } : NO_BACKGROUND;
  }
  // A template that no longer exists falls back rather than rendering nothing.
  if (kind === "template") return templateById(value) ? { kind: "template", id: value } : NO_BACKGROUND;
  // A custom image may legitimately be missing — it lives in this browser only,
  // so a remembered id can outlive the image on another device. The caller
  // checks the store and falls back if it has gone.
  if (kind === "custom") return { kind: "custom", id: value };
  return NO_BACKGROUND;
}

/** Whether the effect needs the segmenter running at all. */
export function needsSegmentation(effect: BackgroundEffect): boolean {
  return effect.kind !== "none";
}

/** Short label for the control that opens the picker. */
export function effectLabel(effect: BackgroundEffect): string {
  if (effect.kind === "none") return "None";
  if (effect.kind === "blur") return effect.strength === "light" ? "Slight blur" : "Extra blur";
  if (effect.kind === "template") return templateById(effect.id)?.name ?? "Background";
  return "Your image";
}
