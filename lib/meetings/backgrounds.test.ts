import { readFileSync } from "fs";
import { join } from "path";

import {
  BACKGROUND_PREF_KEY,
  FRAME_BUDGET_MS,
  NATIVE_TEMPLATES,
  NO_BACKGROUND,
  SLOW_FRAME_RUN,
  UPLOAD_MAX_BYTES,
  MASK_SMOOTHING,
  MASK_REVERSAL_CONFIRM,
  MASK_REVERSAL_DEADBAND,
  MASK_SMOOTHING_UNCERTAIN,
  blendCoverageByAgreement,
  createMaskAgreement,
  CONFIDENCE_BACKGROUND,
  CONFIDENCE_PERSON,
  blendCoverage,
  coverageFromConfidence,
  dilateCoverage,
  maskDilatePx,
  maskGrid,
  personCoverage,
  sampleCoverageFromCategory,
  sampleCoverageFromConfidence,
  blurRadiusPx,
  maskFeatherPx,
  decodeEffect,
  effectLabel,
  encodeEffect,
  needsSegmentation,
  sameEffect,
  shouldSuspendEffect,
  suspensionMessage,
  templateById,
  validateBackgroundUpload,
  dilateCeiling,
  quietCoverageGaps,
  maskGapSpanPx,
  sharpenEdge,
  OUTPUT_FPS,
  frameIntervalMs,
  shouldDrawFrame,
  type BackgroundEffect,
  type DilateRadii,
  type MaskGrid,
} from "@/lib/meetings/backgrounds";

describe("blurRadiusPx", () => {
  it("scales with the frame, so one setting looks the same on any camera", () => {
    expect(blurRadiusPx("light", 1280)).toBeGreaterThan(blurRadiusPx("light", 640));
  });

  it("separates slight from extra at the same frame size", () => {
    expect(blurRadiusPx("heavy", 1280)).toBeGreaterThan(blurRadiusPx("light", 1280));
  });

  it("stays visible at small frame sizes rather than rounding to nothing", () => {
    expect(blurRadiusPx("light", 120)).toBeGreaterThanOrEqual(2);
  });

  it("falls back to a sane width for a garbage one", () => {
    expect(blurRadiusPx("light", Number.NaN)).toBe(blurRadiusPx("light", 640));
    expect(blurRadiusPx("light", 0)).toBe(blurRadiusPx("light", 640));
    expect(blurRadiusPx("light", -100)).toBe(blurRadiusPx("light", 640));
  });
});

describe("maskFeatherPx", () => {
  it("softens more on a bigger frame, so the edge looks the same on any camera", () => {
    expect(maskFeatherPx(1280)).toBeGreaterThan(maskFeatherPx(640));
  });

  it("never rounds away to a hard edge on a small frame", () => {
    expect(maskFeatherPx(100)).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a sane width for a garbage one", () => {
    expect(maskFeatherPx(Number.NaN)).toBe(maskFeatherPx(640));
    expect(maskFeatherPx(0)).toBe(maskFeatherPx(640));
  });
});

describe("personCoverage", () => {
  // The selfie segmenter labels only the person, so 0 is the person and 255 is
  // MediaPipe's "no category" filler. Getting this backwards blurs the face and
  // leaves the room sharp, so it is pinned here rather than left to a comment.
  it("covers the person, who is category 0", () => {
    expect(personCoverage(0)).toBe(255);
  });

  it("leaves the background clear, whatever value it arrives as", () => {
    expect(personCoverage(255)).toBe(0);
    expect(personCoverage(1)).toBe(0);
    expect(personCoverage(7)).toBe(0);
  });
});

/**
 * The blend that stopped the chair strobing.
 *
 * Asserted as the OUTCOME a person sees — the settled peak-to-peak swing of a
 * pixel the model keeps changing its mind about — and not as "the alpha varies".
 * A test that the mechanism fired is the mistake this session has already made
 * twice: it agrees with the author's assumption instead of constraining what
 * ends up on screen.
 */
