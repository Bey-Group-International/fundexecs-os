// lib/meetings/mask-compositor.ts
// The masking chain, with no opinion about which thread it is running on.
//
// This is the per-frame work: sample the model's mask onto the grid, quiet the
// gap between two people, grow it over headwear, blend it against the previous
// frame, sharpen and feather the edge, paint the background, and keep the camera
// frame only where the mask covers. Roughly 3.5ms of it per frame, on top of a
// ~520KB GPU-to-CPU readback that the caller does.
//
// It lives apart from `background-processor.ts` for one reason: the chain has to
// run in a worker, and nothing in a worker can call `document.createElement`.
// `mask-pipeline.ts` decides WHERE the chain runs; this is the chain it runs,
// written once so the two threads cannot drift apart. The alternative -- a
// worker copy of the composite -- means every future mask fix has to be made
// twice, and the half nobody is looking at is the half that goes wrong. Both of
// this month's masking defects were in this chain.
//
// Three things make it thread-agnostic.
//
// Surfaces come from a factory the caller supplies, because the main thread
// makes them with `document.createElement("canvas")` and a worker makes them
// with `new OffscreenCanvas(...)`. The compositor never names either.
//
// The context type is the UNION of the two real context types rather than a
// hand-rolled interface. They already agree on every call this chain makes, so
// a structural interface would only be a second list to keep in step -- and one
// that would happily accept a fake that the browsers would not.
//
// And the mask arrives as a plain array, not as the handle MediaPipe hands back.
// That keeps two things out of here that do not belong: the GPU readback, which
// is the single most expensive step and so has to be timed where it happens, and
// `close()`, which decides when GPU memory is released. Both stay with whoever
// owns the segmenter.

import {
  NO_BACKGROUND,
  blendCoverageByAgreement,
  blurRadiusPx,
  createMaskAgreement,
  dilateCeiling,
  dilateCoverage,
  maskDilatePx,
  maskFeatherPx,
  maskGapSpanPx,
  maskGrid,
  needsSegmentation,
  quietCoverageGaps,
  sampleCoverageFromCategory,
  sampleCoverageFromConfidence,
  sharpenEdge,
  templateById,
  type BackgroundEffect,
  type BackgroundTemplate,
  type BlurStrength,
  type DilateRadii,
  type MaskAgreement,
  type MaskGrid,
} from "@/lib/meetings/backgrounds";
import {
  createStructureScratch,
  createTemporalWindow,
  despeckleCoverage,
  fillEnclosedHoles,
  keepTouchingStructures,
  maskStructureReach,
  steadyCoverage,
  type StructureReach,
  type StructureScratch,
  type TemporalWindow,
} from "@/lib/meetings/mask-structure";

/**
 * How much smaller than the frame the blurred background is painted.
 *
 * Half, not less: at a 640px camera the light blur is only 5px, and a smaller
 * canvas leaves too little blur to hide its own upscaling.
 */
const BACKDROP_SCALE = 2;

/** A canvas, on either thread. */
export type Surface2D = HTMLCanvasElement | OffscreenCanvas;

/** A 2D context, on either thread. */
export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A surface and its context, which are always made and kept together. */
export interface Drawable {
  surface: Surface2D;
  ctx: Context2D;
}

/**
 * How the compositor gets a surface to draw on.
 *
 * The one piece of the environment it cannot abstract over, because the two
 * constructors have nothing in common: `document.createElement("canvas")` plus
 * `getContext` on the main thread, `new OffscreenCanvas(w, h)` in a worker.
 *
 * Returning null rather than throwing, because that is what `getContext` does
 * when a browser refuses one -- an exhausted GPU context pool, most often --
 * and the caller's answer to that is to fall back, not to catch.
 */
export type SurfaceFactory = (
  width: number,
  height: number,
  opts: { alpha: boolean },
) => Drawable | null;

/**
 * One frame to composite, and the size to composite it at.
 *
 * `CanvasImageSource` already spans both of the things this is ever handed: an
 * `HTMLVideoElement` on the main thread and a `VideoFrame` in a worker. The
 * dimensions come along separately because the two report their size under
 * different names (`videoWidth` against `displayWidth`) and neither is reliable
 * on the other.
 */
