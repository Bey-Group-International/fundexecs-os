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
  const rates = blendRates(hi, lo, cap);

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

    previous[i] = previous[i] + (t - previous[i]) * rates[count];
  }
  return previous;
}

/**
 * The blend rate for each reversal count, computed once per configuration.
 *
 * The expression is the one that used to run per pixel:
 * `hi - (hi - lo) * min(1, count / cap)`. It depends on nothing but the three
 * parameters, and `count` is bounded by `cap`, so there are `cap + 1` possible
 * answers and the loop was computing a division, a `Math.min`, a multiply and a
 * subtract 130,000 times a frame to keep rediscovering two of them.
 *
 * Measured at 1280x720, with the coverage and the packed state byte-identical:
 *
 *   per-pixel arithmetic      1.40 ms per frame
 *   this table                0.78 ms per frame
 *
 * Kept as the SAME expression rather than the algebraically equivalent
 * `hi - step * count`. That form is one operation shorter and can differ in the
 * last bit of the mantissa, and the result is written into a Uint8ClampedArray
 * — which rounds — so a 1-ulp difference is a coverage value that flips at a
 * .5 boundary. A faster edge is not worth an edge in a different place.
 *
 * Cached rather than allocated per frame: `blendCoverage*` promises to allocate
 * nothing, because it runs 24 times a second for the length of every call, and
 * the parameters are compile-time constants in every real caller.
 */
let rateCache: { hi: number; lo: number; cap: number; rates: Float64Array } | null = null;

function blendRates(hi: number, lo: number, cap: number): Float64Array {
  const held = rateCache;
  if (held && held.hi === hi && held.lo === lo && held.cap === cap) return held.rates;

  const rates = new Float64Array(cap + 1);
  for (let count = 0; count <= cap; count++) {
    rates[count] = hi - (hi - lo) * Math.min(1, count / cap);
  }
  rateCache = { hi, lo, cap, rates };
  return rates;
}


/**
 * Feather radius as a fraction of frame width.
 *
 * Was 0.004, 5px at 1280. A CSS blur's radius is its sigma, so the alpha ramp
 * it leaves spans about three times that either side of the edge: fifteen
 * pixels over which the room shows through the person at partial strength, on
 * top of the two to three pixels of softness the grid upscale already adds.
 * With the halo itself removed (see STRUCTURE_THICKNESS_FRACTION) that ramp
 * was the widest soft thing left on the edge. 0.0025 is 3px at 1280, a ramp
 * of about nine; the upscale keeps hair from going to a staircase.
 */
const FEATHER_FRACTION = 0.0025;

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
 *
 * Three rather than two, measured alongside the ramp floor above: with the floor
 * at 0.10 it takes room visibility within 11px of the edge from 3.1% to 2.9%,
 * costs no headwear and no body, and leaves the undecided middle -- coverage
 * 85 to 170 -- still crossing gradually. Four bought 0.2% more and was not
 * worth the staircase it starts to make of hair.
 */
export const EDGE_CONTRAST = 3;

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
 * THIS WAS 0.04, AND IT WAS THE LAST OF THE HALO. The model's boundary is soft
 * on the room side too: the wall a few pixels from a shoulder scores 0.05 to
 * 0.15, not zero, and a ramp that starts at 0.04 paints every one of those
 * pixels as a faint person. Each pass downstream then treats them as somebody
 * -- growth may raise them, the blend carries them, the sharpen pushes the
 * upper half of them toward solid -- and what reaches the screen is a ring of
 * the real room, a few pixels wide, all the way round the silhouette.
 *
 * Measured through the whole chain, forty frames of a person on a 1280x720
 * frame with that soft boundary modelled on the room side, after the structure
 * pass and the growth ceiling had already been taken out of the ring:
 *
 *   floor     room visible within 11px of edge   hard ring above / beside   headwear kept
 *   0.04 (was)            10.4%                      1.6px / 1.5px             92%
 *   0.08                   4.4%                      0.7px / 1.1px             92%
 *   0.10 (now)             3.1%                      0.7px / 1.0px             91%
 *   0.12                   2.4%                      0.6px / 0.8px             91%
 *   0.15                   2.1%                      0.6px / 0.7px             91%
 *
 *   with headwear measuring at the bottom of its range (0.15 to 0.34):
 *   0.04                   --                            --                    91%
 *   0.10                   --                            --                    89%
 *   0.12                   --                            --                    84% (with other tightening)
 *
 * 0.10. Below it the ring keeps shrinking by less and less; above it the
 * fainter headwear starts to go, and the headwear tests below say where that
 * line is. Headwear at 0.20 to 0.34 -- the range backgrounds.ts measured for a
 * cap, a headwrap, a helmet -- is at or above half coverage from the ramp
 * alone, and growth and the sharpen take it to solid as before. The person's
 * own edge is bitten by under a cell. The gain over the whole chain is what
 * the old comment here promised and did not deliver: nothing becomes visible
 * that was not -- the room beside the person is no longer a faint person.
 */