describe("blendCoverageByAgreement", () => {
  /** Blend `frames` frames and return the settled peak-to-peak swing. */
  function settledSwing(
    lo: number,
    hi: number,
    blend: (p: Uint8ClampedArray, t: Uint8ClampedArray) => void,
    frames = 60,
  ): number {
    const previous = new Uint8ClampedArray(1);
    const seen: number[] = [];
    for (let i = 0; i < frames; i++) {
      blend(previous, new Uint8ClampedArray([coverageFromConfidence(i % 2 === 0 ? lo : hi)]));
      seen.push(previous[0]);
    }
    const tail = seen.slice(frames / 2);
    return Math.max(...tail) - Math.min(...tail);
  }

  /** Frames for one pixel to fall under `threshold` once the model says background. */
  function framesToHide(from: number, threshold = 8): number {
    const previous = new Uint8ClampedArray([from]);
    const agreement = createMaskAgreement(1);
    const person = new Uint8ClampedArray([from]);
    // Settle at `from` first. Note this leaves NO direction on record: the target
    // never changes, so every one of these frames is a quiet one. The flip below
    // is therefore a pixel's first significant change. The case where a direction
    // IS on record and then goes stale is covered separately, below.
    for (let i = 0; i < 8; i++) blendCoverageByAgreement(previous, person, agreement);
    const background = new Uint8ClampedArray([0]);
    let n = 0;
    while (previous[0] > threshold && n < 300) {
      blendCoverageByAgreement(previous, background, agreement);
      n += 1;
    }
    return n;
  }

  const byAgreement = () => {
    const agreement = createMaskAgreement(1);
    return (p: Uint8ClampedArray, t: Uint8ClampedArray) =>
      blendCoverageByAgreement(p, t, agreement);
  };

  // The measured case: a chair's edge drifting across the uncertainty band. Under
  // the uniform blend it settles at 65/255 — a quarter of full opacity, flipping
  // every other frame, which is the strobe.
  it("cuts the strobe on a pixel the model keeps changing its mind about", () => {
    const uniform = settledSwing(0.05, 0.25, (p, t) => blendCoverage(p, t, MASK_SMOOTHING));
    const agreed = settledSwing(0.05, 0.25, byAgreement());

    expect(uniform).toBeGreaterThan(50);
    expect(agreed).toBeLessThan(12);
    expect(agreed).toBeLessThan(uniform / 4);
  });

  /**
   * The case that killed the obvious design, and the reason this rule asks about
   * reversals rather than about which side of the midpoint the model chose.
   *
   * Headwear oscillates 98<->0 — both values on the BACKGROUND side of 127.5. A
   * side-agreement rule sees perfect agreement here and smooths it not at all,
   * leaving the swing exactly where the uniform blend left it (measured: 32.7).
   */
  it("catches a flicker that never crosses the midpoint", () => {
    const uniform = settledSwing(0.20, 0.34, (p, t) => blendCoverage(p, t, MASK_SMOOTHING));
    const agreed = settledSwing(0.20, 0.34, byAgreement());

    expect(uniform).toBeGreaterThan(25);
    expect(agreed).toBeLessThan(8);
  });

  /**
   * The privacy property, and the whole reason this rule replaced the previous
   * one. A pixel the model has decided is background must be hidden as fast as
   * the uniform blend hid it — the history-keyed rule took 10 frames rather than
   * 5, which is ~208ms longer that newly exposed room stays on screen.
   */
  it("hides a newly exposed background pixel as fast as the uniform blend", () => {
    // Uniform at 0.5 from 255 reaches <8 in 5 frames: 127.5, 63.8, 31.9, 15.9, 8.0.
    expect(framesToHide(255)).toBeLessThanOrEqual(5);
    expect(framesToHide(128)).toBeLessThanOrEqual(4);
  });

  /**
   * The same privacy property, but reached the way a real meeting reaches it:
   * somebody walks in, sits still for a while, then leaves.
   *
   * framesToHide above does NOT cover this, and its comment claimed otherwise.
   * It primes by blending a pixel towards the value it already holds, so every
   * priming delta is zero, every priming frame is a quiet one, and the direction
   * never gets on record at all. The flip that follows is therefore a pixel's
   * FIRST significant change, which is the one case the rule deliberately treats
   * as movement. The interesting case is the one where a direction IS on record
   * and then goes stale across a settled stretch.
   */
  it("hides a pixel that arrived, settled, and then left", () => {
    const previous = new Uint8ClampedArray([0]);
    const agreement = createMaskAgreement(1);
    const background = new Uint8ClampedArray([0]);
    const person = new Uint8ClampedArray([255]);

    // An empty chair, which also primes the previous-target record at 0.
    for (let i = 0; i < 3; i++) blendCoverageByAgreement(previous, background, agreement);
    // Somebody arrives -- a rising delta, so RISING goes on record -- and then
    // sits still long enough for the reversal count to unwind to nothing.
    for (let i = 0; i < 9; i++) blendCoverageByAgreement(previous, person, agreement);
    expect(previous[0]).toBeGreaterThan(250);

    // They leave. This is one movement, not a contradiction of the arrival.
    let n = 0;
    while (previous[0] > 8 && n < 300) {
      blendCoverageByAgreement(previous, background, agreement);
      n += 1;
    }
    expect(n).toBeLessThanOrEqual(5);
  });

  /**
   * And it must come BACK to that speed once the flicker stops. A draft that
   * capped the reversal count at the byte rather than at the confirm threshold
   * took 18 frames to recover — the same latency defect in a new hat, because a
   * count the ramp can never read still takes that many quiet frames to unwind.
   */
  it("returns to full speed once the model stops contradicting itself", () => {
    const previous = new Uint8ClampedArray([98]);
    const agreement = createMaskAgreement(1);
    const hi = new Uint8ClampedArray([196]);
    const lo = new Uint8ClampedArray([0]);
    for (let i = 0; i < 20; i++) {
      blendCoverageByAgreement(previous, i % 2 ? lo : hi, agreement);
    }
    let n = 0;
    while (previous[0] > 8 && n < 300) {
      blendCoverageByAgreement(previous, lo, agreement);
      n += 1;
    }
    expect(n).toBeLessThanOrEqual(6);
  });

  // Steady motion in one direction is not a contradiction, so it must not be
  // damped: this is what stops the mask dragging behind a turning head.
  it("leaves motion that keeps going the same way at the responsive rate", () => {
    const previous = new Uint8ClampedArray([0]);
    const agreement = createMaskAgreement(1);
    const seen: number[] = [];
    for (let i = 1; i <= 5; i++) {
      blendCoverageByAgreement(previous, new Uint8ClampedArray([255]), agreement);
      seen.push(previous[0]);
    }
    // Uniform 0.5 from 0 toward 255: 128, 191, 223, 239, 247.
    expect(seen[0]).toBeGreaterThanOrEqual(127);
    expect(previous[0]).toBeGreaterThan(245);
  });

  // Dither below the deadband is quantisation, not an opinion. Reading it as a
  // reversal would carry one slow frame into every real transition that follows.
  it("ignores a change smaller than the deadband", () => {
    const previous = new Uint8ClampedArray([200]);
    const agreement = createMaskAgreement(1);
    const a = new Uint8ClampedArray([200]);
    const b = new Uint8ClampedArray([200 + MASK_REVERSAL_DEADBAND]);
    for (let i = 0; i < 20; i++) blendCoverageByAgreement(previous, i % 2 ? b : a, agreement);
    // Still at full speed, so the transition that follows is not slowed.
    const background = new Uint8ClampedArray([0]);
    let n = 0;
    while (previous[0] > 8 && n < 300) {
      blendCoverageByAgreement(previous, background, agreement);
      n += 1;
    }
    expect(n).toBeLessThanOrEqual(5);
  });

  it("converges rather than stalling on a pixel it has been damping", () => {
    const previous = new Uint8ClampedArray([127]);
    const agreement = createMaskAgreement(1);
    const person = new Uint8ClampedArray([255]);
    for (let i = 0; i < 80; i++) blendCoverageByAgreement(previous, person, agreement);
    expect(previous[0]).toBeGreaterThan(250);
  });

  it("writes in place and allocates nothing", () => {
    const previous = new Uint8ClampedArray([0, 255]);
    const agreement = createMaskAgreement(2);
    expect(blendCoverageByAgreement(previous, new Uint8ClampedArray([255, 0]), agreement)).toBe(
      previous,
    );
  });

  it("survives a shorter target without throwing", () => {
    const previous = new Uint8ClampedArray(8);
    const agreement = createMaskAgreement(8);
    expect(() =>
      blendCoverageByAgreement(previous, new Uint8ClampedArray(2), agreement),
    ).not.toThrow();
  });

  // The first frame has no previous target, so it has no delta and cannot have a
  // reversal. Inventing one would damp the opening frames of every effect.
  it("treats its first frame as confident", () => {
    const previous = new Uint8ClampedArray([0]);
    const agreement = createMaskAgreement(1);
    expect(agreement.primed).toBe(false);
    blendCoverageByAgreement(previous, new Uint8ClampedArray([255]), agreement);
    expect(previous[0]).toBeGreaterThanOrEqual(127);
    expect(agreement.primed).toBe(true);
  });

  /**
   * Pins the four constants every measurement in this file was taken at, so
   * retuning one without re-measuring fails here rather than quietly changing what
   * the swing and latency assertions above are worth.
   *
   * Deliberately NOT asserting the analytic bound a <= 0.097 that a sub-10/255
   * residue needs: the shipped value is 0.1 and the measured chair residue is
   * 10.3, slightly over. The swing tests above assert the outcome; this asserts
   * the inputs it was measured with.
   */
  it("keeps the constants it was measured with", () => {
    expect(MASK_SMOOTHING).toBe(0.5);
    expect(MASK_SMOOTHING_UNCERTAIN).toBe(0.1);
    expect(MASK_REVERSAL_DEADBAND).toBe(8);
    expect(MASK_REVERSAL_CONFIRM).toBe(1);
  });
});

/**
 * That the processor actually routes its per-frame mask through the blend above.
 *
 * The tests above establish what the rule DOES. They say nothing about whether
 * anything calls it — reverting the processor to the uniform blend passed all of
 * them, which happened three times in this area before the habit stuck.
 *
 * Read from source, and weaker than the rest of this file because of it: the
 * processor reaches for MediaPipe through a dynamic import that jsdom cannot
 * resolve, so the segmenter path never executes here and there is no behaviour to
 * assert. A real check needs a segmenter fake, which is a larger piece of work
 * than the change it would guard. This catches the revert; it does not prove the
 * call runs.
 *
 * Matched with its arguments rather than by name, so a sentence mentioning the
 * function cannot satisfy it.
 */
