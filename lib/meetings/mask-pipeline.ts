// lib/meetings/mask-pipeline.ts
// Which thread the masking pipeline runs on, and when to stop trying.
//
// The masking chain is the largest main-thread cost in a call. Segmentation
// itself runs on the GPU, but reading the confidence mask back is a ~520KB
// GPU-to-CPU copy per frame, the per-pixel chain in `backgrounds.ts` measures
// ~3.5ms per frame on top of it, and the composite and its backdrop blur land
// on the same thread as React and everyone else's decoded video.
//
// All of that can move to a worker, because the pipeline's input and output are
// both MediaStreamTracks and those are now transferable. `MediaStreamTrackProcessor`
// turns an incoming track into a stream of VideoFrames; a generator turns frames
// back into an outgoing track. The standardised pair is deliberately worker-only,
// which is the whole point: nothing in the real-time media path waits on a busy
// main thread.
//
// Two things make this a rules module rather than a few `typeof` checks inline.
//
// The feature detection has to be exactly right, because the failure is not a
// thrown error. Route to a worker in a browser missing one half of the pair and
// the camera tile goes black and stays black -- a call where nobody can see the
// person, which is far worse than a call that costs more CPU. So the decision is
// a pure function of a capability snapshot, and it is tested against the shape
// each browser family actually presents.
//
// And there are two routes, not one API with two spellings. Chrome shipped
// `MediaStreamTrackProcessor` and `MediaStreamTrackGenerator` in 2021, before
// standardisation, exposed on the MAIN thread: you build both there and transfer
// the streams in. The standard that followed is deliberately worker-only and
// splits the output half out as `VideoTrackGenerator`: the PROCESSOR is built in
// the worker, so the camera track is sent to it, and the generator's `.track`
// comes back out. Different objects, different construction sites, and the track
// travels the opposite way.
//
// Which produces the trap this module exists to not fall into. On a browser that
// implements only the standard, `MediaStreamTrackProcessor` is absent from the
// main scope and present in the worker. Feature-detecting on `window` alone
// therefore reports "no fast path" on exactly the browsers the standard was
// written for. So the decision takes TWO snapshots -- the main scope's and the
// worker's own, which the worker reports when it starts -- and the worker is
// probed before it is trusted.

/**
 * What the pipeline needs from whatever global scope it is asked to run in.
 *
 * Taken as a snapshot of booleans rather than read from `globalThis` inside the
 * decision, so the decision is pure and every browser shape can be tested
 * without pretending to be that browser.
 */
export interface PipelineSupport {
  /** Workers at all. */
  worker: boolean;
  /** `MediaStreamTrackProcessor` — an incoming track as a stream of frames. */
  trackProcessor: boolean;
  /** `VideoTrackGenerator` — the standardised output half. */
  videoTrackGenerator: boolean;
  /** `MediaStreamTrackGenerator` — Chrome's pre-standard output half. */
  mediaStreamTrackGenerator: boolean;
  /** `OffscreenCanvas`, which is where a worker has to composite. */
  offscreenCanvas: boolean;
  /** `VideoFrame`, which is what travels between the two halves. */
  videoFrame: boolean;
}

/**
 * Read the capability snapshot from a global scope.
 *
 * Takes the scope rather than reaching for `globalThis`, which is what lets the
 * same function run on the main thread and inside the worker and lets a test
 * hand it an object. Everything is a `typeof` check on a constructor name: there
 * is no way to ask these APIs whether they work without building one, and
 * building one costs a real track.
 */
export function readPipelineSupport(scope: Record<string, unknown>): PipelineSupport {
  const has = (name: string) => typeof scope[name] === "function";
  return {
    worker: has("Worker"),
    trackProcessor: has("MediaStreamTrackProcessor"),
    videoTrackGenerator: has("VideoTrackGenerator"),
    mediaStreamTrackGenerator: has("MediaStreamTrackGenerator"),
    offscreenCanvas: has("OffscreenCanvas"),
    videoFrame: has("VideoFrame"),
  };
}

/**
 * How the two halves are built, and therefore what crosses the thread boundary.
 *
 * Not a cosmetic distinction. `transfer-streams` means the main thread owns both
 * objects and hands the worker a `readable` and a `writable`; `transfer-track`
 * means the worker owns both and the camera track goes in while the output track
 * comes back. The message protocol, the teardown, and which side can even see
 * the constructors all follow from this.
 */
export type PipelineProtocol = "transfer-streams" | "transfer-track";

/** Where the pipeline will run, and why. */
export interface PipelineRoute {
  route: "worker" | "main";
  /** Set only on the worker route. */
  protocol: PipelineProtocol | null;
  /**
   * Why the main thread was chosen. One of a closed set rather than a sentence,
   * so it can be counted in telemetry without parsing prose.
   */
  reason:
    | "supported"
    | "no-worker"
    | "no-offscreen-canvas"
    | "no-video-frame"
    | "worker-not-probed"
    | "no-insertable-streams";
}

/**
 * Whether the main scope can drive Chrome's pre-standard pair itself.
 *
 * Both halves have to be there. One without the other is the black-tile case:
 * frames can be read and never written back, or the reverse.
 */
export function mainScopeDrivesPipeline(main: PipelineSupport): boolean {
  return main.trackProcessor && main.mediaStreamTrackGenerator;
}

/**
 * Whether the worker holds the standardised insertable-streams pair.
 *
 * The PAIR only. Rendering capability is deliberately not folded in here,
 * because `OffscreenCanvas` and `VideoFrame` are needed in the worker under
 * BOTH protocols -- the worker is where the compositing happens either way --
 * so `pipelineRoute` checks them once, before it picks between the two, rather
 * than once per protocol.
 */
