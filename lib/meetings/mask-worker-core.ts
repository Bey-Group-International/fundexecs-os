// lib/meetings/mask-worker-core.ts
// The worker's per-frame loop, with nothing in it that needs a worker.
//
// The same trick as `mask-compositor.ts`: everything that can be decided
// without a `Worker`, a `VideoFrame` or a GPU lives here behind injected
// dependencies, so the untestable entry point in `mask-worker.ts` is a few
// lines of wiring rather than the place all the logic hides.
//
// It earns that, because this loop has a failure mode the compositor does not.
//
// A `VideoFrame` holds a slot in a small, fixed pool -- single digits in Chrome.
// Miss one `close()` and the pipeline does not throw or slow down: it delivers
// about four more frames and then stops, for good, with somebody's face frozen
// mid-sentence on every screen in the call. The same is true of the frames this
// creates on the way out, and of the mask handles MediaPipe returns. So closing
// is not a tidy-up here; it is the main correctness property, and it has to hold
// on the paths where something has already gone wrong -- a compose that threw, a
// segmenter that never called back, a frame that arrived after `stop`.
//
// Which is why the signatures below are deliberately small and structural: a
// test can hand this a frame that counts its own closes, and assert the thing
// that would otherwise only be discovered in a real call.

import type { CompositorFrame, MaskSample, Surface2D } from "@/lib/meetings/mask-compositor";
import {
  accumulateTiming,
  createTimingAccumulator,
  shouldReportStats,
  timingReport,
  type FrameTiming,
  type TimingAccumulator,
  type TimingReport,
} from "@/lib/meetings/mask-worker-protocol";

/**
 * As much of a `VideoFrame` as this loop touches.
 *
 * Structural rather than the DOM type so a test can supply one. The three
 * fields are the three things that must survive the round trip: the dimensions
 * the compositor sizes itself to, and the timestamp, which is what keeps the
 * outgoing track's timing honest -- a generator handed frames with invented
 * timestamps produces video that drifts against its own audio.
 */
export interface IncomingFrame {
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly timestamp: number;
  readonly duration?: number | null;
  close(): void;
}

/** What a composited frame is built with. */
export interface OutgoingFrameInit {
  timestamp: number;
  duration?: number;
}

/**
 * The compositor, as this loop uses it.
 *
 * Structural rather than `MaskCompositor` itself so a test can supply one that
 * records what it was asked to draw -- but written against the compositor's own
 * frame type, so the two cannot drift.
 */
export interface FrameCompositor {
  readonly surface: Surface2D;
  prepareSegmentInput(frame: CompositorFrame): Surface2D;
  compose(frame: CompositorFrame, sample: MaskSample): void;
  passThrough(frame: CompositorFrame): void;
}

/** The segmenter, as this loop uses it. */
export interface FrameSegmenter<TResult> {
  segmentForVideo(input: Surface2D, timestampMs: number, callback: (result: TResult) => void): void;
}

export interface FrameLoopDeps<TResult, TOut> {
  compositor: FrameCompositor;
  /** Null until the 12MB runtime has loaded. Frames still have to go out. */
  segmenter: FrameSegmenter<TResult> | null;
  /** The GPU-to-CPU readback. Separated so it can be timed as itself. */
  readMask: (result: TResult) => MaskSample | null;
  /** Hand the mask's GPU memory back. Must run even if reading threw. */
  closeMask: (result: TResult) => void;
  /** Build the outgoing frame from the compositor's surface. */
  makeFrame: (surface: Surface2D, init: OutgoingFrameInit) => TOut;
  /** Send it. Returns false if the sink is gone, so the frame can be closed. */
  deliver: (frame: TOut) => boolean;
  /** Release an outgoing frame the sink refused. */
  closeFrame: (frame: TOut) => void;
  now: () => number;
  onStats: (report: TimingReport) => void;
  /** Reported once per cause, not per frame: a broken loop at 24fps would
   *  otherwise post a thousand messages a minute. */
  onError: (reason: string) => void;
}

/**
 * Drive one camera frame through the chain and out.
 *
 * Stateful only in the three things that must persist between frames: the
 * segmenter's monotonic timestamp, the frame count the main thread's deadline
 * reads, and the timing totals.
 */
export class MaskFrameLoop<TResult, TOut> {
  private readonly deps: FrameLoopDeps<TResult, TOut>;
  private timing: TimingAccumulator = createTimingAccumulator();
  private delivered = 0;
  /** MediaPipe rejects a timestamp that does not advance, and two frames can
   *  carry the same one -- a camera that reports in milliseconds, or a
   *  synthetic track. */
  private lastTimestamp = -1;
  private stopped = false;
  /** Causes already reported, so a loop failing every frame says it once. */
  private readonly reported = new Set<string>();

  constructor(deps: FrameLoopDeps<TResult, TOut>) {
    this.deps = deps;
  }

  /**
   * Attach the segmenter once its runtime has arrived.
   *
   * The loop starts before it exists, on purpose: the runtime is a 12MB
   * download and the camera's frames are already flowing, so frames go out
   * unmasked until this lands rather than not at all. A setter rather than a
   * constructor argument because that ordering is the requirement, not an
   * accident of how the worker happens to be written.
   */
  setSegmenter(segmenter: FrameSegmenter<TResult> | null): void {
    this.deps.segmenter = segmenter;
  }

