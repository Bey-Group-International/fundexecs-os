// lib/meetings/background-processor.ts
// Turning a camera track into a camera track with something else behind you.
//
// The shape of it: the raw camera feeds a hidden <video>, a segmenter marks
// which pixels are the person, and a <canvas> composites them over a blurred
// copy of the room, a painted template, or an uploaded image. The canvas is
// captured as a MediaStreamTrack, and that is what the peers and the local tile
// receive instead of the camera.
//
// Two decisions shape the rest of this file.
//
// The output track is created once and kept for the life of the processor. It
// would be simpler to build a fresh track per effect, but every peer holds a
// sender bound to that track, so changing effects would mean a replaceTrack on
// every connection in the call — renegotiation traffic and a visible hitch,
// every time somebody tries a different background. Instead the effect is a
// field this loop reads, and switching from blur to a template changes nothing
// the network can see.
//
// The segmenter is loaded on first use, not on mount. Its runtime is about
// 12MB. Nobody who never opens the background picker should pay for it, and
// nobody should pay for it while they are still deciding whether to join.
//
// The rules this consults — blur radii, template definitions, when an effect
// costs more than it is worth — are in backgrounds.ts, where they can be tested
// without a GPU.

import {
  FRAME_BUDGET_MS,
  NO_BACKGROUND,
  blendCoverage,
  blurRadiusPx,
  dilateCoverage,
  maskDilatePx,
  maskFeatherPx,
  maskGrid,
  needsSegmentation,
  dilateCeiling,
  sharpenEdge,
  OUTPUT_FPS,
  shouldDrawFrame,
  sampleCoverageFromCategory,
  sampleCoverageFromConfidence,
  templateById,
  type BackgroundEffect,
  type BackgroundTemplate,
  type DilateRadii,
  type MaskGrid,
} from "@/lib/meetings/backgrounds";

const WASM_PATH = "/mediapipe";
const MODEL_PATH = "/mediapipe/selfie_segmenter.tflite";

/** How much smaller than the frame the blurred background is painted. */
const BACKDROP_SCALE = 4;

/** A mask MediaPipe hands back, which must be closed once read. */
interface CategoryMask { width?: number; height?: number; getAsUint8Array: () => Uint8Array; close: () => void }
interface ConfidenceMask { width?: number; height?: number; getAsFloat32Array: () => Float32Array; close: () => void }
interface SegmentResult { categoryMask?: CategoryMask; confidenceMasks?: ConfidenceMask[] }

type Segmenter = {
  segmentForVideo: (
    frame: HTMLVideoElement | HTMLCanvasElement,
    timestampMs: number,
    callback: (result: SegmentResult) => void,
  ) => void;
  close: () => void;
};

let segmenterPromise: Promise<Segmenter | null> | null = null;

/** Processors alive on this page, and the pending release of the segmenter. */
let segmenterUsers = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * How long the segmenter outlives the last processor using it.
 *
 * Long enough to cover the green room handing over to the room, and a camera
 * being switched off and on — rebuilding it there would show the unprocessed
 * room to everyone for as long as it takes to load. Short enough that leaving a
 * meeting hands back its WebGL context and WASM heap.
 */
const SEGMENTER_IDLE_MS = 30_000;

function holdSegmenter(): void {
  segmenterUsers += 1;
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
}

function releaseSegmenter(): void {
  segmenterUsers = Math.max(0, segmenterUsers - 1);
  if (segmenterUsers > 0 || releaseTimer) return;
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (segmenterUsers > 0 || !segmenterPromise) return;
    const pending = segmenterPromise;
    segmenterPromise = null;
    void pending.then((s) => { try { s?.close(); } catch { /* already closed */ } });
  }, SEGMENTER_IDLE_MS);
}

/**
 * Load the segmenter, once per page.
 *
 * Cached as the promise rather than the result so two pickers opening at the
 * same moment share one 12MB download instead of racing for two.
 */
function loadSegmenter(): Promise<Segmenter | null> {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
      const segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        // Confidence only. It is what keeps headwear — it says how sure the
        // model is rather than what it decided, and a hat is exactly where it is
        // unsure. A category mask as well was a second GPU pass every frame for
        // a fallback the pinned build never takes; the compositor still reads
        // one if a build ever returns it instead.
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      return segmenter as unknown as Segmenter;
    } catch (err) {
      console.warn("[backgrounds] segmenter unavailable", err);
      // Cleared so a later attempt can retry — the usual cause is a transient
      // fetch failure, not a browser that will never support this.
      segmenterPromise = null;
      return null;
    }
  })();
  return segmenterPromise;
}