export function workerScopeDrivesPipeline(worker: PipelineSupport): boolean {
  return worker.trackProcessor && worker.videoTrackGenerator;
}

/**
 * Decide where the pipeline runs, from both scopes' capabilities.
 *
 * `worker` is null until the worker has reported in. That is a real state rather
 * than a missing argument: until it answers, the honest route is the main thread,
 * because the alternative is holding the member's camera hostage to a worker that
 * may never start.
 *
 * The standard route is preferred where both are possible, so a browser that
 * grows the standard names migrates onto them with no edit here.
 */
export function pipelineRoute(
  main: PipelineSupport,
  worker: PipelineSupport | null,
): PipelineRoute {
  const stay = (reason: PipelineRoute["reason"]): PipelineRoute => ({
    route: "main",
    protocol: null,
    reason,
  });

  if (!main.worker) return stay("no-worker");

  if (worker === null) {
    // Chrome can start without waiting, because it owns both insertable-streams
    // halves on this thread. The rendering check here is explicitly a PROXY: the
    // compositing will happen in a worker that has not reported yet, so the main
    // scope's answer is the only one available. It is a heuristic to let the
    // common browser start a beat sooner, and the first-frame deadline is what
    // catches it being wrong.
    if (mainScopeDrivesPipeline(main) && main.offscreenCanvas && main.videoFrame) {
      return { route: "worker", protocol: "transfer-streams", reason: "supported" };
    }
    return stay("worker-not-probed");
  }

  // The worker has reported, so stop guessing. Rendering is checked on ITS
  // snapshot and before either protocol is chosen, because the worker composites
  // under both: `transfer-track` builds the whole pipeline there, and
  // `transfer-streams` only moves the CONSTRUCTORS to the main thread -- the
  // frames are still read, drawn and written back inside the worker. Authorising
  // that route on the main scope's `OffscreenCanvas` would be asking the wrong
  // thread whether it can paint, and the answer arrives as a black tile.
  if (!worker.offscreenCanvas) return stay("no-offscreen-canvas");
  if (!worker.videoFrame) return stay("no-video-frame");

  if (workerScopeDrivesPipeline(worker)) {
    return { route: "worker", protocol: "transfer-track", reason: "supported" };
  }
  if (mainScopeDrivesPipeline(main)) {
    return { route: "worker", protocol: "transfer-streams", reason: "supported" };
  }
  return stay("no-insertable-streams");
}

/**
 * How long to wait for the worker's first composited frame before giving up.
 *
 * The failure this exists for is silence, not an exception. A worker can be
 * constructed, accept a track, and simply never produce a frame -- a WASM fetch
 * that 404s behind a misconfigured CDN, a GPU context the worker cannot get, an
 * OffscreenCanvas the browser claims to have. Nothing throws on the main thread,
 * and what the room shows is a black tile where somebody's face should be.
 *
 * 2500ms is long enough to cover the segmenter's own cold start on a modest
 * laptop, which is the slowest legitimate first frame, and short enough that a
 * member who hits the broken case sees a couple of seconds of waiting rather
 * than a call spent invisible.
 */
export const FIRST_FRAME_DEADLINE_MS = 2_500;

/** What the caller knows about an attempt in flight. */
export interface PipelineAttempt {
  /** Frames the worker has delivered so far. */
  framesDelivered: number;
  /** Milliseconds since the track was handed over. */
  elapsedMs: number;
  /** The worker reported an error, or died. */
  failed: boolean;
}

/**
 * Whether to abandon the worker and composite on the main thread instead.
 *
 * A delivered frame settles it: once the worker has produced one, the deadline
 * stops applying, because a later stall is a slow frame rather than a pipeline
 * that was never going to work -- and `onSlowFrames` already handles slow.
 *
 * This answers only "should we fall back now". Whether a fallback can later be
 * reversed is deliberately NOT here; see `pipelineFellBack`.
 */
export function shouldFallBack(
  attempt: PipelineAttempt,
  deadlineMs: number = FIRST_FRAME_DEADLINE_MS,
): boolean {
  if (attempt.failed) return true;
  if (attempt.framesDelivered > 0) return false;
  return attempt.elapsedMs >= deadlineMs;
}

/**
 * Once fallen back, stay fallen back for the life of this processor.
 *
 * A ratchet, and this file is the wrong place to be casual about one: the
 * bandwidth adaptation in `connection.ts` had exactly this shape as a BUG, where
 * a call that dropped to audio-only never recovered video even after the link
 * did. The difference is what the two are reacting to. Bandwidth recovers, so
 * latching on it strands people in a worse call than their network deserves.
 * A browser that cannot run `VideoTrackGenerator`, or a worker whose WASM is not
 * being served, does not recover mid-call -- so retrying costs another black-tile
 * deadline every time the member changes background, and buys nothing.
 *
 * Scoped to the processor rather than the page: a new call, or a reload, tries
 * again from scratch.
 */
export function pipelineFellBack(previous: boolean, falling: boolean): boolean {
  return previous || falling;
}

/**
 * Main-thread milliseconds per second of video, from a per-frame cost.
 *
 * The unit the per-frame numbers should always be read in, and the reason this
 * work is worth doing: 3.5ms a frame sounds like nothing, and at 24fps it is
 * 84ms of every second spent in the mask alone, in a tab that is also decoding
 * everyone else's camera.
 */
export function mainThreadMsPerSecond(msPerFrame: number, fps: number): number {
  if (!Number.isFinite(msPerFrame) || !Number.isFinite(fps)) return 0;
  if (msPerFrame <= 0 || fps <= 0) return 0;
  return msPerFrame * fps;
}
