// lib/meetings/background-processor.ts
// Turning a camera track into a camera track with something else behind you.
//
// The shape of it: the raw camera feeds a hidden <video>, a segmenter marks
// which pixels are the person, and a canvas composites them over a blurred copy
// of the room, a painted template, or an uploaded image. The canvas is captured
// as a MediaStreamTrack, and that is what the peers and the local tile receive
// instead of the camera.
//
// What is left here is the main thread's half of that: the <video>, the
// segmenter's lifetime, the animation-frame loop and its pacing, the output
// track, and noticing when the camera underneath stops. The per-frame chain
// itself -- sample, quiet, grow, blend, sharpen, feather, composite -- is in
// `mask-compositor.ts`, which knows nothing about which thread it is on, because
// the same chain has to run in a worker and nothing in a worker can call
// `document.createElement`. One implementation, so a mask fix cannot land on one
// thread and not the other.
//
// Two decisions shape the rest of this file.
//
// The output track is created once and kept for the life of the processor. It
// would be simpler to build a fresh track per effect, but every peer holds a
// sender bound to that track, so changing effects would mean a replaceTrack on
// every connection in the call — renegotiation traffic and a visible hitch,
// every time somebody tries a different background. Instead the effect is a
// field the compositor reads, and switching from blur to a template changes
// nothing the network can see.
//
// The segmenter is loaded on first use, not on mount. Its runtime is about
// 12MB. Nobody who never opens the background picker should pay for it, and
// nobody should pay for it while they are still deciding whether to join.
//
// The rules the chain consults — blur radii, template definitions, when an
// effect costs more than it is worth — are in backgrounds.ts, where they can be
// tested without a GPU.

import {
  FRAME_BUDGET_MS,
  NO_BACKGROUND,
  needsSegmentation,
  OUTPUT_FPS,
  shouldDrawFrame,
  type BackgroundEffect,
} from "@/lib/meetings/backgrounds";
import {
  MaskCompositor,
  documentSurfaceFactory,
  type CompositorFrame,
  type MaskSample,
} from "@/lib/meetings/mask-compositor";

const WASM_PATH = "/mediapipe";
const MODEL_PATH = "/mediapipe/selfie_segmenter.tflite";

/** A mask MediaPipe hands back, which must be closed once read. */
interface CategoryMask { width?: number; height?: number; getAsUint8Array: () => Uint8Array; close: () => void }
interface ConfidenceMask { width?: number; height?: number; getAsFloat32Array: () => Float32Array; close: () => void }
interface SegmentResult { categoryMask?: CategoryMask; confidenceMasks?: ConfidenceMask[] }