export interface ProcessorCallbacks {
  /** Sustained slow frames, so the caller can decide to suspend. */
  onSlowFrames: (consecutive: number) => void;
  /** The segmenter could not be loaded; the caller should fall back to none. */
  onUnavailable: () => void;
}

export class BackgroundProcessor {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Scratch buffers, reused every frame: allocating two canvases per frame at
   *  24fps is the difference between a warm laptop and a loud one. */
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;
  /** The mask, as a greyscale image the compositor can blur and mask with.
   *  Carried at grid resolution and upscaled by the compositor — see maskGrid. */
  private mask: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private maskImage: ImageData | null = null;
  /** The frame the segmenter reads, drawn at grid size. The model works at
   *  256px whatever it is given, and a frame-sized input only meant a
   *  frame-sized mask to read back off the GPU — 3.7MB of floats at 720p, 24
   *  times a second — to average down to the grid anyway. */
  private readonly segInput: HTMLCanvasElement;
  private readonly segInputCtx: CanvasRenderingContext2D;
  /** The mask softened at grid size, so the full-size upscale needs no filter. */
  private readonly feathered: HTMLCanvasElement;
  private readonly featheredCtx: CanvasRenderingContext2D;
  /** The blurred room, painted at a quarter of the frame and scaled up. A blur
   *  throws away exactly the detail the smaller canvas cannot hold. */
  private readonly backdrop: HTMLCanvasElement;
  private readonly backdropCtx: CanvasRenderingContext2D;
  /** A painted template never changes, so it is painted once per size. */
  private templateCache: { key: string; canvas: HTMLCanvasElement } | null = null;
  private destroyed = false;
  /** Coverage carried between frames, so edges settle instead of shimmering. */
  private maskHistory: Uint8ClampedArray | null = null;
  /** This frame's coverage, before it is blended into the history. */
  private maskTarget: Uint8ClampedArray | null = null;
  private grid: MaskGrid = maskGrid(640, 480);
  private dilateRadii: DilateRadii = { up: 1, down: 0, side: 1 };
  /** What growth may claim, rebuilt from each frame's own coverage. */
  private dilateLimit: Uint8ClampedArray | null = null;
  /** The smoothed mask with its ramp tightened — never the history itself. */
  private maskEdge: Uint8ClampedArray | null = null;
  private readonly outputTrack: MediaStreamTrack;
  private readonly stream: MediaStream;

  private effect: BackgroundEffect = NO_BACKGROUND;
  private customImage: HTMLImageElement | null = null;
  private customUrl: string | null = null;
  private segmenter: Segmenter | null = null;
  private running = false;
  private raf = 0;
  private slowFrames = 0;
  private lastTimestamp = -1;
  /** When the last composite actually ran, for pacing. Null before the first. */
  private lastDrawnAt: number | null = null;
  /** The camera this was built on has stopped. Nothing left to composite. */
  private sourceEnded = false;
  /** Detaches the `ended` listener on that camera. */
  private releaseSource: (() => void) | null = null;

  private constructor(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    scratch: HTMLCanvasElement,
    scratchCtx: CanvasRenderingContext2D,
    mask: HTMLCanvasElement,
    maskCtx: CanvasRenderingContext2D,
    stream: MediaStream,
    private readonly callbacks: ProcessorCallbacks,
    extra: {
      segInput: HTMLCanvasElement; segInputCtx: CanvasRenderingContext2D;
      feathered: HTMLCanvasElement; featheredCtx: CanvasRenderingContext2D;
      backdrop: HTMLCanvasElement; backdropCtx: CanvasRenderingContext2D;
    },
  ) {
    this.segInput = extra.segInput;
    this.segInputCtx = extra.segInputCtx;
    this.feathered = extra.feathered;
    this.featheredCtx = extra.featheredCtx;
    this.backdrop = extra.backdrop;
    this.backdropCtx = extra.backdropCtx;
    this.video = video;
    this.canvas = canvas;
    this.ctx = ctx;
    this.scratch = scratch;
    this.scratchCtx = scratchCtx;
    this.mask = mask;
    this.maskCtx = maskCtx;
    this.stream = stream;
    this.outputTrack = stream.getVideoTracks()[0];
  }