export interface CompositorFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * The model's output for one frame, already read off the GPU.
 *
 * Two shapes because the two mean different things, not because of a version
 * difference. Confidence is how sure the model is, which is what keeps headwear;
 * category is its thresholded verdict, which on a cap or a headwrap is usually
 * "not a person". The pinned build returns confidence; the category branch is
 * kept because a build that returned the other should degrade rather than show
 * nothing.
 */
export type MaskSample =
  | { kind: "confidence"; data: Float32Array; width: number; height: number }
  | { kind: "category"; data: Uint8Array; width: number; height: number };

/**
 * The masking chain, holding every buffer it reuses between frames.
 *
 * Stateful on purpose. Allocating the mask, the history, the agreement record
 * and two full-frame scratch surfaces per frame at 24fps is the difference
 * between a warm laptop and a loud one, and the history and agreement record
 * are the frame-to-frame memory that stops the edge crawling.
 */
export class MaskCompositor {
  /** What the caller reads out: the composited frame. */
  private readonly output: Drawable;
  /** The camera frame masked down to the person, before it goes over the
   *  background. A separate surface because `destination-in` destroys whatever
   *  else is on the one it runs on. */
  private readonly scratch: Drawable;
  /** The mask as a greyscale image, at grid resolution. */
  private readonly mask: Drawable;
  /** The frame the segmenter reads, at grid size. The model works at 256px
   *  whatever it is given, and a frame-sized input only meant a frame-sized
   *  mask to read back off the GPU -- 3.7MB of floats at 720p, 24 times a
   *  second -- to average down to the grid anyway. */
  private readonly segInput: Drawable;
  /** The mask softened at grid size, so the full-size upscale needs no filter. */
  private readonly feathered: Drawable;
  /** The blurred room, painted at half the frame's size and scaled up. A blur
   *  throws away exactly the detail the smaller surface cannot hold. */
  private readonly backdrop: Drawable;

  private maskImage: ImageData | null = null;
  /** Coverage carried between frames, so edges settle instead of shimmering. */
  private maskHistory: Uint8ClampedArray | null = null;
  /** Which pixels the model keeps contradicting itself about, which is what sets
   *  each pixel's blend rate. */
  private maskAgreement: MaskAgreement | null = null;
  /** This frame's coverage, before it is blended into the history. */
  private maskTarget: Uint8ClampedArray | null = null;
  /** What growth may claim, rebuilt from each frame's own coverage. */
  private dilateLimit: Uint8ClampedArray | null = null;
  /** The smoothed mask with its ramp tightened -- never the history itself. */
  private maskEdge: Uint8ClampedArray | null = null;

  /** The distance fields and flood-fill bookkeeping the shape passes read. */
  private structure: StructureScratch | null = null;
  /** The last two frames' coverage, so a one-frame excursion cannot reach anyone. */
  private steadyWindow: TemporalWindow | null = null;
  /** The previous frame's coverage as it left the chain, which is what lets the
   *  hole fill tell a dropout inside somebody from a gap that was never them. */
  private lastCoverage: Uint8ClampedArray | null = null;

  private gridSpec: MaskGrid;
  private dilateRadii: DilateRadii = { up: 1, down: 0, side: 1 };
  /** How wide an enclosed gap may be and still be quieted, in grid pixels. */
  private gapSpanReach = 1;
  /** How thick, how near and how small the shape passes ask things to be. */
  private structureReach: StructureReach = { thickness: 1, reach: 1, quiet: 2, hole: 1 };

  /** A painted template never changes, so it is painted once per size. */
  private templateCache: { key: string; drawable: Drawable } | null = null;

  private effect: BackgroundEffect = NO_BACKGROUND;
  private customImage: ImageBitmap | null = null;

  /** The size the frame being segmented had, for the composite that follows. */
  private width: number;
  private height: number;

  private constructor(
    private readonly makeSurface: SurfaceFactory,
    width: number,
    height: number,
    parts: {
      output: Drawable; scratch: Drawable; mask: Drawable;
      segInput: Drawable; feathered: Drawable; backdrop: Drawable;
    },
  ) {
    this.width = width;
    this.height = height;
    this.output = parts.output;
    this.scratch = parts.scratch;
    this.mask = parts.mask;
    this.segInput = parts.segInput;
    this.feathered = parts.feathered;
    this.backdrop = parts.backdrop;
    this.gridSpec = maskGrid(width, height);
    this.fit(width, height);
  }

