// lib/office/backgroundEffect.ts
// Virtual-background processing for office video meetings. Takes the raw camera
// video track, runs on-device person segmentation (MediaPipe Selfie
// Segmentation — the same model Google Meet uses), and composites a blurred
// background behind the sharp foreground onto a canvas. The canvas is captured
// back into a MediaStreamTrack that transparently replaces the outgoing camera
// track, so both the local tile and remote peers see the effect.
//
// Everything runs in the browser, on-device — no frames leave the machine. The
// ~5MB model/wasm is loaded lazily only when the effect is switched on, and the
// whole pipeline is best-effort: any failure tears down cleanly and the caller
// falls back to the raw camera, so a meeting never breaks over a visual effect.

import type { Results, SelfieSegmentation } from "@mediapipe/selfie_segmentation";

/** Where the self-hosted MediaPipe assets live (copied by scripts/copy-mediapipe.mjs). */
const ASSET_BASE = "/mediapipe/selfie_segmentation";

/** How hard to blur the background, in CSS-filter pixels. */
const BLUR_PX = 12;

/**
 * Runs a live camera track through segmentation-based background blur and
 * exposes the processed track. Create one per enable; call stop() to dispose.
 */
export class BackgroundProcessor {
  private seg: SelfieSegmentation | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private running = false;
  private out: MediaStream | null = null;

  /**
   * Start processing `inputTrack` and return the processed video track. The raw
   * track keeps running (it feeds the pipeline) and must not be stopped by the
   * caller until stop() is called. Throws if segmentation can't initialize.
   */
  async start(inputTrack: MediaStreamTrack, fps = 24): Promise<MediaStreamTrack> {
    if (typeof window === "undefined") throw new Error("Background blur requires a browser.");

    const settings = inputTrack.getSettings();
    const width = settings.width ?? 640;
    const height = settings.height ?? 480;

    // Offscreen <video> playing the raw track — the segmentation input source.
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([inputTrack]);
    await video.play();
    this.video = video;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable.");
    this.canvas = canvas;
    this.ctx = ctx;

    // Lazy-load the model/wasm only now, self-hosted (no third-party CDN).
    const { SelfieSegmentation } = await import("@mediapipe/selfie_segmentation");
    const seg = new SelfieSegmentation({ locateFile: (file) => `${ASSET_BASE}/${file}` });
    seg.setOptions({ modelSelection: 1, selfieMode: true });
    seg.onResults((r) => this._composite(r));
    await seg.initialize();
    this.seg = seg;

    this.running = true;
    const frameMs = 1000 / fps;
    let last = 0;
    const loop = async (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (now - last < frameMs) return; // throttle to target fps
      last = now;
      const v = this.video;
      if (this.seg && v && v.readyState >= 2 && v.videoWidth > 0) {
        try {
          await this.seg.send({ image: v });
        } catch {
          /* transient send failure — skip this frame */
        }
      }
    };
    this.raf = requestAnimationFrame(loop);

    this.out = canvas.captureStream(fps);
    const track = this.out.getVideoTracks()[0];
    if (!track) throw new Error("Failed to capture processed stream.");
    return track;
  }

  /** Composite one segmentation result: sharp person over a blurred background. */
  private _composite(results: Results) {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    const { width: w, height: h } = canvas;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    // 1) Foreground silhouette: draw the mask, then keep only the person pixels.
    ctx.drawImage(results.segmentationMask, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(results.image, 0, 0, w, h);
    // 2) Background: draw a blurred copy of the frame behind the silhouette.
    ctx.globalCompositeOperation = "destination-over";
    ctx.filter = `blur(${BLUR_PX}px)`;
    ctx.drawImage(results.image, 0, 0, w, h);
    ctx.restore();
    ctx.filter = "none";
  }

  /** Tear everything down: stop the loop, processed track, video, and model. */
  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.out?.getTracks().forEach((t) => t.stop());
    this.out = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }
    // close() is async but we don't need to await disposal.
    void this.seg?.close().catch(() => {});
    this.seg = null;
    this.canvas = null;
    this.ctx = null;
  }
}

/**
 * Whether background blur can run here — needs a browser with canvas capture and
 * segmentation support. A cheap pre-check so the UI can disable the toggle
 * instead of failing on click. The real proof is a successful start().
 */
export function backgroundBlurSupported(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return typeof canvas.captureStream === "function";
}