  static async create(source: MediaStreamTrack, callbacks: ProcessorCallbacks): Promise<BackgroundProcessor | null> {
    const settings = source.getSettings();
    const width = settings.width ?? 1280;
    const height = settings.height ?? 720;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx || typeof canvas.captureStream !== "function") return null;

    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const scratchCtx = scratch.getContext("2d", { alpha: true });
    if (!scratchCtx) return null;

    // Grid-sized, not frame-sized: the compositor upscales it, and every
    // per-pixel step below then costs a fraction of what it used to.
    const grid = maskGrid(width, height);
    const mask = document.createElement("canvas");
    mask.width = grid.width;
    mask.height = grid.height;
    // Not `willReadFrequently`: nothing reads this back. The flag would keep it
    // on the CPU and cost an upload every time the compositor drew it.
    const maskCtx = mask.getContext("2d", { alpha: true });
    if (!maskCtx) return null;

    const segInput = document.createElement("canvas");
    const segInputCtx = segInput.getContext("2d", { alpha: false });
    const feathered = document.createElement("canvas");
    const featheredCtx = feathered.getContext("2d", { alpha: true });
    const backdrop = document.createElement("canvas");
    const backdropCtx = backdrop.getContext("2d", { alpha: false });
    if (!segInputCtx || !featheredCtx || !backdropCtx) return null;

    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.srcObject = new MediaStream([source]);
    try {
      await video.play();
    } catch {
      // Autoplay of a muted, srcObject-backed element is permitted everywhere
      // this app runs; if it is refused there is nothing to composite.
      return null;
    }

    const stream = canvas.captureStream(OUTPUT_FPS);
    if (stream.getVideoTracks().length === 0) return null;