  /**
   * Build the chain, or report that this environment cannot run it.
   *
   * Null rather than a throw for the same reason the factory returns null: on
   * the worker route the answer to "no context" is to composite on the main
   * thread instead, which is a decision, not an exception.
   */
  static create(makeSurface: SurfaceFactory, width: number, height: number): MaskCompositor | null {
    // Alpha off where nothing is composited THROUGH the surface. The output and
    // the backdrop are always painted edge to edge, and an alpha channel on them
    // is a per-pixel cost and a chance of a transparent frame reaching the wire.
    const output = makeSurface(width, height, { alpha: false });
    const scratch = makeSurface(width, height, { alpha: true });
    const grid = maskGrid(width, height);
    const mask = makeSurface(grid.width, grid.height, { alpha: true });
    const segInput = makeSurface(grid.width, grid.height, { alpha: false });
    const feathered = makeSurface(grid.width, grid.height, { alpha: true });
    const backdrop = makeSurface(
      Math.max(1, Math.round(width / BACKDROP_SCALE)),
      Math.max(1, Math.round(height / BACKDROP_SCALE)),
      { alpha: false },
    );
    if (!output || !scratch || !mask || !segInput || !feathered || !backdrop) return null;
    return new MaskCompositor(makeSurface, width, height, {
      output, scratch, mask, segInput, feathered, backdrop,
    });
  }

  /** The composited frame: a canvas to capture on the main thread, an
   *  OffscreenCanvas to build a VideoFrame from in a worker. */
  get surface(): Surface2D {
    return this.output.surface;
  }

  /** The grid the mask is carried at, which the caller needs to size nothing --
   *  it is exposed for tests and telemetry. */
  get grid(): MaskGrid {
    return this.gridSpec;
  }

  /**
   * Change what is drawn behind the person.
   *
   * The image is an `ImageBitmap` rather than an `HTMLImageElement` because a
   * worker has no `Image` and no `decode()`. `createImageBitmap` exists on both
   * threads, so the caller decodes and hands the result over.
   *
   * Ownership comes with it UNCONDITIONALLY, including when the effect cannot
   * use it. A decode is slow enough that the choice behind it can be stale by
   * the time it lands -- somebody uploads a picture and switches to blur while
   * it is still decoding -- and a bitmap handed in and quietly dropped on the
   * floor keeps its decoded pixels until the collector happens to notice. So
   * anything this cannot keep, it closes. Saying "I own what you give me" only
   * on the branch that keeps it is a contract nobody can call correctly, and the
   * worker will be handing bitmaps across `postMessage` where the sender has no
   * reference left to close.
   */
  setEffect(effect: BackgroundEffect, image?: ImageBitmap | null): void {
    this.effect = effect;
    if (effect.kind !== "custom") {
      this.releaseCustomImage();
      if (image) closeBitmap(image);
      return;
    }
    if (image) {
      this.releaseCustomImage();
      this.customImage = image;
    }
  }

  /**
   * Forget the frame-to-frame memory.
   *
   * Called when the effect pauses, so a resumed effect starts from the live mask
   * rather than blending out of wherever the person was standing when it
   * stopped. The reversal record goes with it: kept, it would damp the first
   * frames back on the strength of a flicker from before the pause.
   */
  reset(): void {
    this.maskHistory = null;
    this.maskAgreement = null;
    // The three-frame window goes too. Kept, it would hold up the first frames
    // back against two frames from before the pause — which for somebody who
    // turned the effect off and on again is their own face arriving late.
    this.steadyWindow = null;
    // And the hole fill's memory: what was covered before the pause says nothing
    // about what is a dropout after it, and a hold count carried across would
    // refuse to bridge the first real one.
    this.lastCoverage = null;
    this.structure?.held.fill(0);
  }