export const CONFIDENCE_BACKGROUND = 0.10;

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
// On the grid it is ~1.4ms, which is where the growth now runs. A widened mask
// that made modest laptops drop frames would have traded one visible fault for
// another.
//
// "A fraction of a millisecond" is what this comment and `maskGrid` below used
// to say, and it was wrong by an order of magnitude. Timed as one block, the
// whole pure per-frame chain -- sample, ceiling, grow, blend, sharpen, write the
// alpha plane -- cost ~5.4ms per frame, which at OUTPUT_FPS is ~130ms of main
// thread per second of video, in a tab that is also decoding everyone else's
// camera. It is now ~2.9ms, ~70ms per second; see `sampleCoverageFromConfidence`
// and `blendRates` for where the rest went. The remaining largest item is the
// growth itself, and a row-major rewrite of its vertical passes was tried and
// measured at 2.04 -> 1.88ms -- 8%, for a scratch buffer and a less obvious
// loop. Not taken.

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
 * measured at ~2.9ms for the whole pure chain against a 45ms budget — and
 * reachable now because pacing the loop to the rate the canvas is captured at
 * freed two to five times the budget it used to waste.
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
 * Fill a grid-sized coverage buffer from the segmenter's confidence mask.
 *
 * Each grid cell averages the four source pixels nearest its centre rather than
 * taking one. A single sample is cheaper, but it makes the edge land on
 * whichever pixel it happened to hit, and that choice changes frame to frame —
 * which is the crawling edge the temporal blend exists to suppress. Averaging
 * keeps the boundary where it actually is.
 *
 * THE FOUR TAPS COLLAPSE TO ONE IN PRODUCTION, and that is worth a fast path
 * rather than four reads of the same byte. The processor segments a canvas it
 * drew at grid size, so the mask comes back at grid size, so the source and the
 * grid are the same shape: with sx = sy = 1 the two x taps are floor(gx + 0.25)
 * and floor(gx + 0.75), which are both gx, and likewise for y. Measured at
 * 1280x720 (481x270 grid), byte-identical output:
 *
 *   four taps through a callback      4.04 ms per frame
 *   one tap, ramp inlined             1.50 ms per frame
 *
 * Two things each cost about as much as the extra reads. The ramp was reached
 * through a `coverageAt` function reference, which cannot be inlined into the
 * loop — calling the exported `coverageFromConfidence` once per cell measured
 * SLOWER than the whole four-tap version does now (4.74 ms). And the x taps
 * were recomputed on every row although they depend only on the column, which
 * is `grid.height` times more arithmetic than the answer needs.
 *
 * So both paths inline the ramp, and the general path hoists the x taps. The
 * general path stays because the mask's own dimensions are the ones to trust —
 * a model or a MediaPipe version that hands back a different size must still
 * work, just not at this speed.
 */
