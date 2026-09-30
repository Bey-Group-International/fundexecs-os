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

/**
 * How much of each new mask to believe where the model keeps CONTRADICTING itself.
 *
 * Measured, because the constant-alpha blend was spending its whole budget in the
 * wrong place. Peak-to-peak coverage swing for a pixel oscillating frame to frame,
 * settled, at MASK_SMOOTHING = 0.5:
 *
 *   chair edge   (0.05<->0.25 confidence)   raw 196/255 -> 65/255
 *   hair wisp    (0.10<->0.30)              raw 196/255 -> 66/255
 *   headwear     (0.20<->0.34)              raw  98/255 -> 33/255
 *   confident body / background             raw   0     ->  0
 *
 * The confident row is the finding. Those pixels are stable BEFORE smoothing, so
 * smoothing them achieves nothing -- yet they got the same responsive alpha as
 * everything else, while the pixels that actually strobe kept a quarter of their
 * swing. A chair's edge flipping 65/255 every other frame is the strobe you see.
 *
 * A square wave of amplitude A blended at alpha a settles to A*a/(2-a), so holding
 * the residue under about 10/255 -- below where an eye picks it out of a moving
 * image -- needs a <= 0.097. Hence 0.1.
 */
export const MASK_SMOOTHING_UNCERTAIN = 0.1;

/**
 * How big a frame-to-frame change counts as the model saying something.
 *
 * Below this a change is quantisation dither, not an opinion, and must not read as
 * the model contradicting itself. Measured: a pixel dithering by up to 6 and then
 * genuinely becoming background hides in 5 frames at this deadband -- the same as
 * the uniform blend -- against 6 frames at a deadband of 0, because zero reads the
 * dither as a reversal and carries one slow frame into a real transition. Raising
 * it to 16 instead cost real motion: a swaying edge lagged 25.3 rather than 20.3.
 */
export const MASK_REVERSAL_DEADBAND = 8;

/**
 * How many reversals confirm a flicker.
 *
 * One. Measured against two and three: all three settle to exactly the same swing,
 * and one engages soonest -- the second frame of a new flicker is already damped
 * rather than the third or fourth. There is nothing to buy by waiting.
 */
export const MASK_REVERSAL_CONFIRM = 1;

/**
 * Per-pixel memory for the reversal detector. Allocated once per mask size.
 *
 * Two small buffers, ~130KB each at the 481x270 grid, on a stage that costs 0.42ms
 * per frame against dilateCoverage's 7.55ms. The memory is the price; the time is
 * noise.
 */
export interface MaskAgreement {
  /** Last frame's target coverage, which is what a delta is measured against. */
  previousTarget: Uint8ClampedArray;
  /**
   * Packed per pixel: bits 0-5 the confirmed-reversal count, bits 6-7 the
   * direction of the last change that cleared the deadband (0 none, 1 rising,
   * 2 falling).
   */
  state: Uint8Array;
  /** False until a first frame has filled `previousTarget`, so there is a delta. */
  primed: boolean;
}

const SIGN_NONE = 0;
const SIGN_RISING = 1 << 6;
const SIGN_FALLING = 2 << 6;
const SIGN_MASK = 3 << 6;
const COUNT_MASK = 0x3f;

export function createMaskAgreement(length: number): MaskAgreement {
  const n = Math.max(0, Math.floor(length));
  return { previousTarget: new Uint8ClampedArray(n), state: new Uint8Array(n), primed: false };
}

/**
 * Blend a new coverage map into the running one at a rate set by whether the model
 * is CONTRADICTING ITSELF on that pixel.
 *
 * The rule this replaces read certainty off the running history, which was the
 * wrong signal and was caught as a privacy finding on #1203. A pixel settled at
 * 128 reads as maximally undecided even when the incoming mask has been
 * confidently calling it background for several frames -- so newly exposed room
 * stayed partly visible about 208ms longer than the uniform blend, on the one
 * stage whose entire job is to hide the room. Measured: hiding from 255 took 10
 * frames rather than 5.
 *
 * What separates a real movement from a flicker is not magnitude, and not which
 * side of the midpoint the mask picked: it is whether successive changes keep
 * UNDOING each other. A real transition is one large delta and then nothing; a
 * flicker is +A, -A, +A, -A for as long as it lasts. So the signal is a sign
 * reversal of the delta, and everything else runs at full speed.
 *
 * Measured against both predecessors, and better than each on every axis:
 *
 *                    hide 255->0   chair 196<->0   headwear 98<->0   pan lag
 *   uniform (old)        5 frames        65.3/255          32.7/255      31.8
 *   history-keyed       10 frames        14.3/255          19.1/255     110.0
 *   this rule            5 frames        10.3/255           5.2/255      31.8
 *
 * Headwear is the row worth naming. It oscillates 98<->0, entirely on the
 * background side of the midpoint, so a rule asking "which side did the model
 * pick" sees perfect agreement and smooths it not at all -- an earlier draft of
 * this did exactly that and left headwear at 32.7. Asking whether the model is
 * reversing itself catches it, and reaches the analytic floor for the slow rate
 * (98*0.1/1.9 = 5.2) rather than a fraction of it.
 *
 * Same contract as blendCoverage: writes into `previous`, returns it, allocates
 * nothing. `agreement` is mutated too -- it is this rule's memory.
 */