  /**
   * Draw the frame with no mask: either as it is, or out of focus.
   *
   * What to show while the segmenter is still a 12MB download, and on a frame the
   * model gave nothing back for. A black frame is not an option -- in a call it is
   * video nobody can see, and in the green room it is somebody deciding their
   * camera is broken.
   *
   * But an UNPROCESSED frame is not an option either, when the whole reason the
   * effect is on is that this room should not be in this call. That is what this
   * used to do, and for the few seconds the runtime takes to arrive, plus every
   * frame the segmenter returns nothing for, the sharp room went out on the wire.
   * Somebody who chose a background did not choose that.
   *
   * So with an effect on, the room goes out of focus. It costs a blur of a
   * quarter-size surface, needs no model and no artwork, keeps a moving person on
   * screen, and makes what is behind them unreadable. With no effect on, the
   * camera is drawn exactly as before.
   */
  passThrough(frame: CompositorFrame): void {
    this.follow(frame);
    if (needsSegmentation(this.effect) && this.drawVeiledRoom(this.width, this.height, frame)) return;
    this.output.ctx.drawImage(frame.source, 0, 0, this.width, this.height);
  }

  /**
   * Draw the frame at grid size for the segmenter to read, and return it.
   *
   * Separate from `compose` because the model runs between the two, and because
   * it is the point at which a camera that changed shape is followed -- so the
   * mask that comes back is measured against the size it was taken at.
   */
  prepareSegmentInput(frame: CompositorFrame): Surface2D {
    this.follow(frame);
    const { width, height } = this.gridSpec;
    this.segInput.ctx.drawImage(frame.source, 0, 0, width, height);
    return this.segInput.surface;
  }