export function sampleCoverageFromConfidence(
  out: Uint8ClampedArray,
  confidences: Float32Array,
  srcWidth: number,
  srcHeight: number,
  grid: MaskGrid,
): Uint8ClampedArray {
  if (!(srcWidth > 0) || !(srcHeight > 0)) return out;

  // The ramp, inlined. Identical to `coverageFromConfidence`, which stays
  // exported and is what the tests pin — there is a test asserting these two
  // agree on every representable input, because a divergence here would be a
  // silent change to where every edge in the picture falls.
  const span = CONFIDENCE_PERSON - CONFIDENCE_BACKGROUND;

  if (srcWidth === grid.width && srcHeight === grid.height) {
    const n = Math.min(out.length, confidences.length);
    for (let i = 0; i < n; i++) {
      const c = confidences[i];
      out[i] = ramp(c, span);
    }
    return out;
  }

  const sy = srcHeight / grid.height;
  const lastY = srcHeight - 1;
  const [tapA, tapB] = columnTaps(grid, srcWidth);

  for (let gy = 0; gy < grid.height; gy++) {
    const cy = (gy + 0.5) * sy;
    const y0 = Math.min(lastY, Math.max(0, Math.floor(cy - sy / 4)));
    const y1 = Math.min(lastY, Math.max(0, Math.floor(cy + sy / 4)));
    const row0 = y0 * srcWidth;
    const row1 = y1 * srcWidth;
    const outRow = gy * grid.width;

    for (let gx = 0; gx < grid.width; gx++) {
      const xa = tapA[gx];
      const xb = tapB[gx];
      const sum =
        ramp(confidences[row0 + xa], span) +
        ramp(confidences[row0 + xb], span) +
        ramp(confidences[row1 + xa], span) +
        ramp(confidences[row1 + xb], span);
      out[outRow + gx] = sum / 4;
    }
  }
  return out;
}

/**
 * The ramp, as a function small enough for the engine to inline.
 *
 * `!(c > lo && c < Infinity)` rather than `c <= lo`, and that detail is not
 * decoration. The exported `coverageFromConfidence` opens with
 * `Number.isFinite`, so it answers 0 for NaN and for BOTH infinities. A first
 * draft of this inlining dropped that guard, and `+Infinity` then fell through
 * to `c >= CONFIDENCE_PERSON` and came back 255 — the opposite answer, on a
 * value that would have painted a pixel as fully a person. The equivalence test
 * over the whole float range caught it; nothing in a camera would have.
 */
function ramp(c: number, span: number): number {
  if (!(c > CONFIDENCE_BACKGROUND && c < Number.POSITIVE_INFINITY)) return 0;
  if (c >= CONFIDENCE_PERSON) return 255;
  return Math.round(((c - CONFIDENCE_BACKGROUND) / span) * 255);
}

/** The same, from the hard category mask — the fallback when no confidence mask arrives. */
export function sampleCoverageFromCategory(
  out: Uint8ClampedArray,
  labels: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  grid: MaskGrid,
): Uint8ClampedArray {
  if (!(srcWidth > 0) || !(srcHeight > 0)) return out;

  if (srcWidth === grid.width && srcHeight === grid.height) {
    const n = Math.min(out.length, labels.length);
    for (let i = 0; i < n; i++) out[i] = labels[i] === PERSON_LABEL ? 255 : 0;
    return out;
  }

  const sy = srcHeight / grid.height;
  const lastY = srcHeight - 1;
  const [tapA, tapB] = columnTaps(grid, srcWidth);

  for (let gy = 0; gy < grid.height; gy++) {
    const cy = (gy + 0.5) * sy;
    const y0 = Math.min(lastY, Math.max(0, Math.floor(cy - sy / 4)));
    const y1 = Math.min(lastY, Math.max(0, Math.floor(cy + sy / 4)));
    const row0 = y0 * srcWidth;
    const row1 = y1 * srcWidth;
    const outRow = gy * grid.width;

    for (let gx = 0; gx < grid.width; gx++) {
      const xa = tapA[gx];
      const xb = tapB[gx];
      const sum =
        (labels[row0 + xa] === PERSON_LABEL ? 255 : 0) +
        (labels[row0 + xb] === PERSON_LABEL ? 255 : 0) +
        (labels[row1 + xa] === PERSON_LABEL ? 255 : 0) +
        (labels[row1 + xb] === PERSON_LABEL ? 255 : 0);
      out[outRow + gx] = sum / 4;
    }
  }
  return out;
}