export function blendCoverageByAgreement(
  previous: Uint8ClampedArray,
  target: Uint8ClampedArray,
  agreement: MaskAgreement,
  confident: number = MASK_SMOOTHING,
  uncertain: number = MASK_SMOOTHING_UNCERTAIN,
  deadband: number = MASK_REVERSAL_DEADBAND,
  confirm: number = MASK_REVERSAL_CONFIRM,
): Uint8ClampedArray {
  const hi = Math.max(0, Math.min(1, confident));
  const lo = Math.max(0, Math.min(1, uncertain));
  const n = Math.min(previous.length, target.length, agreement.previousTarget.length);
  const band = Math.max(0, deadband);
  // Capped at `confirm` rather than at the byte: a count beyond it is evidence the
  // ramp can never use, and it takes just as many quiet frames to unwind. A draft
  // that capped at 127 took 18 frames to return to full speed after a flicker
  // stopped -- the same latency problem this rule exists to fix, in a new hat.
  const cap = Math.max(1, Math.min(COUNT_MASK, Math.floor(confirm)));

  const prevTarget = agreement.previousTarget;
  const state = agreement.state;

  // The first frame has nothing to compare against, so every pixel blends at the
  // confident rate. Seeding the deltas from a fabricated previous frame would
  // invent reversals that never happened.
  if (!agreement.primed) {
    for (let i = 0; i < n; i++) {
      previous[i] = previous[i] + (target[i] - previous[i]) * hi;
      prevTarget[i] = target[i];
      state[i] = 0;
    }
    agreement.primed = true;
    return previous;
  }

  for (let i = 0; i < n; i++) {
    const t = target[i];
    const delta = t - prevTarget[i];
    prevTarget[i] = t;

    const packed = state[i];
    let count = packed & COUNT_MASK;
    let sign = packed & SIGN_MASK;

    if (delta > band || delta < -band) {
      const next = delta > 0 ? SIGN_RISING : SIGN_FALLING;
      // A reversal only counts against a direction already on record: the first
      // significant change on a pixel is a movement, not a contradiction.
      count = sign !== SIGN_NONE && next !== sign ? Math.min(count + 1, cap) : 0;
      sign = next;
    } else {
      // A quiet frame. The model is no longer arguing with itself, so the pixel
      // returns to full speed rather than serving out a sentence.
      count = 0;
      // And the direction goes with it. A movement after a settled stretch is a
      // new movement, not a contradiction of whatever happened before the pause:
      // keeping RISING on record across an empty chair made a person LEAVING read
      // as a reversal, which hid the room they exposed a frame slower. Continuous
      // flicker is unaffected, because there every frame is a significant one and
      // this branch never runs.
      sign = SIGN_NONE;
    }
    state[i] = sign | count;

    const a = hi - (hi - lo) * Math.min(1, count / cap);
    previous[i] = previous[i] + (t - previous[i]) * a;
  }
  return previous;
}


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

// ── The width of the seam ────────────────────────────────────────────────────

/**
 * How much to tighten the alpha ramp before compositing.
 *
 * The seam is currently soft because it is BLURRED, which is not the same as
 * being accurate, and the difference is the bleed. The mask is upscaled from the
 * grid (bilinear, so a couple of pixels of ramp) and then feathered by a blur of
 * a few more, so the alpha crosses from background to person over roughly eight
 * pixels at 720p. Every pixel in that band is part room and part person — which
 * is exactly right along hair, and is a visible ring of the real room everywhere
 * else.
 *
 * Narrowing the band before it is upscaled keeps the softness and loses the ring.
 * A factor of two halves it: a pixel already most of the way to covered goes
 * fully covered, a pixel barely covered goes clear, and the genuinely undecided
 * middle still crosses gradually. The upscale and the feather then soften what is
 * left, so there is no staircase to come back.
 *
 * It helps both faults at once, which is the reason to believe it. Headwear the
 * model put at 0.28 confidence sits high in the band and is pushed to fully
 * opaque; a halo pixel the model barely saw sits low and is pushed to nothing.
 */