    const processor = new BackgroundProcessor(video, canvas, ctx, scratch, scratchCtx, mask, maskCtx, stream, callbacks, {
      segInput, segInputCtx, feathered, featheredCtx, backdrop, backdropCtx,
    });
    holdSegmenter();
    processor.resizeMask(width, height);
    processor.watchSource(source);
    return processor;
  }

  /**
   * Stop the moment the camera underneath does.
   *
   * A stopped track leaves the <video> holding its last frame with a readyState
   * that still says it has data, so the loop carries on segmenting one still
   * picture at 24fps — indefinitely, on the GPU, for a picture nobody will ever
   * see change. That happens on the ordinary path, not an exotic one: the green
   * room's preview processor outlives by a few hundred milliseconds the tracks
   * the room stops when it takes over, and a camera unplugged mid-call ends its
   * track while the effect is still running.
   *
   * Stopping rather than reporting: the room already watches the raw camera
   * track for `ended` and decides what to do about it. This only has to stop
   * burning frames.
   */
  private watchSource(source: MediaStreamTrack): void {
    if (source.readyState === "ended") { this.sourceEnded = true; return; }
    const onEnded = () => { this.sourceEnded = true; this.stop(); };
    source.addEventListener("ended", onEnded);
    this.releaseSource = () => { try { source.removeEventListener("ended", onEnded); } catch { /* gone */ } };
  }

  /** The track to send to peers in place of the camera. */
  get track(): MediaStreamTrack {
    return this.outputTrack;
  }

  /**
   * Change what is drawn behind the person.
   *
   * Deliberately not async for the caller's sake: the picker should feel
   * immediate. A custom image decodes in the background and the previous
   * background stays up until it is ready.
   */
  setEffect(effect: BackgroundEffect, image?: Blob | null): void {
    this.effect = effect;
    if (effect.kind !== "custom") {
      this.releaseCustomImage();
    } else if (image) {
      void this.loadCustomImage(image);
    }
    if (needsSegmentation(effect)) this.start();
    else this.stop();
  }

  private async loadCustomImage(blob: Blob): Promise<void> {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
      this.releaseCustomImage();
      this.customImage = img;
      this.customUrl = url;
    } catch {
      URL.revokeObjectURL(url);
    }
  }

  private releaseCustomImage(): void {
    if (this.customUrl) URL.revokeObjectURL(this.customUrl);
    this.customUrl = null;
    this.customImage = null;
  }

  private start(): void {
    if (this.running || this.sourceEnded) return;
    this.running = true;
    this.slowFrames = 0;

    // Draw from this moment, not from whenever the segmenter finishes loading.
    // The canvas is captured as a track the instant an effect is chosen, and on
    // first use the segmenter is a 12MB download behind it — so a loop that
    // waited would hand everyone a black rectangle for the length of that
    // download. In the call that is black video to every peer; in the green room
    // it is someone checking their camera and finding it dead.
    //
    // Until the segmenter arrives the loop paints the plain camera, which is
    // both honest and the thing they were already looking at.
    this.raf = requestAnimationFrame(this.tick);

    void (async () => {
      if (this.segmenter) return;
      const segmenter = await loadSegmenter();
      if (!segmenter) { this.stop(); this.callbacks.onUnavailable(); return; }
      if (this.running) this.segmenter = segmenter;
    })();
  }

  private stop(): void {
    this.running = false;
    // So a resumed effect draws immediately rather than waiting out an interval
    // measured from before it paused.
    this.lastDrawnAt = null;
    // Dropped so a resumed effect starts from the live mask rather than blending
    // out of wherever the person was standing when it paused.
    this.maskHistory = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.slowFrames = 0;
  }

  private tick = (): void => {
    if (!this.running) return;
    const started = performance.now();

    // requestAnimationFrame fires at the DISPLAY's refresh rate; the canvas this
    // draws into is captured at OUTPUT_FPS. Without this the segmentation, the
    // mask upscale, the putImageData and both blurs ran two to five times for
    // every frame anybody would ever see. Skipping is a cheap return, and the
    // animation frame is still what keeps the loop synced to compositing and
    // stopped while the tab is hidden.
    if (!shouldDrawFrame(this.lastDrawnAt, started, OUTPUT_FPS)) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    this.lastDrawnAt = started;

    try {
      this.drawFrame(started);
    } catch (err) {
      console.warn("[backgrounds] frame failed", err);
    }
    const cost = performance.now() - started;

    // Counted as a run rather than an average: one long frame is a garbage
    // collection pause, and a machine that is genuinely too slow produces them
    // continuously. backgrounds.ts owns how long a run has to be.
    if (cost > FRAME_BUDGET_MS) {
      this.slowFrames += 1;
      this.callbacks.onSlowFrames(this.slowFrames);
    } else if (this.slowFrames !== 0) {
      this.slowFrames = 0;
      this.callbacks.onSlowFrames(0);
    }

    if (this.running) this.raf = requestAnimationFrame(this.tick);
  };

  private drawFrame(now: number): void {
    const { video, canvas, ctx } = this;
    if (video.readyState < 2) return;

    // The camera can change shape underneath us — a device switch, or a phone
    // being rotated. Following it keeps the composite from stretching.
    if (video.videoWidth && video.videoHeight &&
        (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      this.scratch.width = video.videoWidth;
      this.scratch.height = video.videoHeight;
      this.resizeMask(video.videoWidth, video.videoHeight);
    }

    // Still waiting on the segmenter. Show the real camera rather than nothing —
    // the effect takes over the moment it can, and an unprocessed frame is a far
    // better thing to be sending than a black one.
    if (!this.segmenter) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return;
    }

    // MediaPipe rejects a timestamp that does not advance, which happens when
    // two animation frames land inside the same millisecond.
    const timestamp = now <= this.lastTimestamp ? this.lastTimestamp + 1 : now;
    this.lastTimestamp = timestamp;

    const { segInput, segInputCtx, grid } = this;
    segInputCtx.drawImage(video, 0, 0, grid.width, grid.height);
    this.segmenter.segmentForVideo(segInput, timestamp, (result) => {
      try {
        this.composite(result, canvas.width, canvas.height);
      } finally {
        // Every mask MediaPipe hands out owns GPU memory until it is closed.
        try { result.categoryMask?.close(); } catch { /* already closed */ }
        result.confidenceMasks?.forEach((m) => { try { m.close(); } catch { /* already closed */ } });
      }
    });
  }

  /**
   * Paint the background, then the person on top of it.
   *
   * The order matters and the alternative is tempting: it looks natural to draw
   * the camera frame and erase the background out of it. But that leaves a hard
   * edge wherever the mask is uncertain — around hair, most visibly. Painting
   * the background first and compositing the person over it keeps the seam
   * inside the person's silhouette, where it reads as softness rather than a
   * cut-out.
   *
   * The mask is treated as an image rather than as a loop over pixels. That is
   * what lets the compositor blur it — a hard mask cuts hair off in a staircase
   * of whole pixels, and a feathered one lets the edge fall off the way an
   * out-of-focus background does. It is also faster than reading back and
   * rewriting every pixel of a 720p frame.
   */
  private composite(result: SegmentResult, width: number, height: number): void {
    const { ctx, video, scratch, scratchCtx, maskCtx, grid } = this;

    const target = this.maskTarget;
    if (!target) return;

    // Confidence first. The category mask is the model's verdict — a yes or no
    // at some threshold it chose — and on a cap, a headwrap or a helmet that
    // verdict is usually "no". The confidence behind it is not zero, and reading
    // it is what keeps the top of someone's head attached to them.
    const confidence = result.confidenceMasks?.[0];
    let graded = false;
    // Masks come back at the size of what was segmented — the grid-sized input
    // — but their own dimensions are the ones to trust.
    if (confidence) {
      sampleCoverageFromConfidence(
        target, confidence.getAsFloat32Array(),
        confidence.width ?? grid.width, confidence.height ?? grid.height, grid,
      );
      graded = true;
    } else if (result.categoryMask) {
      const category = result.categoryMask;
      sampleCoverageFromCategory(
        target, category.getAsUint8Array(),
        category.width ?? grid.width, category.height ?? grid.height, grid,
      );
    } else {
      return;
    }

    // Grow it, upward mostly, and only into pixels the model was unsure about.
    //
    // Two separate things stop this becoming the halo it used to be. The radii
    // are directional, because a head covering sits ABOVE a head and growth
    // sideways or downward only hangs room off somebody's arms and desk. And the
    // ceiling forbids growth from inventing coverage where the model was
    // confident there is none — so the fabric of a headwrap fills in and the
    // wall behind a shoulder does not.
    //
    // The ceiling is only meaningful on the graded path. A category mask is 0 or
    // 255 with no uncertainty band, so constraining growth there would grow
    // nothing and hand back the missing headwear this exists to keep.
    let limit: Uint8ClampedArray | null = null;
    if (graded) {
      if (!this.dilateLimit || this.dilateLimit.length !== target.length) {
        this.dilateLimit = new Uint8ClampedArray(target.length);
      }
      limit = dilateCeiling(this.dilateLimit, target);
    }
    dilateCoverage(target, grid.width, grid.height, this.dilateRadii, limit);

    ctx.save();
    ctx.filter = "none";
    this.paintBackground(ctx, width, height);
    ctx.restore();

    // Carry coverage between frames. Segmentation flickers along the edge, and
    // an unsmoothed mask makes that flicker crawl visibly around the head.
    if (!this.maskHistory || this.maskHistory.length !== target.length) {
      // Seeded from the first mask rather than from zero, so the person does not
      // fade in over the opening frames.
      this.maskHistory = new Uint8ClampedArray(target);
    } else {
      blendCoverage(this.maskHistory, target);
    }

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
    const { feathered, featheredCtx } = this;
    featheredCtx.save();
    featheredCtx.clearRect(0, 0, grid.width, grid.height);
    featheredCtx.filter = `blur(${maskFeatherPx(width) / grid.scale}px)`;
    featheredCtx.drawImage(this.mask, 0, 0);
    featheredCtx.restore();

    // The camera frame, kept only where the mask covers. The mask is softened
    // and then scaled up from the grid; between them the edge arrives softened
    // twice, which is what stops a widened silhouette reading as a cut-out with
    // a wider outline.
    scratchCtx.save();
    scratchCtx.globalCompositeOperation = "source-over";
    scratchCtx.clearRect(0, 0, width, height);
    scratchCtx.drawImage(video, 0, 0, width, height);
    scratchCtx.globalCompositeOperation = "destination-in";
    scratchCtx.drawImage(feathered, 0, 0, width, height);
    scratchCtx.restore();

    ctx.drawImage(scratch, 0, 0, width, height);
  }

  /**
   * Re-fit the mask grid to a new frame size.
   *
   * The camera can change shape underneath us — a device switch, or a phone
   * being rotated — and every buffer here is sized to the grid that came from
   * the old one.
   */
  private resizeMask(frameWidth: number, frameHeight: number): void {
    this.grid = maskGrid(frameWidth, frameHeight);
    this.dilateRadii = maskDilatePx(frameWidth, this.grid);
    this.mask.width = this.grid.width;
    this.mask.height = this.grid.height;
    this.segInput.width = this.grid.width;
    this.segInput.height = this.grid.height;
    this.feathered.width = this.grid.width;
    this.feathered.height = this.grid.height;
    this.backdrop.width = Math.max(1, Math.round(frameWidth / BACKDROP_SCALE));
    this.backdrop.height = Math.max(1, Math.round(frameHeight / BACKDROP_SCALE));
    this.templateCache = null;
    this.maskTarget = new Uint8ClampedArray(this.grid.width * this.grid.height);
    this.maskImage = null;
    this.maskHistory = null;
    this.dilateLimit = null;
    this.maskEdge = null;
  }

  private paintBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const effect = this.effect;

    if (effect.kind === "blur") {
      // The room itself, out of focus — which is why this is drawn from the
      // camera rather than from a colour. Blurred small and scaled up: the same
      // radius in frame pixels, on a sixteenth of the pixels.
      const { backdrop, backdropCtx } = this;
      const bw = backdrop.width;
      const bh = backdrop.height;
      const radius = blurRadiusPx(effect.strength, width) * (bw / width);
      backdropCtx.save();
      backdropCtx.filter = `blur(${radius}px)`;
      // Slightly overdrawn: a blur samples past the edge of its source and
      // would otherwise leave a pale border around the whole frame.
      const bleed = radius * 2;
      backdropCtx.drawImage(this.video, -bleed, -bleed, bw + bleed * 2, bh + bleed * 2);
      backdropCtx.restore();
      ctx.drawImage(backdrop, 0, 0, width, height);
      return;
    }

    if (effect.kind === "template") {
      const template = templateById(effect.id);
      if (template) { ctx.drawImage(this.templateCanvas(template, width, height), 0, 0); return; }
    }

    if (effect.kind === "custom" && this.customImage) {
      drawCover(ctx, this.customImage, width, height);
      return;
    }

    // An effect whose artwork has not arrived yet, or has gone. The camera is
    // the honest thing to show — never a blank rectangle where a person was.
    ctx.drawImage(this.video, 0, 0, width, height);
  }

  /** The template, painted once for this frame size and reused every frame. */
  private templateCanvas(template: BackgroundTemplate, width: number, height: number): HTMLCanvasElement {
    const key = `${template.id}:${width}x${height}`;
    if (this.templateCache?.key === key) return this.templateCache.canvas;
    const canvas = this.templateCache?.canvas ?? document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (ctx) paintTemplate(ctx, template, width, height);
    this.templateCache = { key, canvas };
    return canvas;
  }

  /**
   * Stop drawing while the camera is off, and resume when it comes back.
   *
   * The output track is disabled in that state, so every frame it segments is
   * discarded — twenty-four times a second, for as long as someone leaves their
   * camera off. On a laptop that is a warm fan for nothing.
   */
  setPaused(paused: boolean): void {
    if (paused) { if (this.running) this.stop(); return; }
    if (needsSegmentation(this.effect)) this.start();
  }

  /** Release the camera tap, the loop and the output track. */
  destroy(): void {
    this.stop();
    if (!this.destroyed) { this.destroyed = true; releaseSegmenter(); }
    this.templateCache = null;
    this.releaseSource?.();
    this.releaseSource = null;
    this.releaseCustomImage();
    try { this.outputTrack.stop(); } catch { /* already stopped */ }
    this.stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
    try { this.video.pause(); } catch { /* already paused */ }
    this.video.srcObject = null;
  }
}

// ── Painting ─────────────────────────────────────────────────────────────────

/** Draw an image to fill the frame without distorting it — CSS `object-fit: cover`. */
function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number): void {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
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
  ctx: CanvasRenderingContext2D,
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
