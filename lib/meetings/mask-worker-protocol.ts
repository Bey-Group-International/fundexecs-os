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

import { SLOW_FRAME_RUN } from "@/lib/meetings/backgrounds";
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
   * The machine is not keeping up, as a run of over-budget frames.
   *
   * The main thread's processor has always reported this and the room suspends
   * the effect on a long enough run. The worker did not, so once the room moved
   * onto the worker nothing was watching the number -- on the path the member
   * spends the whole call on. Sent on the two counts that change anything, not
   * per frame: see `shouldReportSlowFrames`.
   */
  | { kind: "slow"; consecutive: number }
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

/**
 * Whether this slow-frame count is worth a message.
 *
 * The loop counts a run and would offer every count in it. The room reads the
 * number through `shouldSuspendEffect`, which acts on a run of SLOW_FRAME_RUN
 * and on nothing else -- so the only two counts that change anything are the
 * one that reaches the run and the zero that ends it. Everything between is a
 * `postMessage` per frame saying the same thing, onto the thread this whole
 * exercise exists to free.
 *
 * `alreadyReported` is the caller's memory of whether it is currently in a
 * reported run, which is what makes this a transition rather than a threshold:
 * without it a sustained run posts once a frame for as long as it lasts.
 */
export function shouldReportSlowFrames(alreadyReported: boolean, consecutive: number): boolean {
  if (!Number.isFinite(consecutive) || consecutive < 0) return false;
  if (consecutive >= SLOW_FRAME_RUN) return !alreadyReported;
  // Only the zero. A run that merely got shorter has not ended, and the room
  // has no use for a count below the threshold it acts on.
  if (consecutive === 0) return alreadyReported;
  return false;
}

/**
 * Whether an arriving message is one this worker recognises.
 *
 * Here rather than inline in the entry for two reasons. It is the only part of
 * receiving a message that can be tested, and it is the answer to a CodeQL
 * finding that is worth writing down rather than waving away.
 *
 * The finding is `js/missing-origin-check`: a `postMessage` handler with no
 * origin verification. On a WINDOW that is a real vulnerability -- any page that
 * can get a handle on yours may post to it. Inside a DEDICATED worker it is not
 * the available control, and the literal remedy breaks the worker: a dedicated
 * worker has exactly one owner, nothing else can obtain a reference to post to
 * it, and `MessageEvent.origin` for a `Worker.postMessage` is the EMPTY STRING.
 * Comparing it against the page's origin would reject every legitimate message.
 * (The window listener in `OfficeFrame.tsx` does check its origin, correctly --
 * that one needs it.)
 *
 * What was genuinely missing is this: the entry cast `event.data` to the union
 * and acted on it -- handing streams to a pipeline, replacing the background,
 * tearing the session down -- without ever checking it was one of those things.
 * Validating the shape is the control that applies here, so anything
 * unrecognised is dropped rather than half-executed.
 */
export function isMainToWorker(value: unknown): value is MainToWorker {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  const size = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
  const effect = (e: unknown) =>
    typeof e === "object" && e !== null && typeof (e as { kind?: unknown }).kind === "string";

  switch (m.kind) {
    case "start-streams":
      // The streams themselves can only be checked for presence: a transferred
      // `ReadableStream` is a host object, and `instanceof` across a worker
      // boundary is not something to rely on.
      return (
        typeof m.readable === "object" && m.readable !== null &&
        typeof m.writable === "object" && m.writable !== null &&
        size(m.width) && size(m.height) && effect(m.effect)
      );
    case "start-track":
      return (
        typeof m.track === "object" && m.track !== null &&
        size(m.width) && size(m.height) && effect(m.effect)
      );
    case "effect":
      // A null image is the ordinary case -- it means "keep whatever you have".
      return effect(m.effect) && (m.image === null || typeof m.image === "object");
    case "pause":
      return typeof m.paused === "boolean";
    case "stop":
      return true;
    default:
      return false;
  }
}