/**
 * The two source columns each grid column samples, computed once.
 *
 * They depend only on the column, so recomputing them per row was
 * `grid.height` times more `floor`, `min` and `max` than the answer needs.
 * Cached across frames as well, because the grid and the mask size do not
 * change from one frame to the next — only when the camera does, which
 * `resizeMask` already treats as a reconfiguration.
 */
let tapCache: { width: number; srcWidth: number; a: Int32Array; b: Int32Array } | null = null;

function columnTaps(grid: MaskGrid, srcWidth: number): [Int32Array, Int32Array] {
  const held = tapCache;
  if (held && held.width === grid.width && held.srcWidth === srcWidth) return [held.a, held.b];

  const sx = srcWidth / grid.width;
  const lastX = srcWidth - 1;
  const a = new Int32Array(grid.width);
  const b = new Int32Array(grid.width);
  for (let gx = 0; gx < grid.width; gx++) {
    const cx = (gx + 0.5) * sx;
    a[gx] = Math.min(lastX, Math.max(0, Math.floor(cx - sx / 4)));
    b[gx] = Math.min(lastX, Math.max(0, Math.floor(cx + sx / 4)));
  }
  tapCache = { width: grid.width, srcWidth, a, b };
  return [a, b];
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

// ── Two people, sitting close ────────────────────────────────────────────────

// Everything above was written for one person in front of one camera, which is
// what selfie_segmenter was trained on. Two people sharing a laptop do not break
// it the way it looks like they do.
//
// The model finds both of them. What it will not give up is the sliver of room
// between them -- a shoulder-to-shoulder gap is confident background, and it is
// right that it is. The fault is not that the second person is missing. It is
// that a gap a few cells wide is the worst possible width: narrow enough that
// sampling lands differently frame to frame, wide enough to see. Its coverage
// does not sit still, it wanders in the low tens, and because the mask is an
// alpha channel over the camera frame, wandering coverage there is a faint,
// shimmering, SHARP image of the room showing through between two people who
// have a background effect switched on.
//
// The first attempt at this closed the gap by raising it to the coverage of its
// flanks, which made the pair one silhouette. That is worse, not better, and the
// reason is the compositing direction: `destination-in` keeps the camera frame
// WHERE THE MASK COVERS, so raising coverage in the gap does not cover the room
// there, it reveals it -- sharply, and across the full height of the gap. For a
// member who turned a background on so that their room would not be in the call,
// that is the opposite of the feature.
//
// So the gap is quieted rather than closed. Inside an enclosed gap, coverage
// below `GAP_QUIET_CEILING` is held at zero: the wander stops, because the value
// is no longer a function of per-frame sampling noise, and what the gap shows is
// the background effect rather than a faint sharp strip of the real room.
//
// What this does NOT do, stated plainly because the temptation is to claim it:
// it does not improve how well two people are segmented. The model was never
// failing to find the second person, so there is nothing here that finds them
// better. It removes a leak and a shimmer between them. The pair still composites
// as two silhouettes with the background effect between them, which is what a
// background effect is supposed to look like.

/**
 * The widest enclosed gap to quiet, as a fraction of frame width.
 *
 * A budget for how far apart two people can be and still have the room between
 * them treated as a gap rather than as open background. Only cells the model
 * gave nothing at all are charged against it -- see `quietCoverageGaps`.
 *
 * Two people sitting close enough to share a camera leave something like an inch
 * or two between their shoulders, which at a 1280-wide frame is tens of pixels.
 * 0.025 is 32 of them.
 *
 * Being wrong in either direction is mild now, which it was not when this budget
 * controlled a reveal. Too small and a wider gap keeps its shimmer. Too large and
 * more of a genuinely open background gets held at zero, which is where it
 * already sits.
 */
const GAP_SPAN_FRACTION = 0.025;

/**
 * How covered a cell must be to anchor one side of a gap.
 *
 * High deliberately. The flanks are the evidence that there is a person on each
 * side of this gap rather than noise on each side of a wall. A pixel in the
 * uncertainty band -- hair, a headwrap, the edge of a face -- is not evidence of
 * a torso, so it cannot authorise anything.
 */
const GAP_ANCHOR_SOLID = 200;

/**
 * How much wider than its empty core a whole run may be, as a multiple.
 *
 * A backstop. Because partial coverage is not charged against the reach, a run
 * made entirely of faint cells would otherwise qualify however long it ran.
 * Three, because the runs this has to clear are about twice their own core: with
 * a soft edge from each body, measured below-anchor runs between two seated
 * people were 14-30 grid cells around all-zero cores of 6-22.
 */
const GAP_SPAN_MULTIPLE = 3;

/**
 * The most coverage a cell inside a gap may have and still be held at zero.
 *
 * This is the whole safety of the rule, because quieting LOWERS coverage and
 * lowering coverage is how you take a bite out of somebody. Two things must both
 * be true of a cell before it is zeroed: it is inside a gap enclosed by a person
 * on each side, and the model gave it less than this.
 *
 * 96 of 255 is under two fifths. The shimmer being removed wanders in the low
 * tens; a person's feathered edge ramps from 255 down across several cells and is
 * well above this for the part of it that is visible; a thin real feature between
 * two people -- a strand of hair, the edge of a hand -- reads far higher than a
 * confident-background cell does. So the band being zeroed is the faint tail, and
 * a cell with any real claim to being a person keeps every bit of its coverage.
 *
 * It is a judgement, and the one number here that wants a real two-person frame
 * rather than a synthetic one. Raising it quiets more and risks the inner edge of
 * a shoulder; lowering it leaves more shimmer and reveals nothing.
 */
const GAP_QUIET_CEILING = 96;

/**
 * The widest gap to quiet, in GRID pixels, for a given frame.
 *
 * Expressed against the frame and converted like `maskDilatePx`, so the reach is
 * the same share of a person whatever the camera resolution and whatever grid
 * the mask is carried on.
 */
export function maskGapSpanPx(frameWidth: number, grid: MaskGrid): number {
  const width = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth : 640;
  const scale = Number.isFinite(grid.scale) && grid.scale > 0 ? grid.scale : 1;
  return Math.max(1, Math.round((width * GAP_SPAN_FRACTION) / scale));
}

/**
 * Hold the faint tail inside enclosed gaps at zero, in place, row by row.
 *
 * Horizontal only. Two people sitting side by side are separated horizontally and
 * every row of that gap is a horizontal run, so one axis answers the case --
 * including when they sit at different heights, because each row is handled on
 * its own. Running it vertically as well would catch the space between a chin and
 * a shoulder, which belongs to neither.
 *
 * ANTI-MONOTONE, AND THAT IS THE DANGEROUS DIRECTION. Every other rule in this
 * file only ever adds coverage, because the cost of over-including is a faint
 * halo and the cost of under-including is erasing part of someone. This one
 * subtracts, so it is fenced twice: a cell is only touched if it sits inside a
 * run enclosed by a solid person on BOTH sides, and only if its own coverage is
 * below `GAP_QUIET_CEILING`. A cell with any real claim to being a person is left
 * exactly as the model left it.
 *
 * Only cells with no coverage at all are charged against `maxGap`, which is what
 * lets a realistic gap qualify: both bodies arrive with a feathered edge, so an
 * 8-cell core of true room sits inside a 14-cell run of sub-anchor cells, and
 * charging the whole run would spend half the budget on pixels already part of a
 * person. `GAP_SPAN_MULTIPLE` is the backstop on the rest.
 *
 * One pass, left to right, carrying the last solid column and the empty cells
 * seen since it. Linear in the number of cells and independent of the gap width,
 * for the same reason `dilateCoverage` is. Allocates nothing.
 */
export function quietCoverageGaps(
  coverage: Uint8ClampedArray,
  gridWidth: number,
  gridHeight: number,
  maxGap: number,
  solid: number = GAP_ANCHOR_SOLID,
  ceiling: number = GAP_QUIET_CEILING,
): Uint8ClampedArray {
  const width = Math.max(0, Math.floor(gridWidth));
  const height = Math.max(0, Math.floor(gridHeight));
  const reach = Math.floor(maxGap);
  if (width <= 2 || height <= 0 || reach <= 0) return coverage;
  const widest = reach * GAP_SPAN_MULTIPLE;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    // The last column in this row solid enough to anchor a gap, or -1 before the
    // first one. Reset per row: a run only ever sees its own row's anchors, so a
    // person in the row above cannot authorise anything in this one.
    let anchor = -1;
    // Cells with NO coverage since that anchor -- the true room in the gap.
    let empty = 0;

    for (let x = 0; x < width; x++) {
      const i = row + x;
      const v = coverage[i];

      if (v < solid) {
        if (v === 0) empty++;
        continue;
      }

      const span = x - anchor - 1;
      // `anchor >= 0` is what refuses a run with only one flank -- the open room
      // to the left of the left-hand person is not a gap between two of them,
      // and nothing out there is enclosed by anybody.
      if (anchor >= 0 && span > 0 && empty <= reach && span <= widest) {
        for (let j = anchor + 1; j < x; j++) {
          const k = row + j;
          if (coverage[k] < ceiling) coverage[k] = 0;
        }
      }
      anchor = x;
      empty = 0;
    }
  }
  return coverage;
}