  /**
   * Paint the background, then the person on top of it.
   *
   * The order matters and the alternative is tempting: it looks natural to draw
   * the camera frame and erase the background out of it. But that leaves a hard
   * edge wherever the mask is uncertain -- around hair, most visibly. Painting
   * the background first and compositing the person over it keeps the seam
   * inside the person's silhouette, where it reads as softness rather than a
   * cut-out.
   *
   * The mask is treated as an image rather than as a loop over pixels. That is
   * what lets the compositor blur it -- a hard mask cuts hair off in a staircase
   * of whole pixels, and a feathered one lets the edge fall off the way an
   * out-of-focus background does. It is also faster than reading back and
   * rewriting every pixel of a 720p frame.
   *
   * Composites at the size the last `prepareSegmentInput` saw, not at the size
   * of the frame handed in here, because the mask was measured against that one.
   * So a caller must not start a second frame through `prepareSegmentInput`
   * before the first one's mask has reached `compose`: on a camera that changed
   * shape in between, the mask and the frame would disagree. Both callers
   * satisfy that by construction -- one frame is in flight at a time -- and it is
   * written down because nothing here enforces it.
   */
  compose(frame: CompositorFrame, sample: MaskSample): void {
    const grid = this.gridSpec;
    const width = this.width;
    const height = this.height;
    const target = this.maskTarget;
    if (!target) return;

    // Masks come back at the size of what was segmented -- the grid-sized input
    // -- but their own dimensions are the ones to trust.
    const sampleWidth = sample.width > 0 ? sample.width : grid.width;
    const sampleHeight = sample.height > 0 ? sample.height : grid.height;
    if (sample.kind === "confidence") {
      sampleCoverageFromConfidence(target, sample.data, sampleWidth, sampleHeight, grid);
    } else {
      sampleCoverageFromCategory(target, sample.data, sampleWidth, sampleHeight, grid);
    }

    // Take out the cells that disagree with everything around them, before
    // anything else reads the map.
    //
    // First, because every rule after this one is more accurate on a map without
    // speckle in it: the gap quieting counts empty cells, the hole fill looks for
    // enclosure, and the structure pass measures thickness — all three are thrown
    // off by a pinhole that was never really there. Measured over sixty frames of
    // a person leaning across a 1280x720 frame, this takes stray islands from 15.4
    // a frame to 2.8 and pinholes from 96.1 to 19.9, with the edge no further
    // behind the person than before.
    if (!this.structure || this.structure.visited.length !== target.length) {
      this.structure = createStructureScratch(target.length);
    }
    despeckleCoverage(target, grid.width, grid.height, this.structure);

    // Quiet the room between two people sitting close, BEFORE the ceiling below
    // is built from this buffer.
    //
    // The mask is an alpha channel and the composite is `destination-in`, so it
    // keeps the camera frame WHERE THE MASK COVERS. Coverage wandering in the low
    // tens across the gap between two colleagues is therefore a faint,
    // shimmering, sharp strip of their real room reaching the outgoing track
    // while they have a background effect switched on. Holding that tail at zero
    // stops the wander and shows the effect there instead.
    //
    // Before the ceiling, because the ceiling is built from this buffer and
    // records which cells growth may later fill. Quieting first means those cells
    // are closed to growth as well, so nothing puts the strip back.
    //
    // Runs on the category path too. That mask is a bare yes/no with no
    // uncertainty band, so there is usually nothing under the ceiling for this to
    // find -- but a build that returned graded values through that path should
    // not quietly start leaking.
    quietCoverageGaps(target, grid.width, grid.height, this.gapSpanReach);

    // Then the two questions about SHAPE, which no per-pixel rule can answer:
    // what is inside the person, and what are they touching.
    //
    // Both before the ceiling, for the same reason the gap quieting is: the
    // ceiling records which cells growth may later fill, so a cell closed here
    // stays closed, and a cell filled here can be grown from like any other part
    // of the person.
    //
    // Holes first. A hole is a region ENCLOSED by the person, and
    // `keepTouchingStructures` can turn a chair into part of the person — which
    // would make the slot between a shoulder and a chair back "enclosed" and
    // invite the fill to open it. Measuring enclosure against the person alone,
    // before the chair joins them, keeps that decision honest.
    //
    // Both are inert on the category path in different ways: a 0-or-255 mask has
    // no uncertainty band for `keepTouchingStructures` to work in, but it can
    // certainly have holes, so the fill runs on both.
    //
    // The previous frame's coverage goes in with it. A patch of a dark jacket the
    // model drops for a frame or three is wider than the fill's span cap, and the
    // cap is right to refuse it on size alone -- a slot between two people is the
    // same shape. What tells them apart is that the jacket was covered a frame
    // ago, so the fill bridges it for a bounded few frames and leaves the slot,
    // which never was, alone. See `HOLE_HOLD_FRAMES`.
    const previous = this.lastCoverage && this.lastCoverage.length === target.length ? this.lastCoverage : null;
    fillEnclosedHoles(target, grid.width, grid.height, this.structureReach.hole, this.structure, previous);
    keepTouchingStructures(target, grid.width, grid.height, this.structureReach, this.structure);

    // Grow it, upward mostly, and only into pixels the model was unsure about.
    //
    // Two separate things stop this becoming the halo it used to be. The radii
    // are directional, because a head covering sits ABOVE a head and growth
    // sideways or downward only hangs room off somebody's arms and desk. And the
    // ceiling forbids growth from inventing coverage where the model was
    // confident there is none -- so the fabric of a headwrap fills in and the
    // wall behind a shoulder does not.
    //
    // The ceiling is only meaningful on the graded path. A category mask is 0 or
    // 255 with no uncertainty band, so constraining growth there would grow
    // nothing and hand back the missing headwear this exists to keep.
    let limit: Uint8ClampedArray | null = null;
    if (sample.kind === "confidence") {
      if (!this.dilateLimit || this.dilateLimit.length !== target.length) {
        this.dilateLimit = new Uint8ClampedArray(target.length);
      }
      limit = dilateCeiling(this.dilateLimit, target);
    }
    dilateCoverage(target, grid.width, grid.height, this.dilateRadii, limit);

    // And take out the cells that disagree with their own recent past.
    //
    // After every spatial decision and before the blend, so what the blend
    // smooths is a frame the model held for more than an instant. The two medians
    // are not alternatives: one answers "nothing around here agrees with you", the
    // other "you did not think this a moment ago", and the measured run needs both
    // — stray islands 2.8 -> 0.4 a frame, pinholes 19.9 -> 4.1, mean frame-to-frame
    // movement 1.13 -> 0.88 of 255 in cells where nothing actually moved, and the
    // edge CLOSER to the person (1.2 cells behind to 0.4) because the blend is no
    // longer being fed noise to damp.
    //
    // Three frames, measured against five: the wider window was worse on both
    // counts that matter, 0.97 movement and 1.4 cells of lag, because two frames of
    // latency is enough to be a person arriving late in their own mask.
    if (!this.steadyWindow || this.steadyWindow.recent.length !== target.length) {
      this.steadyWindow = createTemporalWindow(target.length);
    }
    steadyCoverage(target, this.steadyWindow);

    // Remembered as it leaves the chain -- after the median, so what the next
    // frame's hole fill compares against is what this frame actually settled on.
    if (!this.lastCoverage || this.lastCoverage.length !== target.length) {
      this.lastCoverage = new Uint8ClampedArray(target);
    } else {
      this.lastCoverage.set(target);
    }

    const ctx = this.output.ctx;
    ctx.save();
    ctx.filter = "none";
    this.paintBackground(frame, width, height);
    ctx.restore();

    // Carry coverage between frames. Segmentation flickers along the edge, and
    // an unsmoothed mask makes that flicker crawl visibly around the head.
    if (!this.maskHistory || this.maskHistory.length !== target.length) {
      // Seeded from the first mask rather than from zero, so the person does not
      // fade in over the opening frames.
      this.maskHistory = new Uint8ClampedArray(target);
      this.maskAgreement = createMaskAgreement(target.length);
    } else {
      if (!this.maskAgreement || this.maskAgreement.previousTarget.length !== target.length) {
        this.maskAgreement = createMaskAgreement(target.length);
      }
      blendCoverageByAgreement(this.maskHistory, target, this.maskAgreement);
    }

    const maskCtx = this.mask.ctx;
    if (!this.maskImage || this.maskImage.width !== grid.width || this.maskImage.height !== grid.height) {
      this.maskImage = maskCtx.createImageData(grid.width, grid.height);
    }
    // Tighten the ramp on the way out, into a separate buffer. The blend's
    // history must keep its graded values: sharpening it would compound frame on
    // frame until the mask was binary, and the smoothing above would be running
    // with nothing left to smooth.
    if (!this.maskEdge || this.maskEdge.length !== this.maskHistory.length) {
      this.maskEdge = new Uint8ClampedArray(this.maskHistory.length);
    }
    const edge = sharpenEdge(this.maskEdge, this.maskHistory);

    const maskPixels = this.maskImage.data;
    for (let i = 0, p = 3; i < edge.length; i++, p += 4) maskPixels[p] = edge[i];
    maskCtx.putImageData(this.maskImage, 0, 0);

    // Softened at grid size, where the blur touches a fraction of the pixels it
    // would at full frame, by the same distance measured in frame pixels.
    const featheredCtx = this.feathered.ctx;
    featheredCtx.save();
    featheredCtx.clearRect(0, 0, grid.width, grid.height);
    featheredCtx.filter = `blur(${maskFeatherPx(width) / grid.scale}px)`;
    featheredCtx.drawImage(this.mask.surface, 0, 0);
    featheredCtx.restore();

    // The camera frame, kept only where the mask covers. The mask is softened
    // and then scaled up from the grid; between them the edge arrives softened
    // twice, which is what stops a widened silhouette reading as a cut-out with
    // a wider outline.
    const scratchCtx = this.scratch.ctx;
    scratchCtx.save();
    scratchCtx.globalCompositeOperation = "source-over";
    scratchCtx.clearRect(0, 0, width, height);
    scratchCtx.drawImage(frame.source, 0, 0, width, height);
    scratchCtx.globalCompositeOperation = "destination-in";
    scratchCtx.drawImage(this.feathered.surface, 0, 0, width, height);
    scratchCtx.restore();

    ctx.drawImage(this.scratch.surface, 0, 0, width, height);
  }