export const EDGE_CONTRAST = 2;

/**
 * Tighten the ramp, writing into `out`.
 *
 * Deliberately NOT in place, and the reason is easy to get wrong: this runs after
 * the temporal blend, and the blend's running history has to keep its graded
 * values. Sharpening the history would compound every frame until the mask was
 * binary, which is the crawling staircase the blend exists to prevent — the
 * smoothing would still be running and would have nothing left to smooth.
 */
export function sharpenEdge(
  out: Uint8ClampedArray,
  coverage: Uint8ClampedArray,
  contrast: number = EDGE_CONTRAST,
): Uint8ClampedArray {
  const k = Number.isFinite(contrast) && contrast > 0 ? contrast : 1;
  const n = Math.min(out.length, coverage.length);
  // Around the midpoint, so full coverage and no coverage are both fixed points.
  const mid = 127.5;
  for (let i = 0; i < n; i++) {
    const v = (coverage[i] - mid) * k + mid;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
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

/**
 * At or above this confidence a pixel is fully the person.
 *
 * Deliberately low, and it stays low. Raising it to 0.45 was tried as a way to
 * narrow the halo, on the reasoning that a pixel the model is only 30% sure about
 * should not be painted as solidly part of someone. The headwear tests refused
 * it, and they were right: at 0.28 confidence — squarely the case a cap or a
 * headwrap lands in — that raise took the fabric from fully opaque to 58%, which
 * is the room showing THROUGH the top of somebody's head.
 *
 * The two mistakes are not the same size. A faint halo is cosmetic. A
 * semi-transparent head covering is not, and a threshold is the wrong place to
 * pay for tidiness. The halo is dealt with where it is actually caused — growth
 * that used to reach equally in all directions and into pixels the model was
 * confident were background. See `maskDilatePx` and `dilateCeiling`.
 */
export const CONFIDENCE_PERSON = 0.30;

/**
 * At or below this confidence a pixel is fully background.
 *
 * Lowered alongside the raise above, which widens the uncertainty band from both
 * ends. That is deliberate: the band is what growth is allowed to fill, so faint
 * headwear needs to be IN it rather than clamped to nothing.
 *
 * At 0.04 a pixel reaching the band at all is under a twentieth of full
 * coverage, so nothing becomes visible that was not; what changes is that
 * constrained growth now has a foothold there, and faint headwear can be filled
 * rather than clamped to nothing before growth ever sees it.
 */
export const CONFIDENCE_BACKGROUND = 0.04;

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

/**
 * How many pixels of mask one frame is allowed to cost.
 *
 * A budget, not a width, and the difference matters. This was `MASK_GRID_WIDTH =
 * 320` — a fixed width, which makes the mask's cost depend on the camera's
 * ASPECT and, worse, backwards on its size: raising that width to 480 would have
 * given a 640x480 webcam a 480x360 mask, 173k pixels, while a 1280x720 camera got
 * 480x270, 130k. The cheap old camera would have paid more per frame than the
 * good new one, which is the opposite of what a frame budget is for.
 *
 * Bounding the pixel count instead makes the per-frame cost the same whatever
 * the camera, and spends it on as fine a mask as that buys. ~130k is 480x270,
 * measured at a fraction of a millisecond for the sampling and growth passes
 * against a 45ms budget — and reachable now because pacing the loop to the rate
 * the canvas is captured at freed two to five times the budget it used to waste.
 */
const MASK_GRID_PIXELS = 130_000;

export interface MaskGrid {
  width: number;
  height: number;
  /** Frame pixels per grid pixel. */
  scale: number;
}

/**
 * The grid to carry the mask on for a given frame.
 *
 * A silhouette is the lowest-frequency thing in the picture — it has no fine
 * detail to lose — so it is carried coarse and the canvas scales it back up when
 * it composites, which costs nothing because that scale was already happening.
 * How coarse is whatever `MASK_GRID_PIXELS` allows, so the cost is constant and
 * the resolution is as good as that cost buys.
 */
export function maskGrid(frameWidth: number, frameHeight: number): MaskGrid {
  const fw = Number.isFinite(frameWidth) && frameWidth > 0 ? Math.round(frameWidth) : 640;
  const fh = Number.isFinite(frameHeight) && frameHeight > 0 ? Math.round(frameHeight) : 480;
  // Never upscale: a camera already inside the budget is worked as it is. There
  // is nothing to gain from a mask finer than the frame it came from.
  const scale = Math.max(1, Math.sqrt((fw * fh) / MASK_GRID_PIXELS));
  const width = Math.max(1, Math.round(fw / scale));
  return { width, height: Math.max(1, Math.round(fh / scale)), scale: fw / width };
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
 * How far to grow the mask, as a fraction of frame width, per direction.
 *
 * Growth used to be one number applied equally in all four directions, and its
 * own comment named the price: "a faint ring of the real room travelling with
 * the silhouette". That ring is the bleed, and most of it was being paid for
 * nothing — because the thing the growth exists to save is headwear, and
 * headwear is ABOVE a head.
 *
 * So the directions are not equal any more:
 *
 * `up` is the one that matters. A cap's brim, a headwrap's crown, a helmet, the
 * top of a lot of hair — the model's boundary tends to sit inside the fabric,
 * and this carries it across.
 *
 * `side` is small but not zero: a headwrap or a pair of over-ear headphones is
 * wider than the head inside it, so some sideways reach is part of the same
 * fix. Kept small because this is also the direction that hangs a halo off
 * somebody's arms.
 *
 * `down` is zero. Nothing sits under a person that growing the silhouette
 * recovers, and growing downward drags the desk and the floor up into them.
 */
const DILATE_FRACTION = { up: 0.012, side: 0.004, down: 0 } as const;

/** Growth in GRID pixels, per direction. */
export interface DilateRadii {
  up: number;
  down: number;
  side: number;
}

/**
 * How far to grow the mask, in GRID pixels, for a given frame.
 *
 * Expressed against the frame and then converted, so the widening is the same
 * share of a face whatever the camera resolution and whatever grid it is carried
 * on. A direction whose fraction is zero stays zero rather than being floored to
 * one: "do not grow downward" has to survive the conversion.
 */
export function maskDilatePx(frameWidth: number, grid: MaskGrid): DilateRadii {
  const width = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : 640;
  const scale = Number.isFinite(grid.scale) && grid.scale > 0 ? grid.scale : 1;
  const inGrid = (fraction: number) =>
    fraction <= 0 ? 0 : Math.max(1, Math.round((width * fraction) / scale));
  return {
    up: inGrid(DILATE_FRACTION.up),
    side: inGrid(DILATE_FRACTION.side),
    down: inGrid(DILATE_FRACTION.down),
  };
}

/**
 * The limit on what growth may claim, one value per pixel.
 *
 * This is the other half of the bleed, and the more important half. Growing a
 * silhouette outward cannot tell the fabric of a headwrap from the wall behind
 * a shoulder — both are simply "not yet covered" — so an unconstrained grow
 * widens the mask into whichever it meets, and the wall is the commoner
 * neighbour.
 *
 * The model already knows the difference and the ramp in
 * `coverageFromConfidence` already carries it: a pixel it is unsure about lands
 * somewhere between 0 and 255, and a pixel it is confident is background lands
 * exactly 0. So growth is allowed to FILL uncertainty and forbidden to invent
 * coverage where there is none. Headwear is uncertain; the wall is not.
 *
 * Built before the grow, from the sampled coverage, because the grow overwrites
 * it in place.
 */
export function dilateCeiling(
  out: Uint8ClampedArray,
  coverage: Uint8ClampedArray,
): Uint8ClampedArray {
  const n = Math.min(out.length, coverage.length);
  for (let i = 0; i < n; i++) out[i] = coverage[i] > 0 ? 255 : 0;
  return out;
}

/**
 * Grow covered regions outward, in place.
 *
 * A chamfer dilation rather than a true one: each pass carries a running value
 * forward that decays with distance, so coverage bleeds out of a covered region
 * and fades over the radius instead of ending at a hard new edge. The passes run
 * per direction, so `up` can reach further than `side` and `down` need not run
 * at all.
 *
 * Linear in the number of pixels and independent of the radius, which is the
 * only reason this can run on every frame. A true morphological dilation costs
 * the radius again per pixel, and at 720p that is the whole frame budget.
 *
 * `ceiling`, when given, caps every pixel — see `dilateCeiling`. It is omitted
 * on the category-mask fallback path, where coverage is only ever 0 or 255 and
 * there is no uncertainty band to fill: constraining growth there would grow
 * nothing at all and give back the missing headwear this exists to keep.
 */
export function dilateCoverage(
  coverage: Uint8ClampedArray,
  width: number,
  height: number,
  radii: DilateRadii,
  ceiling?: Uint8ClampedArray | null,
): Uint8ClampedArray {
  if (!(width > 0) || !(height > 0)) return coverage;
  if (coverage.length < width * height) return coverage;

  const up = Math.floor(radii.up);
  const down = Math.floor(radii.down);
  const side = Math.floor(radii.side);

  if (side > 0) {
    const falloff = 255 / side;
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
  }

  // Upward means toward y = 0, so the sweep that carries coverage up the image
  // runs from the bottom row to the top.
  if (up > 0) {
    const falloff = 255 / up;
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let y = height - 1; y >= 0; y--) {
        const i = y * width + x;
        m -= falloff;
        if (coverage[i] > m) m = coverage[i]; else coverage[i] = m;
      }
    }
  }

  if (down > 0) {
    const falloff = 255 / down;
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let y = 0; y < height; y++) {
        const i = y * width + x;
        m -= falloff;
        if (coverage[i] > m) m = coverage[i]; else coverage[i] = m;
      }
    }
  }

  if (ceiling) {
    const n = Math.min(coverage.length, ceiling.length);
    for (let i = 0; i < n; i++) {
      if (coverage[i] > ceiling[i]) coverage[i] = ceiling[i];
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

/**
 * The frame rate the composited canvas is captured at, and therefore the rate
 * worth compositing at.
 *
 * The processor's loop is driven by requestAnimationFrame, which fires at the
 * DISPLAY's refresh rate — 60Hz on most screens, 120Hz on a recent laptop or
 * phone. The canvas it draws into is captured as a track at this rate. So the
 * loop was running a MediaPipe inference, a mask upscale, a putImageData and two
 * blurs somewhere between two and five times for every frame anybody would ever
 * see, and throwing the rest away.
 *
 * That is also why FRAME_BUDGET_MS below reads oddly at first: 45ms is longer
 * than one animation frame at any refresh rate in use, because it was always a
 * budget against the OUTPUT rate. Pacing the loop here is what makes the three
 * numbers — the loop, the capture and the budget — describe the same thing.
 */
export const OUTPUT_FPS = 24;

/** Above this per-frame cost the effect is not keeping up with the camera. */
export const FRAME_BUDGET_MS = 45;

/**
 * How early a frame may be drawn and still count as on time.
 *
 * Pacing has to be forgiving in one direction. A strict `elapsed >= interval`
 * against a 60Hz animation frame can only ever land on multiples of 16.7ms, so
 * a 41.7ms target would wait for 50ms and settle at 20fps — BELOW the capture
 * rate, which makes the track repeat frames and look worse than the waste it
 * replaced. Allowing a frame that is due within a quarter of an interval lets
 * 33.3ms count, so a 60Hz display composites at 30fps and a 120Hz one at 24.
 *
 * Never slower than the capture rate; as close to it as the display allows.
 */
const EARLY_TOLERANCE = 0.25;

/** Milliseconds between output frames at a given rate. */
export function frameIntervalMs(fps: number = OUTPUT_FPS): number {
  if (!Number.isFinite(fps) || fps <= 0) return 1000 / OUTPUT_FPS;
  return 1000 / fps;
}

/**
 * Whether this animation frame is the one to do the work on.
 *
 * `lastDrawnAt` is null before the first frame, which always draws: the canvas
 * is captured the instant an effect is chosen, and waiting even one interval
 * would put a black frame on the wire.
 */
export function shouldDrawFrame(
  lastDrawnAt: number | null,
  now: number,
  fps: number = OUTPUT_FPS,
): boolean {
  if (lastDrawnAt === null) return true;
  const interval = frameIntervalMs(fps);
  // A clock that has gone backwards — or a first frame stamped later than now —
  // draws rather than stalls. Skipping work is only ever an optimisation, and it
  // must not be able to freeze the picture.
  if (now <= lastDrawnAt) return true;
  return now - lastDrawnAt >= interval * (1 - EARLY_TOLERANCE);
}

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