/**
 * How far above what the model gave a cell growth may raise it, as a multiple.
 *
 * The ceiling used to be a yes or no: any cell the model gave anything at all
 * was open to full coverage, and only a cell at exactly zero was closed. That
 * is what the halo was made of. The room right beside a person is not scored at
 * zero -- the model's boundary is soft, and the wall a few pixels from a
 * shoulder lands at 0.05 to 0.15 -- so growth claimed all of it, to full, and
 * the sharpen after the blend made it a hard band of sharp room a finger's
 * width wide. Measured through the whole chain on a 1280x720 frame, with that
 * soft boundary modelled on the room side: 11.1px of room kept above the head,
 * 6.8px beside the torso.
 *
 * A ceiling PROPORTIONAL to the model's own score keeps the distinction the
 * yes/no threw away: a cell it barely saw may be nudged, a cell it half saw may
 * be filled. At twice:
 *
 *                            halo above   halo beside   headwear kept   room kept
 *   yes/no ceiling              11.1px        6.8px          92%          564
 *   twice the model's score      6.0px        5.6px          92%          259
 *   three times                  6.2px        6.3px          92%          326
 *   hard floor at 0.12 conf      5.9px        5.2px          92%          179
 *
 *   room kept   total coverage, of 255, over cells more than one cell outside
 *               the person, per frame -- the material the halo is made of
 *
 * The hard floor measured a shade better and was not taken here: a threshold
 * on the ceiling is the wrong place for it, because it would close cells the
 * ramp had already let in. The floor that was needed turned out to belong on
 * the ramp itself -- see CONFIDENCE_BACKGROUND, now 0.10 -- and with it there,
 * this stays proportional for what is inside the band: a cell at the bottom of
 * it may be nudged, a cell halfway up may be filled, and the headwear the growth
 * exists for -- 0.20 to 0.34 confidence, half coverage and up -- reaches the
 * cap, so nothing it keeps is lost.
 */
export const GROWTH_HEADROOM = 2;

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
 * exactly 0. So growth is allowed to fill uncertainty IN PROPORTION TO IT --
 * up to `headroom` times what the model gave -- and forbidden to invent
 * coverage where there is none. Headwear is uncertain; the wall is barely so;
 * confident room is not at all.
 *
 * Built before the grow, from the sampled coverage, because the grow overwrites
 * it in place. The buffer clamps, so the multiple never leaves the byte.
 */
export function dilateCeiling(
  out: Uint8ClampedArray,
  coverage: Uint8ClampedArray,
  headroom: number = GROWTH_HEADROOM,
): Uint8ClampedArray {
  const k = Number.isFinite(headroom) && headroom > 0 ? headroom : 1;
  const n = Math.min(out.length, coverage.length);
  for (let i = 0; i < n; i++) out[i] = coverage[i] * k;
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