  /** Release the surfaces' claim on GPU memory and the decoded custom image. */
  destroy(): void {
    this.releaseCustomImage();
    this.templateCache = null;
    this.maskImage = null;
    this.maskHistory = null;
    this.maskAgreement = null;
    this.maskTarget = null;
    this.dilateLimit = null;
    this.maskEdge = null;
    this.structure = null;
    this.steadyWindow = null;
    this.lastCoverage = null;
  }

  /**
   * Follow a camera that changed shape.
   *
   * A device switch or a phone being rotated changes the frame's dimensions
   * underneath the whole chain, and every buffer here is sized to the grid that
   * came from the old ones. Left unfollowed the composite stretches.
   */
  private follow(frame: CompositorFrame): void {
    if (!frame.width || !frame.height) return;
    if (frame.width === this.width && frame.height === this.height) return;
    this.width = frame.width;
    this.height = frame.height;
    this.output.surface.width = frame.width;
    this.output.surface.height = frame.height;
    this.scratch.surface.width = frame.width;
    this.scratch.surface.height = frame.height;
    this.gridSpec = maskGrid(frame.width, frame.height);
    this.fit(frame.width, frame.height);
  }

  /** Re-size every grid-derived buffer to the current frame, and drop the
   *  frame-to-frame memory that was measured against the old one. */
  private fit(frameWidth: number, frameHeight: number): void {
    const grid = this.gridSpec;
    this.dilateRadii = maskDilatePx(frameWidth, grid);
    this.gapSpanReach = maskGapSpanPx(frameWidth, grid);
    this.structureReach = maskStructureReach(frameWidth, grid);
    this.mask.surface.width = grid.width;
    this.mask.surface.height = grid.height;
    this.segInput.surface.width = grid.width;
    this.segInput.surface.height = grid.height;
    this.feathered.surface.width = grid.width;
    this.feathered.surface.height = grid.height;
    this.backdrop.surface.width = Math.max(1, Math.round(frameWidth / BACKDROP_SCALE));
    this.backdrop.surface.height = Math.max(1, Math.round(frameHeight / BACKDROP_SCALE));
    this.templateCache = null;
    this.maskTarget = new Uint8ClampedArray(grid.width * grid.height);
    this.maskImage = null;
    this.maskHistory = null;
    this.maskAgreement = null;
    this.dilateLimit = null;
    this.maskEdge = null;
    this.structure = null;
    this.steadyWindow = null;
    this.lastCoverage = null;
  }

