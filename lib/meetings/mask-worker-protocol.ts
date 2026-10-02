// lib/meetings/mask-worker-protocol.ts
// What the main thread and the masking worker say to each other.
//
// Separated from both sides because it is the one thing they have to agree
// about, and because the worker cannot be executed in a test: a message union
// in its own file is a contract two files are checked against, rather than two
// `postMessage` call sites that drift until a camera tile goes black.
//
// The shapes are deliberately flat and structurally-cloneable. Anything that
// has to be TRANSFERRED rather than cloned -- streams, tracks, VideoFrames,
// ImageBitmaps -- travels in the transfer list beside the message, never inside
// it, and the field that names it says so.

import type { PipelineProtocol } from "@/lib/meetings/mask-pipeline";
import type { BackgroundEffect } from "@/lib/meetings/backgrounds";
import type { PipelineSupport } from "@/lib/meetings/mask-pipeline";

/** Messages the main thread sends in. */
export type MainToWorker =
  /**
   * Chrome's pre-standard route: the main thread built both halves and the
   * streams come in the transfer list.
   */
  | {
      kind: "start-streams";
      readable: unknown;
      writable: unknown;
      width: number;
      height: number;
      effect: BackgroundEffect;
    }
  /**
   * The standard route: the camera track comes in the transfer list, the worker
   * builds the processor and generator, and `ready` carries the output track
   * back out.
   */
  | {
      kind: "start-track";
      track: unknown;
      width: number;
      height: number;
      effect: BackgroundEffect;
    }
  /** A different background. The bitmap, when present, is transferred. */
  | { kind: "effect"; effect: BackgroundEffect; image: ImageBitmap | null }
  /** Stop compositing but keep the worker, for a camera switched off. */
  | { kind: "pause"; paused: boolean }
  /** Shut down: close the segmenter, the surfaces and the streams. */
  | { kind: "stop" };

/** Messages the worker sends out. */
export type WorkerToMain =
  /**
   * What this worker scope can actually do, reported before anything is built.
   *
   * The whole reason the route is decided from two snapshots: on a browser that
   * implements only the standard, `MediaStreamTrackProcessor` is absent from
   * `window` and present here.
   */
  | { kind: "support"; support: PipelineSupport }
  /**
   * The pipeline is up. `track` is set only on the standard route, where the
   * generator was built here and its track is transferred back.
   */
  | { kind: "ready"; protocol: PipelineProtocol; track: unknown | null }
  /** A frame reached the output. The main thread's deadline stops at the first. */
  | { kind: "frame"; index: number }
  /** Periodic timing, so the saving can be stated rather than assumed. */
  | { kind: "stats"; stats: TimingReport }
  /**
   * Something went wrong badly enough that the main thread should composite
   * instead. A string rather than an Error because Errors do not clone
   * faithfully across every browser.
   */
  | { kind: "failed"; reason: string };

/**
 * One frame's cost, split where the interesting line is.
 *
 * `readbackMs` is `getAsFloat32Array`: a ~520KB GPU-to-CPU copy, which on paper
 * is the single most expensive step and the reason this work started. `chainMs`
 * is everything `backgrounds.ts` does per pixel afterwards. They are measured
 * apart because they are fixed by different means -- a smaller mask for one, a
 * cheaper loop for the other -- and because nothing so far has told us which
 * dominates on real hardware.
 */
export interface FrameTiming {
  readbackMs: number;
  chainMs: number;
  /** Everything, including the segmenter call and building the output frame. */
  totalMs: number;
}

/** Running totals, kept as sums so the average needs no history. */
export interface TimingAccumulator {
  frames: number;
  readbackMs: number;
  chainMs: number;
  totalMs: number;
  /** The worst single frame, which is what a member actually notices. */
  worstTotalMs: number;
}

export function createTimingAccumulator(): TimingAccumulator {
  return { frames: 0, readbackMs: 0, chainMs: 0, totalMs: 0, worstTotalMs: 0 };
}

/**
 * Fold one frame in.
 *
 * Non-finite values are dropped rather than propagated. `performance.now()`
 * differences are finite in practice, but a single NaN would poison every
 * average after it, and a timing number that reads NaN tells nobody anything
 * while hiding the numbers that would have.
 */
export function accumulateTiming(into: TimingAccumulator, timing: FrameTiming): TimingAccumulator {
  const ok = (n: number) => (Number.isFinite(n) && n >= 0 ? n : 0);
  into.frames += 1;
  into.readbackMs += ok(timing.readbackMs);
  into.chainMs += ok(timing.chainMs);
  const total = ok(timing.totalMs);
  into.totalMs += total;
  if (total > into.worstTotalMs) into.worstTotalMs = total;
  return into;
}

/** What gets reported out: per-frame averages, not sums. */
export interface TimingReport {
  frames: number;
  readbackMsPerFrame: number;
  chainMsPerFrame: number;
  totalMsPerFrame: number;
  worstTotalMs: number;
}

export function timingReport(acc: TimingAccumulator): TimingReport {
  if (acc.frames <= 0) {
    return {
      frames: 0,
      readbackMsPerFrame: 0,
      chainMsPerFrame: 0,
      totalMsPerFrame: 0,
      worstTotalMs: 0,
    };
  }
  return {
    frames: acc.frames,
    readbackMsPerFrame: acc.readbackMs / acc.frames,
    chainMsPerFrame: acc.chainMs / acc.frames,
    totalMsPerFrame: acc.totalMs / acc.frames,
    worstTotalMs: acc.worstTotalMs,
  };
}

/**
 * How often the worker reports timing.
 *
 * Once a second at the output frame rate. Often enough to see a machine get
 * into trouble, rare enough that the reporting is not itself a per-frame
 * `postMessage` -- which would put work back on the thread this exists to free.
 */
export const STATS_INTERVAL_FRAMES = 24;

/** Whether this frame is the one that reports. */
export function shouldReportStats(frames: number, interval = STATS_INTERVAL_FRAMES): boolean {
  if (!Number.isInteger(frames) || frames <= 0) return false;
  const step = Number.isInteger(interval) && interval > 0 ? interval : STATS_INTERVAL_FRAMES;
  return frames % step === 0;
}
