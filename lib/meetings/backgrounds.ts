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
 * The value MediaPipe's category mask uses for the person.
 *
 * Not the 0-is-background layout a multi-class segmenter uses, and reading it
 * that way inverts the whole effect — the blur lands on the face and the room
 * behind it stays sharp.
 *
 * The reason is in the model: selfie_segmenter.tflite carries exactly one
 * label, "selfie". There is no background class to be index 0, so the person is
 * index 0 and everything else gets 255, MediaPipe's filler for "no category".
 *
 * Verified against the shipped model rather than inferred from the docs, which
 * describe the multi-class layout: a frame with nobody in it comes back 100%
 * 255, and on a frame with a figure the pixels scored up to 0.99 on the one
 * confidence mask come back 0.
 */
export const PERSON_LABEL = 0;

/** Coverage for one category-mask value: opaque over the person, clear elsewhere. */
export function personCoverage(label: number): number {
  return label === PERSON_LABEL ? 255 : 0;
}

/**
 * Blend a new coverage map into the running one, in place.
 *
 * Writes into `previous` and returns it: this runs on every pixel of every
 * frame, and allocating a second buffer 24 times a second is exactly the kind
 * of garbage the frame budget cannot absorb.
 *
 * Both sides are 0-255 coverage of the person, so this no longer needs to know
 * how the segmenter labels anything — that translation happens once, on the way
 * in, in the fill functions below.
 */
export function blendCoverage(
  previous: Uint8ClampedArray,
  target: Uint8ClampedArray,
  alpha: number = MASK_SMOOTHING,
): Uint8ClampedArray {
  const a = Math.max(0, Math.min(1, alpha));
  const n = Math.min(previous.length, target.length);
  for (let i = 0; i < n; i++) {
    previous[i] += (target[i] - previous[i]) * a;
  }
  return previous;
}

// ── Headwear ─────────────────────────────────────────────────────────────────

// The model is called selfie_segmenter and it was trained on selfies: faces,
// hair, shoulders. It is markedly less sure about what sits ON a head. A cap, a
// hijab, a turban, a headwrap, a helmet, over-ear headphones, a lot of hair —
// these come back with middling confidence, and a straight yes/no at the usual
// halfway mark throws all of them away. The visible result is a person composited
// with the top of their head missing, which for a religious or medical head
// covering is not a cosmetic defect.
//
// Two things widen the mask enough to keep headwear. First, believe the model
// sooner: read its confidence rather than its verdict, and treat anything with a
// real chance of being the person as the person. Second, grow what is left
// outward a little, because the boundary the model draws still tends to sit
// inside the covering rather than outside it.
//
// Both are deliberately biased toward including too much. The cost of over-
// including is a faint ring of the real room travelling with the silhouette; the
// cost of under-including is erasing part of someone. Those are not the same
// size of mistake.

/** At or above this confidence a pixel is fully the person. */
export const CONFIDENCE_PERSON = 0.30;

/** At or below this confidence a pixel is fully background. */
export const CONFIDENCE_BACKGROUND = 0.08;

/**
 * Coverage for one pixel of the segmenter's confidence mask.
 *
 * The ramp between the two thresholds matters as much as their values: a hard
 * cut at any single number puts a staircase wherever the model is undecided,
 * which around hair and headwear is most of the boundary. Letting coverage rise
 * through the uncertain band makes the edge fall off the way an out-of-focus
 * background does, from the data rather than from a blur applied afterwards.
 */
export function coverageFromConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  if (confidence >= CONFIDENCE_PERSON) return 255;
  if (confidence <= CONFIDENCE_BACKGROUND) return 0;
  const t = (confidence - CONFIDENCE_BACKGROUND) / (CONFIDENCE_PERSON - CONFIDENCE_BACKGROUND);
  return Math.round(t * 255);
}

// ── The grid the mask is worked on ───────────────────────────────────────────

// Everything above happens per pixel per frame, so the pixel count is the whole
// cost. A silhouette is the lowest-frequency thing in the picture — it has no
// detail to lose — so it is carried on a coarse grid and the canvas scales it
// back up when it composites, which costs nothing because that scale was already
// happening.
//
// Measured on a 1280x720 frame: growing the mask at full resolution adds ~10ms
// per frame, a quarter of the budget, before the compositor has drawn anything.
// On the grid it is a fraction of a millisecond. A widened mask that made modest
// laptops drop frames would have traded one visible fault for another.

/** Roughly this wide, whatever the camera is. */
const MASK_GRID_WIDTH = 320;

export interface MaskGrid {
  width: number;
  height: number;
  /** Frame pixels per grid pixel. */
  scale: number;
}

/** The grid to carry the mask on for a given frame. */
export function maskGrid(frameWidth: number, frameHeight: number): MaskGrid {
  const fw = Number.isFinite(frameWidth) && frameWidth > 0 ? Math.round(frameWidth) : 640;
  const fh = Number.isFinite(frameHeight) && frameHeight > 0 ? Math.round(frameHeight) : 480;
  // Never upscale: a camera already smaller than the grid is worked as it is.
  const width = Math.min(fw, MASK_GRID_WIDTH);
  const scale = fw / width;
  return { width, height: Math.max(1, Math.round(fh / scale)), scale };
}

/**
 * Fill a grid-sized coverage buffer from a frame-sized confidence mask.
 *
 * Each grid cell averages the four frame pixels nearest its centre rather than
 * taking one. A single sample is cheaper, but it makes the edge land on whichever
 * pixel it happened to hit, and that choice changes frame to frame — which is
 * the crawling edge the temporal blend exists to suppress. Averaging keeps the
 * boundary where it actually is.
 */