  private paintBackground(frame: CompositorFrame, width: number, height: number): void {
    const ctx = this.output.ctx;
    const effect = this.effect;

    if (effect.kind === "blur") {
      this.drawVeiledRoom(width, height, frame, effect.strength);
      return;
    }

    if (effect.kind === "template") {
      const template = templateById(effect.id);
      if (template) {
        const painted = this.templateSurface(template, width, height);
        if (painted) { ctx.drawImage(painted, 0, 0); return; }
      }
    }

    if (effect.kind === "custom" && this.customImage) {
      drawCover(ctx, this.customImage, width, height);
      return;
    }

    // An effect whose artwork has not arrived yet, or has gone. Never a blank
    // rectangle where a person was -- and no longer the sharp room either, which
    // is the one thing somebody who turned this on asked not to send. The room
    // out of focus needs no artwork and is available on every frame.
    if (this.drawVeiledRoom(width, height, frame)) return;
    ctx.drawImage(frame.source, 0, 0, width, height);
  }

  /**
   * The room itself, out of focus, onto the output surface.
   *
   * Drawn from the camera rather than from a colour, because this IS the room --
   * that is what a blur background is. Blurred on a quarter-size surface and
   * scaled up: the same radius measured in frame pixels, over a sixteenth of the
   * pixels.
   *
   * Heavy by default. Where this stands in for an effect that cannot be applied,
   * the only job is that what is behind the person cannot be read, and the lighter
   * radius leaves a room recognisable.
   *
   * Returns false when there is no backdrop surface to draw on, so a caller can
   * fall back rather than leave the frame holding the previous one.
   */
  private drawVeiledRoom(
    width: number,
    height: number,
    frame: CompositorFrame,
    strength: BlurStrength = "heavy",
  ): boolean {
    const { surface, ctx: backdropCtx } = this.backdrop;
    const bw = surface.width;
    const bh = surface.height;
    if (!(bw > 0) || !(bh > 0) || !(width > 0)) return false;
    const radius = blurRadiusPx(strength, width) * (bw / width);
    backdropCtx.save();
    backdropCtx.filter = `blur(${radius}px)`;
    // Slightly overdrawn: a blur samples past the edge of its source and would
    // otherwise leave a pale border around the whole frame.
    const bleed = radius * 2;
    backdropCtx.drawImage(frame.source, -bleed, -bleed, bw + bleed * 2, bh + bleed * 2);
    backdropCtx.restore();
    this.output.ctx.drawImage(surface, 0, 0, width, height);
    return true;
  }

