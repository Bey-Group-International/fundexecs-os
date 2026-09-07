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
  blendMask,
  blurRadiusPx,
  maskFeatherPx,
  needsSegmentation,
  personCoverage,
  templateById,
  type BackgroundEffect,
  type BackgroundTemplate,
} from "@/lib/meetings/backgrounds";

const WASM_PATH = "/mediapipe";
const MODEL_PATH = "/mediapipe/selfie_segmenter.tflite";

/** The frame rate the composited track is captured at. */
const OUTPUT_FPS = 24;

type Segmenter = {
  segmentForVideo: (
    video: HTMLVideoElement,
    timestampMs: number,
    callback: (result: { categoryMask?: { getAsUint8Array: () => Uint8Array; close: () => void } }) => void,
  ) => void;
  close: () => void;
};

let segmenterPromise: Promise<Segmenter | null> | null = null;

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
        outputCategoryMask: true,
        outputConfidenceMasks: false,
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

/** Whether the machine could run effects at all, without committing to one. */
export async function backgroundsSupported(): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  if (typeof canvas.captureStream !== "function") return false;
  return (await loadSegmenter()) !== null;
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
  /** The mask, as a greyscale image the compositor can blur and mask with. */
  private mask: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private maskImage: ImageData | null = null;
  /** Coverage carried between frames, so edges settle instead of shimmering. */
  private maskHistory: Uint8ClampedArray | null = null;
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
  ) {
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

    const mask = document.createElement("canvas");
    mask.width = width;
    mask.height = height;
    // `willReadFrequently` because putImageData runs on this every frame.
    const maskCtx = mask.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!maskCtx) return null;

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

    return new BackgroundProcessor(video, canvas, ctx, scratch, scratchCtx, mask, maskCtx, stream, callbacks);
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
    if (this.running) return;
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
      this.mask.width = video.videoWidth;
      this.mask.height = video.videoHeight;
      // Both are sized to the old frame; they are rebuilt on the next composite.
      this.maskImage = null;
      this.maskHistory = null;
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

    this.segmenter.segmentForVideo(video, timestamp, (result) => {
      const mask = result.categoryMask;
      if (!mask) return;
      try {
        this.composite(mask.getAsUint8Array());
      } finally {
        mask.close();
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
  private composite(rawMask: Uint8Array): void {
    const { ctx, canvas, video, scratch, scratchCtx, maskCtx } = this;
    const { width, height } = canvas;

    ctx.save();
    ctx.filter = "none";
    this.paintBackground(ctx, width, height);
    ctx.restore();

    // Carry coverage between frames. Segmentation flickers along the edge, and
    // an unsmoothed mask makes that flicker crawl visibly around the head.
    if (!this.maskHistory || this.maskHistory.length !== rawMask.length) {
      this.maskHistory = new Uint8ClampedArray(rawMask.length);
      // Seeded from the first mask rather than from zero, so the person does not
      // fade in over the opening frames.
      for (let i = 0; i < rawMask.length; i++) this.maskHistory[i] = personCoverage(rawMask[i]);
    } else {
      blendMask(this.maskHistory, rawMask);
    }

    if (!this.maskImage || this.maskImage.width !== width || this.maskImage.height !== height) {
      this.maskImage = maskCtx.createImageData(width, height);
    }
    const maskPixels = this.maskImage.data;
    const history = this.maskHistory;
    const covered = Math.min(history.length, width * height);
    for (let i = 0, p = 3; i < covered; i++, p += 4) maskPixels[p] = history[i];
    maskCtx.putImageData(this.maskImage, 0, 0);

    // The camera frame, kept only where the mask covers. Drawing the mask
    // through a blur is what feathers the edge.
    scratchCtx.save();
    scratchCtx.globalCompositeOperation = "source-over";
    scratchCtx.clearRect(0, 0, width, height);
    scratchCtx.drawImage(video, 0, 0, width, height);
    scratchCtx.globalCompositeOperation = "destination-in";
    scratchCtx.filter = `blur(${maskFeatherPx(width)}px)`;
    scratchCtx.drawImage(this.mask, 0, 0, width, height);
    scratchCtx.restore();

    ctx.drawImage(scratch, 0, 0, width, height);
  }

  private paintBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const effect = this.effect;

    if (effect.kind === "blur") {
      // The room itself, out of focus — which is why this is drawn from the
      // camera rather than from a colour.
      ctx.filter = `blur(${blurRadiusPx(effect.strength, width)}px)`;
      // Slightly overdrawn: a blur samples past the edge of its source and
      // would otherwise leave a pale border around the whole frame.
      const bleed = blurRadiusPx(effect.strength, width) * 2;
      ctx.drawImage(this.video, -bleed, -bleed, width + bleed * 2, height + bleed * 2);
      ctx.filter = "none";
      return;
    }

    if (effect.kind === "template") {
      const template = templateById(effect.id);
      if (template) { paintTemplate(ctx, template, width, height); return; }
    }

    if (effect.kind === "custom" && this.customImage) {
      drawCover(ctx, this.customImage, width, height);
      return;
    }

    // An effect whose artwork has not arrived yet, or has gone. The camera is
    // the honest thing to show — never a blank rectangle where a person was.
    ctx.drawImage(this.video, 0, 0, width, height);
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