type Segmenter = {
  segmentForVideo: (
    frame: CanvasImageSource,
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
      const build = (delegate: "GPU" | "CPU") =>
        vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: "VIDEO",
          // Confidence only. It is what keeps headwear — it says how sure the
          // model is rather than what it decided, and a hat is exactly where it is
          // unsure. A category mask as well was a second GPU pass every frame for
          // a fallback the pinned build never takes; the compositor still reads
          // one if a build ever returns it instead.
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      // GPU first; CPU when the WebGL path refuses. Safari is where that
      // happens — an exhausted context pool, a WebGL build the runtime does
      // not accept — and the answer used to be "Background effects couldn't
      // load — your camera is off", for a member whose CPU could have run it.
      const segmenter = await build("GPU").catch(async (err) => {
        console.warn("[backgrounds] GPU segmenter unavailable, trying CPU", err);
        return build("CPU");
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

/**
 * Turn what MediaPipe handed back into the plain arrays the chain takes.
 *
 * Confidence first. The category mask is the model's verdict — a yes or no at
 * some threshold it chose — and on a cap, a headwrap or a helmet that verdict is
 * usually "no". The confidence behind it is not zero, and reading it is what
 * keeps the top of someone's head attached to them.
 *
 * `getAsFloat32Array` is the expensive line in the whole pipeline: a ~520KB
 * GPU-to-CPU copy, 24 times a second. It is called here, at the boundary, rather
 * than inside the chain, so that it can be timed as itself.
 */
export function readMaskSample(result: SegmentResult): MaskSample | null {
  const confidence = result.confidenceMasks?.[0];
  if (confidence) {
    return {
      kind: "confidence",
      data: confidence.getAsFloat32Array(),
      width: confidence.width ?? 0,
      height: confidence.height ?? 0,
    };
  }
  const category = result.categoryMask;
  if (category) {
    return {
      kind: "category",
      data: category.getAsUint8Array(),
      width: category.width ?? 0,
      height: category.height ?? 0,
    };
  }
  return null;
}

export interface ProcessorCallbacks {
  /** Sustained slow frames, so the caller can decide to suspend. */
  onSlowFrames: (consecutive: number) => void;
  /** The segmenter could not be loaded; the caller should fall back to none. */
  onUnavailable: () => void;
}

export class BackgroundProcessor {
  private readonly video: HTMLVideoElement;
  private readonly compositor: MaskCompositor;
  private readonly outputTrack: MediaStreamTrack;
  private readonly stream: MediaStream;

  private destroyed = false;
  private effect: BackgroundEffect = NO_BACKGROUND;
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
  /** The decode in flight, so a later choice cannot be overtaken by an earlier
   *  one that was slower to decode. */
  private customToken = 0;

  private constructor(
    video: HTMLVideoElement,
    compositor: MaskCompositor,
    stream: MediaStream,
    private readonly callbacks: ProcessorCallbacks,
  ) {
    this.video = video;
    this.compositor = compositor;
    this.stream = stream;
    this.outputTrack = stream.getVideoTracks()[0];
  }

  static async create(source: MediaStreamTrack, callbacks: ProcessorCallbacks): Promise<BackgroundProcessor | null> {
    const settings = source.getSettings();
    const width = settings.width ?? 1280;
    const height = settings.height ?? 720;

    const compositor = MaskCompositor.create(documentSurfaceFactory(), width, height);
    if (!compositor) return null;

    // The output surface is what gets captured as the track peers receive, so
    // this route needs the real `HTMLCanvasElement` behaviour rather than just a
    // thing that can be drawn on. Asked of the object rather than asserted about
    // it: `documentSurfaceFactory` makes canvases, but a browser without
    // `captureStream` would otherwise fail later, with a processor that composites
    // perfectly into a track nobody has.
    const surface = compositor.surface as HTMLCanvasElement;
    if (typeof surface.captureStream !== "function") { compositor.destroy(); return null; }

    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.srcObject = new MediaStream([source]);
    try {
      await video.play();
    } catch {
      // Autoplay of a muted, srcObject-backed element is permitted everywhere
      // this app runs; if it is refused there is nothing to composite.
      compositor.destroy();
      return null;
    }

    const stream = surface.captureStream(OUTPUT_FPS);
    if (stream.getVideoTracks().length === 0) { compositor.destroy(); return null; }

    const processor = new BackgroundProcessor(video, compositor, stream, callbacks);
    holdSegmenter();
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
    // Every new choice supersedes a decode still in flight, not just a later
    // custom one. Bumping the token only inside `loadCustomImage` left the
    // custom-then-blur case live: the stale decode passed its own check and
    // handed the compositor a bitmap for an effect that cannot use it.
    this.customToken += 1;
    this.compositor.setEffect(effect, null);
    if (effect.kind === "custom" && image) void this.loadCustomImage(image);
    if (needsSegmentation(effect)) this.start();
    else this.stop();
  }

  /**
   * Decode an uploaded background.
   *
   * `createImageBitmap` rather than an `<img>`: it is the one decode path that
   * exists in a worker too, so the compositor takes the same kind of object on
   * either thread.
   */
  private async loadCustomImage(blob: Blob): Promise<void> {
    const token = this.customToken;
    try {
      const bitmap = await createImageBitmap(blob);
      // A second choice made while this one was decoding has already won; this
      // bitmap would otherwise overwrite it with the older picture. The
      // compositor would close a bitmap it cannot use anyway -- this only keeps
      // a stale one from travelling that far.
      if (this.destroyed || token !== this.customToken) {
        try { bitmap.close(); } catch { /* already closed */ }
        return;
      }
      this.compositor.setEffect(this.effect, bitmap);
    } catch {
      // Undecodable artwork. The compositor falls through to the camera, which
      // is better than a blank rectangle where a person was.
    }
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
    this.compositor.reset();
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
    const { video, compositor } = this;
    if (video.readyState < 2) return;

    const frame: CompositorFrame = {
      source: video,
      width: video.videoWidth,
      height: video.videoHeight,
    };

    // Still waiting on the segmenter. Show the real camera rather than nothing —
    // the effect takes over the moment it can, and an unprocessed frame is a far
    // better thing to be sending than a black one.
    if (!this.segmenter) { compositor.passThrough(frame); return; }

    // MediaPipe rejects a timestamp that does not advance, which happens when
    // two animation frames land inside the same millisecond.
    const timestamp = now <= this.lastTimestamp ? this.lastTimestamp + 1 : now;
    this.lastTimestamp = timestamp;

    const input = compositor.prepareSegmentInput(frame);
    this.segmenter.segmentForVideo(input, timestamp, (result) => {
      try {
        const sample = readMaskSample(result);
        if (sample) compositor.compose(frame, sample);
      } finally {
        // Every mask MediaPipe hands out owns GPU memory until it is closed.
        try { result.categoryMask?.close(); } catch { /* already closed */ }
        result.confidenceMasks?.forEach((m) => { try { m.close(); } catch { /* already closed */ } });
      }
    });
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
    this.compositor.destroy();
    this.releaseSource?.();
    this.releaseSource = null;
    try { this.outputTrack.stop(); } catch { /* already stopped */ }
    this.stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
    try { this.video.pause(); } catch { /* already paused */ }
    this.video.srcObject = null;
  }
}