  /** The template, painted once for this frame size and reused every frame. */
  private templateSurface(template: BackgroundTemplate, width: number, height: number): Surface2D | null {
    const key = `${template.id}:${width}x${height}`;
    if (this.templateCache?.key === key) return this.templateCache.drawable.surface;
    const drawable = this.templateCache?.drawable ?? this.makeSurface(width, height, { alpha: false });
    if (!drawable) return null;
    drawable.surface.width = width;
    drawable.surface.height = height;
    paintTemplate(drawable.ctx, template, width, height);
    this.templateCache = { key, drawable };
    return drawable.surface;
  }

  private releaseCustomImage(): void {
    if (this.customImage) closeBitmap(this.customImage);
    this.customImage = null;
  }
}

// ── Painting ─────────────────────────────────────────────────────────────────

/**
 * Hand a bitmap's decoded pixels back, without caring whether it is already gone.
 *
 * `close()` on a closed bitmap is harmless in the browsers, but a transferred or
 * detached one can throw, and a throw here would abandon the rest of an effect
 * change half-applied.
 */
function closeBitmap(image: ImageBitmap): void {
  try { image.close(); } catch { /* already closed, or detached by a transfer */ }
}

/** Draw an image to fill the frame without distorting it -- CSS `object-fit: cover`. */
function drawCover(ctx: Context2D, image: ImageBitmap, width: number, height: number): void {
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/**
 * Render a native template from its spec.
 *
 * Painted rather than loaded from an image file: the specs come from the same
 * tokens as the rest of the product, they are sharp at any camera resolution,
 * and they add no binary assets to a repository that already has 12MB of
 * WebAssembly to move around.
 */
export function paintTemplate(
  ctx: Context2D,
  template: BackgroundTemplate,
  width: number,
  height: number,
): void {
  const gradient = ctx.createLinearGradient(
    template.from[0] * width, template.from[1] * height,
    template.to[0] * width, template.to[1] * height,
  );
  for (const stop of template.stops) gradient.addColorStop(stop.at, stop.color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  if (template.overlay === "grid") {
    // A data-terminal rule grid, at the edge of visible. Anything stronger
    // competes with the face for attention, which is the one thing a meeting
    // background must not do.
    ctx.strokeStyle = "rgba(148, 180, 240, 0.10)";
    ctx.lineWidth = Math.max(1, width / 1280);
    const step = Math.round(width / 18);
    ctx.beginPath();
    for (let x = step; x < width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = step; y < height; y += step) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
  } else if (template.overlay === "glow") {
    const glow = ctx.createRadialGradient(
      width * 0.78, height * 0.22, 0,
      width * 0.78, height * 0.22, Math.max(width, height) * 0.55,
    );
    glow.addColorStop(0, "rgba(37, 99, 235, 0.35)");
    glow.addColorStop(1, "rgba(37, 99, 235, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  } else if (template.overlay === "horizon") {
    const band = ctx.createLinearGradient(0, height * 0.55, 0, height * 0.72);
    band.addColorStop(0, "rgba(245, 158, 11, 0)");
    band.addColorStop(0.5, "rgba(245, 158, 11, 0.22)");
    band.addColorStop(1, "rgba(245, 158, 11, 0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, height * 0.55, width, height * 0.17);
  }
  ctx.restore();
}

/**
 * A surface factory for the main thread.
 *
 * Here rather than in `background-processor.ts` so the worker's factory and this
 * one sit side by side, which is the only way to see that they agree.
 */
export function documentSurfaceFactory(): SurfaceFactory {
  return (width, height, opts) => {
    const surface = document.createElement("canvas");
    surface.width = width;
    surface.height = height;
    // Never `willReadFrequently`: nothing reads any of these back. The flag
    // would keep them on the CPU and cost an upload every time one was drawn.
    const ctx = surface.getContext("2d", { alpha: opts.alpha });
    if (!ctx) return null;
    return { surface, ctx };
  };
}

/**
 * A surface factory for a worker.
 *
 * The whole reason the factory exists: a worker has no `document`, and this is
 * the only line in the chain that would have needed one.
 */
export function offscreenSurfaceFactory(): SurfaceFactory {
  return (width, height, opts) => {
    const surface = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    const ctx = surface.getContext("2d", { alpha: opts.alpha });
    if (!ctx) return null;
    return { surface, ctx };
  };
}