export function sampleCoverageFromConfidence(
  out: Uint8ClampedArray,
  confidences: Float32Array,
  srcWidth: number,
  srcHeight: number,
  grid: MaskGrid,
): Uint8ClampedArray {
  return sampleInto(out, grid, srcWidth, srcHeight, (i) => coverageFromConfidence(confidences[i]));
}

/** The same, from the hard category mask — the fallback when no confidence mask arrives. */
export function sampleCoverageFromCategory(
  out: Uint8ClampedArray,
  labels: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  grid: MaskGrid,
): Uint8ClampedArray {
  return sampleInto(out, grid, srcWidth, srcHeight, (i) => personCoverage(labels[i]));
}

function sampleInto(
  out: Uint8ClampedArray,
  grid: MaskGrid,
  srcWidth: number,
  srcHeight: number,
  coverageAt: (index: number) => number,
): Uint8ClampedArray {
  if (!(srcWidth > 0) || !(srcHeight > 0)) return out;
  const sx = srcWidth / grid.width;
  const sy = srcHeight / grid.height;
  const lastX = srcWidth - 1;
  const lastY = srcHeight - 1;

  for (let gy = 0; gy < grid.height; gy++) {
    const cy = (gy + 0.5) * sy;
    const y0 = Math.min(lastY, Math.max(0, Math.floor(cy - sy / 4)));
    const y1 = Math.min(lastY, Math.max(0, Math.floor(cy + sy / 4)));
    const row0 = y0 * srcWidth;
    const row1 = y1 * srcWidth;
    const outRow = gy * grid.width;

    for (let gx = 0; gx < grid.width; gx++) {
      const cx = (gx + 0.5) * sx;
      const x0 = Math.min(lastX, Math.max(0, Math.floor(cx - sx / 4)));
      const x1 = Math.min(lastX, Math.max(0, Math.floor(cx + sx / 4)));
      const sum = coverageAt(row0 + x0) + coverageAt(row0 + x1)
                + coverageAt(row1 + x0) + coverageAt(row1 + x1);
      out[outRow + gx] = sum / 4;
    }
  }
  return out;
}

/**
 * How far to grow the mask outward, as a fraction of frame width.
 *
 * Modest on purpose. Enough to carry the boundary from inside a cap's brim to
 * outside it, not enough to drag a visible slab of room along with the
 * shoulders. Very tall headwear is beyond what growing a silhouette can fix and
 * wants a model that classifies accessories; this is the cheap 90%.
 */
const DILATE_FRACTION = 0.010;

/**
 * How far to grow the mask, in GRID pixels, for a given frame.
 *
 * Expressed against the frame and then converted, so the widening is the same
 * share of a face whatever the camera resolution and whatever grid it is
 * carried on.
 */
export function maskDilatePx(frameWidth: number, grid: MaskGrid): number {
  const width = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : 640;
  const scale = Number.isFinite(grid.scale) && grid.scale > 0 ? grid.scale : 1;
  return Math.max(1, Math.round((width * DILATE_FRACTION) / scale));
}

/**
 * Grow covered regions outward by roughly `radiusPx`, in place.
 *
 * A chamfer dilation rather than a true one: each pass carries a running value
 * forward that decays with distance, so coverage bleeds out of a covered region
 * and fades over the radius instead of ending at a hard new edge. Four passes —
 * left, right, up, down — approximate growing in every direction.
 *
 * Linear in the number of pixels and independent of the radius, which is the
 * only reason this can run on every frame. A true morphological dilation costs
 * the radius again per pixel, and at 720p24 that is the whole frame budget.
 */
export function dilateCoverage(
  coverage: Uint8ClampedArray,
  width: number,
  height: number,
  radiusPx: number,
): Uint8ClampedArray {
  const r = Math.floor(radiusPx);
  if (!(r > 0) || !(width > 0) || !(height > 0)) return coverage;
  if (coverage.length < width * height) return coverage;

  const falloff = 255 / r;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let m = 0;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      m -= falloff;
      if (coverage[i] > m) m = coverage[i]; else coverage[i] = m;
    }
    m = 0;
    for (let x = width - 1; x >= 0; x--) {
      const i = row + x;
      m -= falloff;
      if (coverage[i] > m) m = coverage[i]; else coverage[i] = m;
    }
  }

  for (let x = 0; x < width; x++) {
    let m = 0;
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      m -= falloff;
      if (coverage[i] > m) m = coverage[i]; else coverage[i] = m;
    }
    m = 0;
    for (let y = height - 1; y >= 0; y--) {
      const i = y * width + x;
      m -= falloff;
      if (coverage[i] > m) m = coverage[i]; else coverage[i] = m;
    }
  }

  return coverage;
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

/**
 * Whether two choices are the same background.
 *
 * Needed because the choice can move while a background is being applied: the
 * segmenter is a 12MB download, and someone who picks blur and then a template
 * during it has made two choices that arrive out of order. The code that
 * finishes the build compares what it was asked for against what is wanted now,
 * and a structural comparison is the only honest way to do that — the objects
 * are rebuilt on every pick, so identity says nothing.
 */
export function sameEffect(a: BackgroundEffect, b: BackgroundEffect): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "blur" && b.kind === "blur") return a.strength === b.strength;
  if (a.kind === "template" && b.kind === "template") return a.id === b.id;
  if (a.kind === "custom" && b.kind === "custom") return a.id === b.id;
  return true;
}