  /** Frames that reached the sink, which is what settles the first-frame deadline. */
  get framesDelivered(): number {
    return this.delivered;
  }

  /** Stop accepting frames. Any already in flight are still closed. */
  stop(): void {
    this.stopped = true;
  }

  /**
   * Composite one frame and deliver it.
   *
   * The incoming frame is closed before returning, on every path including the
   * ones where nothing could be drawn. Returns whether a frame reached the sink,
   * which the caller uses only for logging -- the count is the field above.
   */
  handle(frame: IncomingFrame): boolean {
    const d = this.deps;
    const started = d.now();
    let readbackMs = 0;
    let chainMs = 0;

    try {
      if (this.stopped) return false;

      const width = frame.displayWidth;
      const height = frame.displayHeight;
      if (!(width > 0) || !(height > 0)) return false;

      // The one cast in this file, and it is honest: a real `VideoFrame` is a
      // `CanvasImageSource`, which is exactly why the chain can draw it. The
      // narrower `IncomingFrame` above exists so a test can supply a frame that
      // counts its own closes, and nothing in a test ever gets drawn.
      const drawable: CompositorFrame = {
        source: frame as unknown as CanvasImageSource,
        width,
        height,
      };

      // No segmenter yet -- the 12MB runtime is still arriving. The plain camera
      // goes out rather than nothing: a black tile is video nobody can see, and
      // in the green room it is somebody deciding their camera is broken.
      if (!d.segmenter) {
        d.compositor.passThrough(drawable);
        return this.emit(frame, started, readbackMs, chainMs);
      }

      const timestampMs = this.nextTimestamp(frame.timestamp);
      const input = d.compositor.prepareSegmentInput(drawable);

      // Whether the callback ran at all. MediaPipe's VIDEO mode calls back
      // synchronously, and the compositor requires that -- it composites at the
      // size the last `prepareSegmentInput` saw. If a build ever stopped doing
      // it, this would otherwise deliver a frame composited against the previous
      // frame's mask, every frame, with nothing saying so.
      let masked = false;
      d.segmenter.segmentForVideo(input, timestampMs, (result) => {
        try {
          const beforeRead = d.now();
          const sample = d.readMask(result);
          readbackMs = d.now() - beforeRead;
          if (!sample) return;
          const beforeChain = d.now();
          d.compositor.compose(drawable, sample);
          chainMs = d.now() - beforeChain;
          masked = true;
        } finally {
          // Before anything else can throw: every mask MediaPipe hands out owns
          // GPU memory until it is closed.
          try { d.closeMask(result); } catch { /* already closed */ }
        }
      });

      // Either the callback did not run, or it read no mask. Both leave the
      // output surface holding the PREVIOUS frame, so it has to be repainted --
      // delivering it as-is would show a still picture that looks like a live
      // one.
      if (!masked) {
        this.report("no-mask");
        d.compositor.passThrough(drawable);
      }

      return this.emit(frame, started, readbackMs, chainMs);
    } catch (err) {
      this.report(`frame-failed: ${describe(err)}`);
      return false;
    } finally {
      // The one line this whole file is arranged around.
      try { frame.close(); } catch { /* already closed */ }
    }
  }

  /** Build the outgoing frame, deliver it, and fold in this frame's timing. */
  private emit(frame: IncomingFrame, started: number, readbackMs: number, chainMs: number): boolean {
    const d = this.deps;
    const init: OutgoingFrameInit = { timestamp: frame.timestamp };
    // Carried only when the camera gave one. A generator rejects a duration of
    // zero, and `null` is what a track with no duration reports.
    if (typeof frame.duration === "number" && frame.duration > 0) init.duration = frame.duration;

    let out: TOut;
    try {
      out = d.makeFrame(d.compositor.surface, init);
    } catch (err) {
      this.report(`frame-build-failed: ${describe(err)}`);
      return false;
    }

    let accepted = false;
    try {
      accepted = d.deliver(out);
    } catch (err) {
      this.report(`deliver-failed: ${describe(err)}`);
      accepted = false;
    }
    // A sink that refused it never took ownership, so this side still has to
    // close it -- the case that silently exhausts the pool when a call ends
    // while frames are in flight.
    if (!accepted) {
      try { d.closeFrame(out); } catch { /* already closed */ }
      return false;
    }

    this.delivered += 1;
    const timing: FrameTiming = { readbackMs, chainMs, totalMs: d.now() - started };
    accumulateTiming(this.timing, timing);
    if (shouldReportStats(this.timing.frames)) {
      d.onStats(timingReport(this.timing));
      // Reset so each report describes its own second rather than the whole
      // call: a machine that got into trouble five minutes in would otherwise
      // be averaged back out by every good frame before it.
      this.timing = createTimingAccumulator();
    }
    return true;
  }

  private nextTimestamp(frameTimestamp: number): number {
    const base = Number.isFinite(frameTimestamp) ? frameTimestamp : this.lastTimestamp + 1;
    const next = base > this.lastTimestamp ? base : this.lastTimestamp + 1;
    this.lastTimestamp = next;
    return next;
  }

  private report(reason: string): void {
    const key = reason.split(":")[0];
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.deps.onError(reason);
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