describe("the processor uses the agreement blend", () => {
  const processorSource = readFileSync(join(__dirname, "background-processor.ts"), "utf8");

  it("blends its running mask history through it", () => {
    expect(processorSource).toMatch(
      /blendCoverageByAgreement\(\s*this\.maskHistory,\s*target,\s*this\.maskAgreement/,
    );
  });

  it("imports it rather than the uniform primitive", () => {
    expect(processorSource).toMatch(/^\s*blendCoverageByAgreement,\s*$/m);
    expect(processorSource).not.toMatch(/blendCoverage\(\s*this\.maskHistory/);
  });

  /**
   * The reversal memory must be dropped everywhere the history is. Kept across a
   * pause or a resize it would damp the first frames back on the strength of a
   * flicker from before — and a buffer of the wrong length would silently blend
   * only its first pixels.
   */
  it("drops the reversal memory wherever it drops the history", () => {
    const drops = processorSource.match(/this\.maskHistory = null;/g) ?? [];
    const agreementDrops = processorSource.match(/this\.maskAgreement = null;/g) ?? [];
    expect(drops.length).toBeGreaterThan(0);
    expect(agreementDrops.length).toBe(drops.length);
  });

  it("reallocates it when the mask size changes", () => {
    expect(processorSource).toMatch(/createMaskAgreement\(target\.length\)/);
  });
});

describe("the processor quiets gaps before it builds the growth ceiling", () => {
  const processorSource = readFileSync(join(__dirname, "background-processor.ts"), "utf8");

  /**
   * The ordering is pinned here rather than left to a comment. `dilateCeiling`
   * is built from the coverage buffer and records which cells growth may later
   * fill. Quieting first closes those cells to growth as well, so nothing puts
   * the strip of room back; quieting afterwards would let growth refill it.
   */
  it("calls quietCoverageGaps before dilateCeiling", () => {
    const quiet = processorSource.indexOf("quietCoverageGaps(target");
    const ceiling = processorSource.indexOf("dilateCeiling(this.dilateLimit");
    expect(quiet).toBeGreaterThan(-1);
    expect(ceiling).toBeGreaterThan(-1);
    expect(quiet).toBeLessThan(ceiling);
  });

  it("quiets on the category path too, so no build can start leaking", () => {
    const quiet = processorSource.indexOf("quietCoverageGaps(target");
    const gradedBranch = processorSource.indexOf("if (graded) {");
    expect(quiet).toBeLessThan(gradedBranch);
  });

  it("keeps the reach in step with the grid it is measured in", () => {
    expect(processorSource).toMatch(/this\.gapSpanReach = maskGapSpanPx\(frameWidth, this\.grid\)/);
    const radii = processorSource.match(/this\.dilateRadii = maskDilatePx\(/g) ?? [];
    const reach = processorSource.match(/this\.gapSpanReach = maskGapSpanPx\(/g) ?? [];
    expect(reach.length).toBe(radii.length);
  });

  /**
   * The property the whole change turns on: nothing in the processor may raise
   * coverage inside a gap, because `destination-in` keeps the camera frame where
   * the mask covers, so raising it there reveals the room rather than hiding it.
   */
  it("no longer contains the rule that raised coverage in a gap", () => {
    expect(processorSource).not.toMatch(/bridgeCoverageGaps/);
    expect(processorSource).not.toMatch(/maskBridgePx/);
  });
});

describe("blendCoverage", () => {
  const person = (n: number) => new Uint8ClampedArray(n).fill(255);
  const background = (n: number) => new Uint8ClampedArray(n).fill(0);

  it("moves toward the new coverage without jumping to it", () => {
    const previous = new Uint8ClampedArray([0, 0, 0]);
    blendCoverage(previous, person(3), 0.5);
    expect([...previous]).toEqual([128, 128, 128]);
  });

  it("converges on the person after a few frames", () => {
    const previous = new Uint8ClampedArray([0]);
    for (let i = 0; i < 6; i++) blendCoverage(previous, person(1), MASK_SMOOTHING);
    expect(previous[0]).toBeGreaterThan(250);
  });

  it("converges on the background just as readily", () => {
    const previous = new Uint8ClampedArray([255]);
    for (let i = 0; i < 6; i++) blendCoverage(previous, background(1), MASK_SMOOTHING);
    expect(previous[0]).toBeLessThan(5);
  });

  it("carries partial coverage through rather than rounding it to a decision", () => {
    // The whole point of a soft mask: a half-covered edge pixel has to stay
    // half-covered, or the ramp collapses back into the staircase it replaced.
    const previous = new Uint8ClampedArray([0]);
    blendCoverage(previous, new Uint8ClampedArray([120]), 1);
    expect(previous[0]).toBe(120);
  });

  it("writes in place rather than allocating a buffer per frame", () => {
    const previous = new Uint8ClampedArray([0]);
    expect(blendCoverage(previous, person(1), 1)).toBe(previous);
  });

  it("takes the new coverage outright at alpha 1, and ignores it at 0", () => {
    const hot = new Uint8ClampedArray([0]);
    blendCoverage(hot, person(1), 1);
    expect(hot[0]).toBe(255);

    const frozen = new Uint8ClampedArray([0]);
    blendCoverage(frozen, person(1), 0);
    expect(frozen[0]).toBe(0);
  });

  it("clamps a nonsense alpha rather than overshooting", () => {
    const over = new Uint8ClampedArray([0]);
    blendCoverage(over, person(1), 5);
    expect(over[0]).toBe(255);
  });

  it("stops at the shorter buffer when the frame size changes mid-call", () => {
    const previous = new Uint8ClampedArray([0, 0]);
    expect(() => blendCoverage(previous, person(8), 1)).not.toThrow();
    expect([...previous]).toEqual([255, 255]);
  });

  it("smooths by default without being told an alpha", () => {
    const previous = new Uint8ClampedArray([0]);
    blendCoverage(previous, person(1));
    expect(previous[0]).toBeGreaterThan(0);
    expect(previous[0]).toBeLessThan(255);
  });
});

describe("coverageFromConfidence", () => {
  it("believes the model well before it is certain", () => {
    // The point of the change. A hat scores nowhere near 0.5, and a halfway
    // threshold is what was throwing it away.
    expect(coverageFromConfidence(0.35)).toBe(255);
    expect(CONFIDENCE_PERSON).toBeLessThan(0.5);
  });

  it("still clears out what the model is confident is not there", () => {
    expect(coverageFromConfidence(0.02)).toBe(0);
    expect(coverageFromConfidence(0)).toBe(0);
  });

  it("ramps through the uncertain band instead of cutting at one number", () => {
    const mid = (CONFIDENCE_BACKGROUND + CONFIDENCE_PERSON) / 2;
    const c = coverageFromConfidence(mid);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(255);
  });

  it("rises monotonically, so more confidence never means less coverage", () => {
    let last = -1;
    for (let c = 0; c <= 1.0001; c += 0.01) {
      const v = coverageFromConfidence(c);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it("treats a garbage confidence as background rather than painting a person", () => {
    expect(coverageFromConfidence(Number.NaN)).toBe(0);
  });
});

describe("maskGrid and maskDilatePx", () => {
  it("carries the mask on a grid far smaller than the frame", () => {
    const g = maskGrid(1280, 720);
    expect(g.width * g.height).toBeLessThan(1280 * 720 * 0.2);
    expect(g.scale).toBeGreaterThan(2);
  });

  it("costs the same per frame whatever the camera is", () => {
    // The reason the bound is a pixel count and not a width. A fixed width makes
    // the cost depend on the camera's aspect and, backwards, on its size: at a
    // fixed 480 a 640x480 webcam would carry 173k mask pixels while a 1280x720
    // camera carried 130k — the cheap old camera paying more per frame than the
    // good new one.
    const sizes: Array<[number, number]> = [
      [1280, 720], [1920, 1080], [640, 480], [3840, 2160], [1080, 1920],
    ];
    const costs = sizes.map(([w, h]) => {
      const g = maskGrid(w, h);
      return g.width * g.height;
    });
    for (const cost of costs) {
      expect(cost).toBeLessThanOrEqual(135_000);
      expect(cost).toBeGreaterThan(120_000);
    }
  });

  it("never carries a mask finer than the frame it came from", () => {
    // Nothing to gain, and it would cost more than the frame.
    for (const [w, h] of [[320, 240], [160, 120], [64, 48]] as const) {
      const g = maskGrid(w, h);
      expect(g.width).toBeLessThanOrEqual(w);
      expect(g.height).toBeLessThanOrEqual(h);
      expect(g.scale).toBeGreaterThanOrEqual(1);
    }
  });

  it("is finer than the grid it replaced at every resolution anybody uses", () => {
    // The old rule was a flat 320 wide. This is what the freed frame budget buys.
    for (const [w, h] of [[640, 480], [1280, 720], [1920, 1080]] as const) {
      expect(maskGrid(w, h).scale).toBeLessThan(w / 320);
    }
  });

  it("keeps the frame's aspect, so the silhouette is not stretched", () => {
    const g = maskGrid(1280, 720);
    expect(g.width / g.height).toBeCloseTo(1280 / 720, 1);
  });

  it("costs a 1080p camera no more than a 720p one", () => {
    const hd = maskGrid(1280, 720);
    const fhd = maskGrid(1920, 1080);
    expect(fhd.width * fhd.height).toBe(hd.width * hd.height);
  });

  it("never upscales a camera that is already smaller than the grid", () => {
    const g = maskGrid(240, 180);
    expect(g.width).toBe(240);
    expect(g.scale).toBe(1);
  });

  it("widens by the same share of the picture at any resolution", () => {
    // A fixed grid radius would widen a 1080p face half as much as a 720p one.
    const hd = maskGrid(1280, 720);
    const fhd = maskGrid(1920, 1080);
    // As a share of the picture, not as a pixel count: one grid pixel is worth
    // more frame pixels on a bigger camera, which is the point of the grid.
    const shareHd = (maskDilatePx(1280, hd).up * hd.scale) / 1280;
    const shareFhd = (maskDilatePx(1920, fhd).up * fhd.scale) / 1920;
    expect(shareHd).toBeCloseTo(shareFhd, 3);
  });

  it("always widens upward by at least something", () => {
    const g = maskGrid(160, 120);
    expect(maskDilatePx(160, g).up).toBeGreaterThanOrEqual(1);
  });

  it("reaches furthest upward, barely sideways, and never downward", () => {
    // Headwear is above a head. Sideways growth is the halo off somebody's arms
    // and downward growth drags the desk up into them, so only one direction
    // earns its full reach.
    const r = maskDilatePx(1280, maskGrid(1280, 720));
    expect(r.up).toBeGreaterThan(r.side);
    expect(r.side).toBeGreaterThan(0);
    expect(r.down).toBe(0);
  });

  it("keeps 'do not grow downward' through the conversion to grid pixels", () => {
    // A blanket Math.max(1, ...) would floor zero to one and quietly reinstate
    // the growth this stopped.
    for (const width of [160, 640, 1280, 1920, 3840]) {
      expect(maskDilatePx(width, maskGrid(width, Math.round(width * 0.5625))).down).toBe(0);
    }
  });

  it("falls back to a sane frame for a garbage one", () => {
    expect(maskGrid(Number.NaN, Number.NaN)).toEqual(maskGrid(640, 480));
  });
});

describe("dilateCoverage", () => {
  const gridOf = (w: number, h: number, fill = 0) => new Uint8ClampedArray(w * h).fill(fill);
  const evenly = (r: number): DilateRadii => ({ up: r, down: r, side: r });

  it("spreads coverage outward from a covered pixel", () => {
    const w = 21, h = 1;
    const g = gridOf(w, h);
    g[10] = 255;
    dilateCoverage(g, w, h, evenly(4));
    expect(g[10]).toBe(255);
    expect(g[8]).toBeGreaterThan(0);
    expect(g[12]).toBeGreaterThan(0);
  });

  it("fades over the radius rather than ending at a new hard edge", () => {
    const w = 21, h = 1;
    const g = gridOf(w, h);
    g[10] = 255;
    dilateCoverage(g, w, h, evenly(4));
    expect(g[9]).toBeGreaterThan(g[8]);
    expect(g[8]).toBeGreaterThan(g[7]);
  });

  it("grows upward and not downward", () => {
    // The bleed and the headwear are the same mechanism pointed two ways. Up is
    // where a cap, a headwrap or a helmet sits; down is the desk.
    const w = 9, h = 9;
    const g = gridOf(w, h);
    g[4 * w + 4] = 255;
    dilateCoverage(g, w, h, { up: 3, down: 0, side: 0 });
    expect(g[2 * w + 4]).toBeGreaterThan(0);
    expect(g[6 * w + 4]).toBe(0);
  });

  it("reaches further up than sideways for the real radii", () => {
    const w = 41, h = 41;
    const g = gridOf(w, h);
    const centre = 20 * w + 20;
    g[centre] = 255;
    const r = maskDilatePx(1280, maskGrid(1280, 720));
    dilateCoverage(g, w, h, r);
    // Same distance from the centre, one up and one across.
    const d = r.up;
    expect(g[(20 - d) * w + 20]).toBeGreaterThanOrEqual(g[20 * w + (20 - d)]);
  });

  it("never shrinks anything", () => {
    const w = 16, h = 16;
    const g = gridOf(w, h);
    for (let i = 0; i < g.length; i++) g[i] = i % 7 === 0 ? 255 : 0;
    const before = Uint8ClampedArray.from(g);
    dilateCoverage(g, w, h, evenly(3));
    for (let i = 0; i < g.length; i++) expect(g[i]).toBeGreaterThanOrEqual(before[i]);
  });

  it("leaves an empty mask empty, so a frame with nobody in it stays that way", () => {
    const w = 12, h = 12;
    const g = gridOf(w, h);
    dilateCoverage(g, w, h, evenly(4));
    expect([...g].every((v) => v === 0)).toBe(true);
  });

  it("writes in place, like everything else on the frame path", () => {
    const g = gridOf(4, 4);
    expect(dilateCoverage(g, 4, 4, evenly(2))).toBe(g);
  });

  it("does nothing for a zero radius or a buffer that does not fit", () => {
    const g = gridOf(4, 4); g[5] = 255;
    expect([...dilateCoverage(Uint8ClampedArray.from(g), 4, 4, evenly(0))]).toEqual([...g]);
    expect([...dilateCoverage(Uint8ClampedArray.from(g), 9, 9, evenly(2))]).toEqual([...g]);
  });
});

// ── What growth may claim ────────────────────────────────────────────────────
//
// The more important half of the bleed. Growing a silhouette cannot tell the
// fabric of a headwrap from the wall behind a shoulder — both are only "not yet
// covered" — and the wall is the commoner neighbour. The model already knows the
// difference, and the confidence ramp already carries it.
describe("quietCoverageGaps", () => {
  /** A grid of `width` x `height`, row-major, from rows of 0-255 values. */
  const gridOf = (rows: number[][]) => new Uint8ClampedArray(rows.flat());
  const rowsOf = (g: Uint8ClampedArray, width: number) => {
    const out: number[][] = [];
    for (let i = 0; i < g.length; i += width) out.push([...g.slice(i, i + width)]);
    return out;
  };

  it("holds the faint tail between two people at zero", () => {
    // The shimmer: coverage wandering in the low tens across the gap, which the
    // composite turns into a faint sharp strip of the real room.
    const g = gridOf([[255, 255, 30, 12, 40, 255, 255]]);
    quietCoverageGaps(g, 7, 1, 4);
    expect(rowsOf(g, 7)[0]).toEqual([255, 255, 0, 0, 0, 255, 255]);
  });

  it("never raises a cell, so it cannot reveal the room it is hiding", () => {
    // The inverse of the bug this replaces. Raising coverage in the gap is what
    // revealed the strip, because `destination-in` keeps the camera where the
    // mask covers.
    const g = gridOf([[255, 0, 0, 255]]);
    quietCoverageGaps(g, 4, 1, 4);
    expect(rowsOf(g, 4)[0]).toEqual([255, 0, 0, 255]);
  });

  it("leaves a cell with a real claim to being a person", () => {
    // 150 is well up the feathered edge -- a strand of hair, the edge of a hand
    // between two people. Quieting subtracts, so this is the fence that matters.
    const g = gridOf([[255, 30, 150, 30, 255]]);
    quietCoverageGaps(g, 5, 1, 4);
    expect(rowsOf(g, 5)[0]).toEqual([255, 0, 150, 0, 255]);
  });

  it("leaves a gap wider than the bound alone", () => {
    const g = gridOf([[255, 20, 20, 20, 20, 20, 255]]);
    quietCoverageGaps(g, 7, 1, 1);
    expect(rowsOf(g, 7)[0]).toEqual([255, 20, 20, 20, 20, 20, 255]);
  });

  it("refuses a run with only one flank, which is open room", () => {
    // Nothing out there is enclosed by anybody, and the open background is
    // already at zero where the model is sure of it.
    const g = gridOf([[30, 30, 255, 255, 30, 30]]);
    quietCoverageGaps(g, 6, 1, 5);
    expect(rowsOf(g, 6)[0]).toEqual([30, 30, 255, 255, 30, 30]);
  });

  it("will not let a weak flank authorise anything", () => {
    const g = gridOf([[120, 30, 30, 120]]);
    quietCoverageGaps(g, 4, 1, 4);
    expect(rowsOf(g, 4)[0]).toEqual([120, 30, 30, 120]);
  });

  it("does not spend the budget on a body's own feathered edge", () => {
    // Only the empty cells are charged, which is what lets a realistic gap
    // qualify: an 8-cell core of room sits inside a far wider sub-anchor run.
    const g = gridOf([[255, 180, 120, 60, 0, 0, 60, 120, 180, 255]]);
    quietCoverageGaps(g, 10, 1, 4);
    const after = rowsOf(g, 10)[0];
    expect(after).toEqual([255, 180, 120, 0, 0, 0, 0, 120, 180, 255]);
  });

  it("still refuses when the empty core itself is too wide", () => {
    const g = gridOf([[255, 180, 0, 0, 0, 0, 0, 0, 180, 255]]);
    quietCoverageGaps(g, 10, 1, 4);
    expect(rowsOf(g, 10)[0]).toEqual([255, 180, 0, 0, 0, 0, 0, 0, 180, 255]);
  });

  it("refuses a run of unlimited faintness, which is what the backstop is for", () => {
    // Reach 2, so the backstop bites at 3 x 2 = 6 cells; this run is 8.
    const g = gridOf([[255, 60, 60, 60, 60, 60, 60, 60, 60, 255]]);
    quietCoverageGaps(g, 10, 1, 2);
    expect(rowsOf(g, 10)[0]).toEqual([255, 60, 60, 60, 60, 60, 60, 60, 60, 255]);
  });

  it("does not let one row's anchors authorise anything in another", () => {
    const g = gridOf([
      [255, 30, 255],
      [30, 30, 30],
    ]);
    quietCoverageGaps(g, 3, 2, 3);
    expect(rowsOf(g, 3)).toEqual([
      [255, 0, 255],
      [30, 30, 30],
    ]);
  });

  it("handles each row of a diagonal gap on its own", () => {
    const g = gridOf([
      [255, 20, 20, 255, 20],
      [20, 255, 20, 20, 255],
    ]);
    quietCoverageGaps(g, 5, 2, 3);
    expect(rowsOf(g, 5)).toEqual([
      [255, 0, 0, 255, 20],
      [20, 255, 0, 0, 255],
    ]);
  });

  it("is a no-op with no reach, and returns the buffer it was given", () => {
    const g = gridOf([[255, 30, 255]]);
    const same = quietCoverageGaps(g, 3, 1, 0);
    expect(same).toBe(g);
    expect(rowsOf(g, 3)[0]).toEqual([255, 30, 255]);
  });

  it("survives a grid too narrow to contain a gap", () => {
    const g = gridOf([[255, 255]]);
    expect(() => quietCoverageGaps(g, 2, 1, 4)).not.toThrow();
    expect(rowsOf(g, 2)[0]).toEqual([255, 255]);
  });

  it("takes a caller's ceiling, and respects it as the only thing it may lower", () => {
    const g = gridOf([[255, 50, 150, 255]]);
    quietCoverageGaps(g, 4, 1, 4, 200, 60);
    expect(rowsOf(g, 4)[0]).toEqual([255, 0, 150, 255]);
  });
});

describe("maskGapSpanPx", () => {
  it("is the same share of a person on any camera", () => {
    const big = maskGapSpanPx(1280, maskGrid(1280, 720));
    const small = maskGapSpanPx(640, maskGrid(640, 480));
    const asFrameFraction = (gridPx: number, g: MaskGrid, w: number) => (gridPx * g.scale) / w;
    expect(asFrameFraction(big, maskGrid(1280, 720), 1280)).toBeCloseTo(
      asFrameFraction(small, maskGrid(640, 480), 640),
      2,
    );
  });

  it("covers a shoulder gap and falls far short of an arm's width", () => {
    const grid = maskGrid(1280, 720);
    const inFramePx = maskGapSpanPx(1280, grid) * grid.scale;
    expect(inFramePx).toBeGreaterThan(16);
    expect(inFramePx).toBeLessThan(64);
  });

  it("never returns zero", () => {
    expect(maskGapSpanPx(1, maskGrid(1, 1))).toBeGreaterThanOrEqual(1);
  });

  it("falls back on a nonsense frame width rather than returning NaN", () => {
    expect(maskGapSpanPx(Number.NaN, maskGrid(1280, 720))).toBeGreaterThanOrEqual(1);
    expect(maskGapSpanPx(-10, maskGrid(1280, 720))).toBeGreaterThanOrEqual(1);
  });
});

describe("dilateCeiling", () => {
  it("permits growth wherever the model is unsure and nowhere else", () => {
    const coverage = new Uint8ClampedArray([0, 1, 128, 254, 255]);
    const ceiling = dilateCeiling(new Uint8ClampedArray(coverage.length), coverage);
    expect([...ceiling]).toEqual([0, 255, 255, 255, 255]);
  });

  it("stops growth inventing coverage in confident background", () => {
    // The halo, in miniature: a covered pixel beside a run the model is certain
    // is the room.
    const w = 9, h = 1;
    const coverage = new Uint8ClampedArray(w);
    coverage[4] = 255;
    const ceiling = dilateCeiling(new Uint8ClampedArray(w), coverage);

    const unconstrained = Uint8ClampedArray.from(coverage);
    dilateCoverage(unconstrained, w, h, { up: 0, down: 0, side: 4 });
    expect(unconstrained[2]).toBeGreaterThan(0);

    const constrained = Uint8ClampedArray.from(coverage);
    dilateCoverage(constrained, w, h, { up: 0, down: 0, side: 4 }, ceiling);
    expect(constrained[2]).toBe(0);
    expect(constrained[4]).toBe(255);
  });

  it("fills the uncertainty a headwrap lands in", () => {
    // What the constraint is FOR. The model gives fabric middling confidence, so
    // those pixels sit in the ramp — and growth is allowed to carry them to
    // opaque, which is the top of somebody's head staying attached.
    const w = 9, h = 1;
    const coverage = new Uint8ClampedArray(w);
    coverage[4] = 255;
    coverage[3] = 40;  // the edge of a headwrap: unsure, not absent
    coverage[2] = 20;
    const ceiling = dilateCeiling(new Uint8ClampedArray(w), coverage);

    dilateCoverage(coverage, w, h, { up: 0, down: 0, side: 4 }, ceiling);
    expect(coverage[3]).toBeGreaterThan(40);
    expect(coverage[2]).toBeGreaterThan(20);
    // And still nothing beyond where the model saw anything at all.
    expect(coverage[0]).toBe(0);
  });

  it("caps nothing above what was already opaque", () => {
    const coverage = new Uint8ClampedArray([255, 255, 255]);
    const ceiling = dilateCeiling(new Uint8ClampedArray(3), coverage);
    dilateCoverage(coverage, 3, 1, { up: 0, down: 0, side: 2 }, ceiling);
    expect([...coverage]).toEqual([255, 255, 255]);
  });
});

// ── The still-frame harness ──────────────────────────────────────────────────
//
// A camera cannot run here, so the frames are built rather than captured — and
// built to be the case that was broken. A head the model is sure about, a band
// of headwear above it that the model is only slightly sure about, and room
// around both that it is sure is not a person. Those confidences are the shape
// of the real failure: selfie_segmenter does not score a cap at zero, it scores
// it low, and a halfway threshold discards it.
//
// What makes this a regression test rather than a demonstration: the assertions
// run the shipped pipeline end to end, and the last one fails if anyone raises
// the threshold back toward the model's own verdict.

interface Frame { confidence: Float32Array; width: number; height: number }

/** A 120x120 frame: a head, headwear sitting on it, and a room behind both. */
function frameWithHeadwear(headwearConfidence: number): Frame {
  const width = 120, height = 120;
  const confidence = new Float32Array(width * height).fill(0.02);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      // The head: an ellipse the model reads confidently.
      const dx = (x - 60) / 26;
      const dy = (y - 62) / 32;
      if (dx * dx + dy * dy <= 1) confidence[i] = 0.96;
      // The headwear: a band across the top of the head, which the model can
      // see something at but will not commit to.
      else if (y >= 22 && y < 36 && x >= 32 && x < 88) confidence[i] = headwearConfidence;
    }
  }
  return { confidence, width, height };
}

/**
 * Run a built frame through the real mask pipeline and hand back grid coverage.
 *
 * The ceiling is part of that pipeline now, and building it here is the point:
 * growth is allowed to fill what the model was unsure about and forbidden to
 * invent coverage where it was not. A harness that skipped it would be testing
 * the unconstrained grow the processor no longer performs — and would report
 * headwear as half-recovered when the real path recovers it completely.
 */
function maskFor(frame: Frame): { coverage: Uint8ClampedArray; grid: ReturnType<typeof maskGrid> } {
  const grid = maskGrid(frame.width, frame.height);
  const coverage = new Uint8ClampedArray(grid.width * grid.height);
  sampleCoverageFromConfidence(coverage, frame.confidence, frame.width, frame.height, grid);
  const ceiling = dilateCeiling(new Uint8ClampedArray(coverage.length), coverage);
  dilateCoverage(coverage, grid.width, grid.height, maskDilatePx(frame.width, grid), ceiling);
  return { coverage, grid };
}

/** Average coverage over a box given in frame coordinates. */
function coverageOver(
  mask: { coverage: Uint8ClampedArray; grid: ReturnType<typeof maskGrid> },
  x0: number, y0: number, x1: number, y1: number,
): number {
  const { coverage, grid } = mask;
  let sum = 0, n = 0;
  for (let y = Math.floor(y0 / grid.scale); y < Math.ceil(y1 / grid.scale); y++) {
    for (let x = Math.floor(x0 / grid.scale); x < Math.ceil(x1 / grid.scale); x++) {
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
      sum += coverage[y * grid.width + x];
      n++;
    }
  }
  return n ? sum / n : 0;
}

describe("headwear survives the mask", () => {
  // Where the band sits, and a patch of room well clear of everything.
  const HEADWEAR = [40, 24, 80, 34] as const;
  const ROOM = [4, 4, 24, 18] as const;

  it("keeps headwear the model is only slightly sure about", () => {
    // 0.28 is the case that was being thrown away: well under a halfway
    // threshold, well over nothing.
    const mask = maskFor(frameWithHeadwear(0.28));
    expect(coverageOver(mask, ...HEADWEAR)).toBeGreaterThan(200);
  });

  it("keeps headwear the model is barely sure about", () => {
    const mask = maskFor(frameWithHeadwear(0.18));
    expect(coverageOver(mask, ...HEADWEAR)).toBeGreaterThan(120);
  });

  it("still keeps the head itself, which was never in doubt", () => {
    const mask = maskFor(frameWithHeadwear(0.28));
    expect(coverageOver(mask, 48, 50, 72, 74)).toBeGreaterThan(240);
  });

  it("does not paint the room in, however generous it is being", () => {
    const mask = maskFor(frameWithHeadwear(0.28));
    expect(coverageOver(mask, ...ROOM)).toBeLessThan(20);
  });

  it("leaves a frame with nobody in it empty", () => {
    const width = 60, height = 60;
    const empty = { confidence: new Float32Array(width * height).fill(0.01), width, height };
    const mask = maskFor(empty);
    expect(Math.max(...mask.coverage)).toBeLessThan(10);
  });

  it("would fail at the threshold the model itself uses", () => {
    // The guard on the guard. If CONFIDENCE_PERSON drifts back up toward 0.5,
    // headwear at 0.28 stops being covered and the tests above go red — this
    // states that dependency outright rather than leaving it implied.
    expect(coverageFromConfidence(0.28)).toBeGreaterThan(200);
    expect(CONFIDENCE_PERSON).toBeLessThanOrEqual(0.35);
  });

  it("recovers headwear the old hard mask dropped outright", () => {
    // The same frame through the fallback path, which is what shipped before:
    // the model's verdict, with nothing above the head in it.
    const frame = frameWithHeadwear(0.28);
    const grid = maskGrid(frame.width, frame.height);
    const labels = new Uint8Array(frame.confidence.length);
    for (let i = 0; i < labels.length; i++) labels[i] = frame.confidence[i] >= 0.5 ? 0 : 255;
    const old = new Uint8ClampedArray(grid.width * grid.height);
    sampleCoverageFromCategory(old, labels, frame.width, frame.height, grid);
    const oldMask = { coverage: old, grid };

    expect(coverageOver(oldMask, ...HEADWEAR)).toBeLessThan(40);
    expect(coverageOver(maskFor(frame), ...HEADWEAR)).toBeGreaterThan(200);
  });
});

describe("native templates", () => {
  it("has unique ids", () => {
    const ids = NATIVE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks one up by id and reports a missing one as null", () => {
    expect(templateById("neural")?.name).toBe("Neural");
    expect(templateById("nope")).toBeNull();
  });

  it("gives every template ordered stops spanning the full axis", () => {
    for (const t of NATIVE_TEMPLATES) {
      expect(t.stops.length).toBeGreaterThanOrEqual(2);
      expect(t.stops[0].at).toBe(0);
      expect(t.stops[t.stops.length - 1].at).toBe(1);
      const ats = t.stops.map((s) => s.at);
      expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    }
  });

  it("keeps gradient axes inside the frame", () => {
    for (const t of NATIVE_TEMPLATES) {
      for (const coord of [...t.from, ...t.to]) {
        expect(coord).toBeGreaterThanOrEqual(0);
        expect(coord).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("validateBackgroundUpload", () => {
  it("accepts the image types a camera background can be", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateBackgroundUpload({ type, size: 1024 }).ok).toBe(true);
    }
  });

  it("rejects a non-image, naming what is allowed", () => {
    const result = validateBackgroundUpload({ type: "application/pdf", size: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/JPEG, PNG or WebP/);
  });

  it("rejects an empty file", () => {
    expect(validateBackgroundUpload({ type: "image/png", size: 0 }).ok).toBe(false);
  });

  it("rejects an oversized file, naming the limit", () => {
    const result = validateBackgroundUpload({ type: "image/png", size: UPLOAD_MAX_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/8MB/);
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateBackgroundUpload({ type: "image/png", size: UPLOAD_MAX_BYTES }).ok).toBe(true);
  });
});

describe("shouldSuspendEffect", () => {
  it("leaves a healthy call alone", () => {
    expect(shouldSuspendEffect({ bwMode: "normal", consecutiveSlowFrames: 0 }))
      .toEqual({ suspend: false, reason: null });
  });

  it("stops decorating frames when video is already being shed for audio", () => {
    expect(shouldSuspendEffect({ bwMode: "audio-only", consecutiveSlowFrames: 0 }))
      .toEqual({ suspend: true, reason: "bandwidth" });
  });

  it("tolerates a single stall rather than judging the machine on it", () => {
    expect(shouldSuspendEffect({ bwMode: "normal", consecutiveSlowFrames: 1 }).suspend).toBe(false);
    expect(shouldSuspendEffect({ bwMode: "normal", consecutiveSlowFrames: SLOW_FRAME_RUN - 1 }).suspend).toBe(false);
  });

  it("gives up once slow frames are sustained", () => {
    expect(shouldSuspendEffect({ bwMode: "normal", consecutiveSlowFrames: SLOW_FRAME_RUN }))
      .toEqual({ suspend: true, reason: "cpu" });
  });

  it("blames bandwidth first when both are true — it is the one the user can feel", () => {
    expect(shouldSuspendEffect({ bwMode: "audio-only", consecutiveSlowFrames: 999 }).reason).toBe("bandwidth");
  });

  it("has a frame budget under a 30fps frame time", () => {
    expect(FRAME_BUDGET_MS).toBeLessThan(1000 / 30 * 2);
  });
});

describe("suspensionMessage", () => {
  it("explains bandwidth without blaming the device", () => {
    expect(suspensionMessage("bandwidth")).toMatch(/connection/);
  });

  it("explains cpu without blaming the network", () => {
    expect(suspensionMessage("cpu")).toMatch(/device/);
  });
});

describe("encode / decode", () => {
  const cases: BackgroundEffect[] = [
    { kind: "none" },
    { kind: "blur", strength: "light" },
    { kind: "blur", strength: "heavy" },
    { kind: "template", id: "neural" },
    { kind: "custom", id: "abc-123" },
  ];

  it("round-trips every kind of choice", () => {
    for (const effect of cases) {
      expect(decodeEffect(encodeEffect(effect))).toEqual(effect);
    }
  });

  it("falls back to none for anything it does not recognise", () => {
    for (const raw of [null, undefined, "", "garbage", ":", "blur:", "blur:medium", "template:", "wat:x"]) {
      expect(decodeEffect(raw)).toEqual(NO_BACKGROUND);
    }
  });

  it("drops a template that no longer ships rather than rendering nothing", () => {
    expect(decodeEffect("template:retired-2019")).toEqual(NO_BACKGROUND);
  });

  it("keeps a custom id even though the image may live on another device", () => {
    expect(decodeEffect("custom:missing-here")).toEqual({ kind: "custom", id: "missing-here" });
  });

  it("keeps colons inside an id intact", () => {
    expect(decodeEffect("custom:a:b")).toEqual({ kind: "custom", id: "a:b" });
  });

  it("stores under a namespaced key, like the device preferences beside it", () => {
    expect(BACKGROUND_PREF_KEY.startsWith("fundexecs.")).toBe(true);
  });
});

describe("needsSegmentation", () => {
  it("is false only when there is no effect", () => {
    expect(needsSegmentation({ kind: "none" })).toBe(false);
    expect(needsSegmentation({ kind: "blur", strength: "light" })).toBe(true);
    expect(needsSegmentation({ kind: "template", id: "neural" })).toBe(true);
    expect(needsSegmentation({ kind: "custom", id: "x" })).toBe(true);
  });
});

describe("effectLabel", () => {
  it("uses the words the picker uses", () => {
    expect(effectLabel({ kind: "none" })).toBe("None");
    expect(effectLabel({ kind: "blur", strength: "light" })).toBe("Slight blur");
    expect(effectLabel({ kind: "blur", strength: "heavy" })).toBe("Extra blur");
    expect(effectLabel({ kind: "template", id: "neural" })).toBe("Neural");
    expect(effectLabel({ kind: "custom", id: "x" })).toBe("Your image");
  });

  it("stays readable for a template that has gone", () => {
    expect(effectLabel({ kind: "template", id: "gone" })).toBe("Background");
  });
});

describe("sameEffect", () => {
  // The reason this exists: a pick made while the segmenter is downloading has
  // to be compared against the one the build was started for, and every pick
  // builds a fresh object.
  it("compares by value, not by identity", () => {
    expect(sameEffect({ kind: "blur", strength: "heavy" }, { kind: "blur", strength: "heavy" })).toBe(true);
    expect(sameEffect({ kind: "template", id: "neural" }, { kind: "template", id: "neural" })).toBe(true);
    expect(sameEffect({ kind: "custom", id: "a" }, { kind: "custom", id: "a" })).toBe(true);
    expect(sameEffect(NO_BACKGROUND, { kind: "none" })).toBe(true);
  });

  it("separates two strengths of the same effect", () => {
    expect(sameEffect({ kind: "blur", strength: "light" }, { kind: "blur", strength: "heavy" })).toBe(false);
  });

  it("separates two backgrounds of the same kind", () => {
    expect(sameEffect({ kind: "template", id: "neural" }, { kind: "template", id: "terminal" })).toBe(false);
    expect(sameEffect({ kind: "custom", id: "a" }, { kind: "custom", id: "b" })).toBe(false);
  });

  it("separates different kinds that share an id", () => {
    expect(sameEffect({ kind: "template", id: "x" }, { kind: "custom", id: "x" })).toBe(false);
  });
});

// ── Pacing ───────────────────────────────────────────────────────────────────
//
// The processor's loop runs on requestAnimationFrame, at the display's refresh
// rate, while the canvas it draws into is captured at OUTPUT_FPS. So a MediaPipe
// inference, a mask upscale, a putImageData and two blurs ran two to five times
// per frame anybody would ever see, and the rest was thrown away.
describe("frameIntervalMs", () => {
  it("is the gap between output frames", () => {
    expect(frameIntervalMs(24)).toBeCloseTo(41.667, 2);
    expect(frameIntervalMs(30)).toBeCloseTo(33.333, 2);
    expect(frameIntervalMs()).toBeCloseTo(1000 / OUTPUT_FPS, 5);
  });

  it("falls back to the output rate for a nonsense one", () => {
    // A zero here would make every frame "due", which is the waste this fixes.
    for (const bad of [0, -24, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(frameIntervalMs(bad)).toBeCloseTo(1000 / OUTPUT_FPS, 5);
    }
  });
});

describe("shouldDrawFrame", () => {
  it("always draws the first frame", () => {
    // The canvas is captured the instant an effect is chosen; waiting even one
    // interval would put a black frame on the wire.
    expect(shouldDrawFrame(null, 0)).toBe(true);
    expect(shouldDrawFrame(null, 999_999)).toBe(true);
  });

  it("skips the frames a 60Hz display offers in between", () => {
    // 16.7ms steps. Two of every three animation frames did full segmentation
    // work for nothing.
    expect(shouldDrawFrame(0, 16.7)).toBe(false);
    expect(shouldDrawFrame(0, 33.3)).toBe(true);
  });

  it("skips more of them on a 120Hz display", () => {
    // 8.3ms steps, where four in five were waste.
    expect(shouldDrawFrame(0, 8.3)).toBe(false);
    expect(shouldDrawFrame(0, 16.7)).toBe(false);
    expect(shouldDrawFrame(0, 25)).toBe(false);
    expect(shouldDrawFrame(0, 41.7)).toBe(true);
  });

  it("never paces below the rate the track is captured at", () => {
    // The failure a strict comparison would cause. At 60Hz a `>= 41.7` rule can
    // only land on 50ms, which is 20fps — under the capture rate, so the track
    // repeats frames and looks worse than the waste being removed.
    const drawnAt: number[] = [];
    let last: number | null = null;
    // Two seconds of a 60Hz display.
    for (let i = 1; i <= 120; i += 1) {
      const now = (i * 1000) / 60;
      if (shouldDrawFrame(last, now)) { drawnAt.push(now); last = now; }
    }
    const fps = drawnAt.length / 2;
    expect(fps).toBeGreaterThanOrEqual(OUTPUT_FPS);
    // And it is still a real saving: half the frames, not all of them.
    expect(drawnAt.length).toBeLessThan(120 * 0.6);
  });

  it("settles at the capture rate on a 120Hz display", () => {
    let last: number | null = null;
    let drawn = 0;
    for (let i = 1; i <= 240; i += 1) {
      const now = (i * 1000) / 120;
      if (shouldDrawFrame(last, now)) { drawn += 1; last = now; }
    }
    const fps = drawn / 2;
    expect(fps).toBeGreaterThanOrEqual(OUTPUT_FPS);
    expect(fps).toBeLessThanOrEqual(OUTPUT_FPS + 6);
  });

  it("draws rather than stalling when the clock does not move forward", () => {
    // Skipping work is only ever an optimisation. It must not be able to freeze
    // the picture.
    expect(shouldDrawFrame(1_000, 1_000)).toBe(true);
    expect(shouldDrawFrame(1_000, 500)).toBe(true);
  });

  it("keeps up with a slower requested rate", () => {
    expect(shouldDrawFrame(0, 60, 15)).toBe(true);
    expect(shouldDrawFrame(0, 30, 15)).toBe(false);
  });
});

// ── The width of the seam ────────────────────────────────────────────────────
//
// The seam was soft because it was blurred, which is not the same as accurate.
// The mask is upscaled from the grid and then feathered, so alpha crosses from
// room to person over roughly eight pixels at 720p — right along hair, and a
// visible ring of the real room everywhere else.
describe("sharpenEdge", () => {
  const buf = (...v: number[]) => new Uint8ClampedArray(v);

  it("clears a halo pixel the model barely saw", () => {
    const out = sharpenEdge(new Uint8ClampedArray(1), buf(40));
    expect(out[0]).toBe(0);
  });

  it("makes headwear the model put at 0.28 fully opaque", () => {
    // The same change that removes the ring completes the head covering, which
    // is the reason to believe it is the right mechanism rather than a trade.
    const coverage = buf(coverageFromConfidence(0.28));
    const out = sharpenEdge(new Uint8ClampedArray(1), coverage);
    expect(out[0]).toBe(255);
  });

  it("leaves the decided ends exactly where they were", () => {
    const out = sharpenEdge(new Uint8ClampedArray(2), buf(0, 255));
    expect([...out]).toEqual([0, 255]);
  });

  it("still crosses gradually through the genuinely undecided middle", () => {
    // Narrower, not binary: hair has to keep a ramp or it comes back as a
    // staircase.
    const coverage = buf(96, 112, 128, 144, 160);
    const out = sharpenEdge(new Uint8ClampedArray(coverage.length), coverage);
    const values = [...out];
    expect(new Set(values).size).toBeGreaterThan(3);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
  });

  it("narrows the band rather than moving it", () => {
    // The midpoint is a fixed point, so the silhouette does not creep inward or
    // outward — only the width of the transition changes.
    const out = sharpenEdge(new Uint8ClampedArray(1), buf(128));
    expect(out[0]).toBeGreaterThanOrEqual(127);
    expect(out[0]).toBeLessThanOrEqual(129);
  });

  it("writes to the output and never touches the history it was given", () => {
    // The trap this signature exists to prevent: sharpening the temporal
    // history in place compounds every frame until the mask is binary, and the
    // smoothing is left with nothing to smooth.
    const history = buf(40, 96, 200);
    const before = [...history];
    const out = new Uint8ClampedArray(history.length);
    expect(sharpenEdge(out, history)).toBe(out);
    expect([...history]).toEqual(before);
  });

  it("is a no-op at a contrast of one, and survives a nonsense one", () => {
    const coverage = buf(40, 128, 200);
    expect([...sharpenEdge(new Uint8ClampedArray(3), coverage, 1)]).toEqual([40, 128, 200]);
    for (const bad of [0, -2, Number.NaN]) {
      expect([...sharpenEdge(new Uint8ClampedArray(3), coverage, bad)]).toEqual([40, 128, 200]);
    }
  });

  it("does not read past a shorter output", () => {
    expect(() => sharpenEdge(new Uint8ClampedArray(2), buf(1, 2, 3, 4))).not.toThrow();
  });
});

describe("the sampling fast path", () => {
  // The claim the fast path rests on: when the mask arrives at grid size -- which
  // is what the processor always asks for -- the four taps are four reads of the
  // same pixel. These tests are what stops it being an unverified assumption.

  it("resolves all four taps to the same pixel when source and grid agree", () => {
    for (const [fw, fh] of [[640, 480], [1280, 720], [1920, 1080], [320, 240]] as const) {
      const grid = maskGrid(fw, fh);
      const sx = 1, sy = 1; // source === grid
      let differing = 0;
      for (let gy = 0; gy < grid.height; gy++) {
        const cy = (gy + 0.5) * sy;
        const y0 = Math.floor(cy - sy / 4);
        const y1 = Math.floor(cy + sy / 4);
        for (let gx = 0; gx < grid.width; gx++) {
          const cx = (gx + 0.5) * sx;
          if (Math.floor(cx - sx / 4) !== Math.floor(cx + sx / 4) || y0 !== y1) differing += 1;
        }
      }
      expect(differing).toBe(0);
    }
  });

  it("agrees with coverageFromConfidence on every cell", () => {
    // The ramp is inlined into the loop -- that inlining is most of the saving,
    // and it is also a second copy of the rule. This is the test that keeps the
    // copy honest.
    const grid = maskGrid(640, 480);
    const n = grid.width * grid.height;
    const conf = new Float32Array(n);
    for (let i = 0; i < n; i++) conf[i] = (i % 101) / 100;

    const out = sampleCoverageFromConfidence(new Uint8ClampedArray(n), conf, grid.width, grid.height, grid);
    for (let i = 0; i < n; i++) expect(out[i]).toBe(coverageFromConfidence(conf[i]));
  });

  it("agrees with coverageFromConfidence across the whole float range, not just 0-1", () => {
    const probes = [
      -1, -0.0001, 0, 0.0001, 0.039, 0.04, 0.0401, 0.1, 0.17, 0.2999, 0.3, 0.3001,
      0.5, 0.9999, 1, 1.5, 1e6,
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    ];
    const grid: MaskGrid = { width: probes.length, height: 1, scale: 1 };
    const conf = new Float32Array(probes);
    const out = sampleCoverageFromConfidence(new Uint8ClampedArray(probes.length), conf, probes.length, 1, grid);
    probes.forEach((p, i) => expect(out[i]).toBe(coverageFromConfidence(Math.fround(p))));
  });

  it("agrees with personCoverage on the category path", () => {
    const grid: MaskGrid = { width: 4, height: 2, scale: 1 };
    const labels = new Uint8Array([0, 255, 7, 0, 255, 0, 0, 128]);
    const out = sampleCoverageFromCategory(new Uint8ClampedArray(8), labels, 4, 2, grid);
    labels.forEach((label, i) => expect(out[i]).toBe(personCoverage(label)));
  });

  it("still averages four taps when the mask does NOT arrive at grid size", () => {
    // The general path has to survive a model or a MediaPipe version that hands
    // back a different size. A 4x1 source into a 2x1 grid samples columns 0 and
    // 1 for the left cell and 2 and 3 for the right.
    const grid: MaskGrid = { width: 2, height: 1, scale: 2 };
    const conf = new Float32Array([1, 0, 0, 1]);
    const out = sampleCoverageFromConfidence(new Uint8ClampedArray(2), conf, 4, 1, grid);
    // Each cell reads its two columns twice (one row, two x taps), so each is
    // (255 + 0 + 255 + 0) / 4 -- rounded by the clamped array.
    expect([...out]).toEqual([128, 128]);
  });

  it("refuses a source with no size rather than reading out of bounds", () => {
    const grid: MaskGrid = { width: 2, height: 2, scale: 1 };
    const out = new Uint8ClampedArray([9, 9, 9, 9]);
    expect([...sampleCoverageFromConfidence(out, new Float32Array(4), 0, 2, grid)]).toEqual([9, 9, 9, 9]);
    expect([...sampleCoverageFromCategory(out, new Uint8Array(4), 2, -1, grid)]).toEqual([9, 9, 9, 9]);
  });

  it("does not reuse one grid's column taps for another", () => {
    // The taps are cached across frames, because the grid does not change
    // between them. It DOES change when the camera does, and a stale table
    // would sample the wrong columns for the rest of the call.
    const wide: MaskGrid = { width: 2, height: 1, scale: 2 };
    const narrow: MaskGrid = { width: 4, height: 1, scale: 1 };
    const conf = new Float32Array([1, 0, 0, 1]);

    const first = [...sampleCoverageFromConfidence(new Uint8ClampedArray(2), conf, 4, 1, wide)];
    const second = [...sampleCoverageFromConfidence(new Uint8ClampedArray(4), conf, 4, 1, narrow)];
    const again = [...sampleCoverageFromConfidence(new Uint8ClampedArray(2), conf, 4, 1, wide)];

    expect(second).toEqual([255, 0, 0, 255]);
    expect(again).toEqual(first);
  });

  it("does not reuse one source size's taps for another at the same grid width", () => {
    const grid: MaskGrid = { width: 2, height: 1, scale: 2 };
    const four = new Float32Array([1, 0, 0, 1]);
    const two = new Float32Array([1, 0]);

    expect([...sampleCoverageFromConfidence(new Uint8ClampedArray(2), four, 4, 1, grid)]).toEqual([128, 128]);
    // A 2x1 source into a 2x1 grid is the 1:1 path, so no taps are consulted at
    // all; then back to 4x1, which must rebuild them.
    expect([...sampleCoverageFromConfidence(new Uint8ClampedArray(2), two, 2, 1, grid)]).toEqual([255, 0]);
    expect([...sampleCoverageFromConfidence(new Uint8ClampedArray(2), four, 4, 1, grid)]).toEqual([128, 128]);
  });
});

describe("the blend's rate table", () => {
  it("gives the same result as computing the rate per pixel", () => {
    // The table is cached by (confident, uncertain, confirm). Swapping the
    // parameters has to rebuild it, or a caller passing different rates would
    // silently get the previous caller's.
    const n = 64;
    const target = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) target[i] = (i * 4) % 256;

    const run = (confident: number, uncertain: number, confirm: number) => {
      const previous = new Uint8ClampedArray(n);
      const agreement = createMaskAgreement(n);
      // Prime, then a frame that reverses, then a frame that reverses back --
      // which is what drives the count off zero and onto the slow rate.
      blendCoverageByAgreement(previous, target, agreement, confident, uncertain, 8, confirm);
      const up = new Uint8ClampedArray(n).fill(255);
      const down = new Uint8ClampedArray(n).fill(0);
      blendCoverageByAgreement(previous, up, agreement, confident, uncertain, 8, confirm);
      blendCoverageByAgreement(previous, down, agreement, confident, uncertain, 8, confirm);
      return [...previous];
    };

    const a = run(0.5, 0.1, 1);
    const b = run(0.9, 0.9, 1);
    const c = run(0.5, 0.1, 1);

    expect(c).toEqual(a);
    expect(b).not.toEqual(a);
  });

  it("walks the rate down over a cap larger than one", () => {
    // With confirm > 1 the rate is a ramp rather than a switch, and the table
    // has to hold every step of it.
    const n = 8;
    const previous = new Uint8ClampedArray(n).fill(0);
    const agreement = createMaskAgreement(n);
    const up = new Uint8ClampedArray(n).fill(255);
    const down = new Uint8ClampedArray(n).fill(0);

    blendCoverageByAgreement(previous, down, agreement, 1, 0, 8, 3);
    const seen: number[] = [];
    for (let frame = 0; frame < 6; frame++) {
      blendCoverageByAgreement(previous, frame % 2 === 0 ? up : down, agreement, 1, 0, 8, 3);
      seen.push(previous[0]);
    }
    // Each reversal slows it further; by the third the rate is 0 and the value
    // stops moving.
    expect(seen[0]).toBe(255);
    expect(seen[seen.length - 1]).toBe(seen[seen.length - 2]);
  });
});
