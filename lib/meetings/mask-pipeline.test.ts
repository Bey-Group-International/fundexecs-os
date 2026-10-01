/**
 * Where the masking pipeline runs.
 *
 * These are permission-shaped tests in all but name. The cost of routing wrong
 * is not a slow call, it is a camera tile that goes black and stays black,
 * because the APIs involved fail by producing nothing rather than by throwing.
 * So every browser shape gets its own case, including the ones that have half
 * the pair.
 */
import {
  FIRST_FRAME_DEADLINE_MS,
  mainThreadMsPerSecond,
  pipelineFellBack,
  pipelineRoute,
  readPipelineSupport,
  shouldFallBack,
  type PipelineSupport,
} from "@/lib/meetings/mask-pipeline";

/** Everything present, as the fullest browser would report. */
const all: PipelineSupport = {
  worker: true,
  trackProcessor: true,
  videoTrackGenerator: true,
  mediaStreamTrackGenerator: true,
  offscreenCanvas: true,
  videoFrame: true,
};

const without = (missing: Partial<PipelineSupport>): PipelineSupport => ({ ...all, ...missing });

describe("readPipelineSupport", () => {
  it("reads constructors off the scope it is given", () => {
    const scope = {
      Worker: function () {},
      MediaStreamTrackProcessor: function () {},
      VideoTrackGenerator: function () {},
      OffscreenCanvas: function () {},
      VideoFrame: function () {},
    } as unknown as Record<string, unknown>;

    expect(readPipelineSupport(scope)).toEqual({
      worker: true,
      trackProcessor: true,
      videoTrackGenerator: true,
      mediaStreamTrackGenerator: false,
      offscreenCanvas: true,
      videoFrame: true,
    });
  });

  it("reports nothing for an empty scope rather than throwing", () => {
    const support = readPipelineSupport({});
    expect(Object.values(support).every((v) => v === false)).toBe(true);
  });

  it("does not count a non-function of the right name", () => {
    // A polyfill stub, or a page that happens to set a global of that name.
    // Only something constructible is evidence of the API.
    expect(readPipelineSupport({ Worker: true, VideoFrame: {} }).worker).toBe(false);
    expect(readPipelineSupport({ Worker: true, VideoFrame: {} }).videoFrame).toBe(false);
  });
});

describe("pipelineRoute, per browser shape", () => {
  /** Nothing at all: an old browser, or a worker that never reported. */
  const none: PipelineSupport = {
    worker: false,
    trackProcessor: false,
    videoTrackGenerator: false,
    mediaStreamTrackGenerator: false,
    offscreenCanvas: false,
    videoFrame: false,
  };

  /** Chrome: both halves on the main thread, under the pre-standard names. */
  const chromeMain = without({ videoTrackGenerator: false });

  /**
   * Firefox: the main scope has NEITHER insertable-streams constructor. This is
   * the shape that makes two-scope detection necessary.
   */
  const standardMain: PipelineSupport = {
    ...none,
    worker: true,
    offscreenCanvas: true,
  };
  const standardWorker: PipelineSupport = {
    worker: false,
    trackProcessor: true,
    videoTrackGenerator: true,
    mediaStreamTrackGenerator: false,
    offscreenCanvas: true,
    videoFrame: true,
  };

  it("sends streams into the worker on Chrome's pre-standard pair", () => {
    expect(pipelineRoute(chromeMain, null)).toEqual({
      route: "worker",
      protocol: "transfer-streams",
      reason: "supported",
    });
  });

  it("takes the worker route on a browser whose MAIN scope has neither constructor", () => {
    // The trap. Firefox puts MediaStreamTrackProcessor in the worker and not on
    // window, so detecting on the main scope alone would report "no fast path"
    // on exactly the browser the standard was written for.
    expect(pipelineRoute(standardMain, null).route).toBe("main");
    expect(pipelineRoute(standardMain, standardWorker)).toEqual({
      route: "worker",
      protocol: "transfer-track",
      reason: "supported",
    });
  });

  it("prefers the standard route when a browser could do both", () => {
    // So a browser that grows the standard names migrates onto them with no edit
    // here, and the pre-standard pair becomes dead weight rather than the default.
    expect(pipelineRoute(all, standardWorker).protocol).toBe("transfer-track");
  });

  it("waits on the main thread until the worker has reported", () => {
    // Not an error state: holding a member's camera hostage to a worker that may
    // never start is worse than a call that costs more CPU.
    const route = pipelineRoute(standardMain, null);
    expect(route.reason).toBe("worker-not-probed");
    expect(route.protocol).toBeNull();
  });

  it("refuses when the worker reports only half the standard pair", () => {
    // Frames readable and never writable back, or the reverse: the black tile.
    const halfIn = { ...standardWorker, videoTrackGenerator: false };
    const halfOut = { ...standardWorker, trackProcessor: false };
    expect(pipelineRoute(standardMain, halfIn).route).toBe("main");
    expect(pipelineRoute(standardMain, halfOut).route).toBe("main");
    expect(pipelineRoute(standardMain, halfIn).reason).toBe("no-insertable-streams");
  });

  it("refuses when the main scope has only half the pre-standard pair", () => {
    expect(pipelineRoute(without({ mediaStreamTrackGenerator: false, videoTrackGenerator: false }), none).route).toBe("main");
    expect(pipelineRoute(without({ trackProcessor: false, videoTrackGenerator: false }), none).route).toBe("main");
  });

  it("falls back to Chrome's route when the worker cannot drive the standard one", () => {
    // A browser with both main-thread constructors and a worker lacking
    // VideoTrackGenerator should still get the fast path, by the other protocol.
    expect(pipelineRoute(chromeMain, none).protocol).toBe("transfer-streams");
  });

  it("names no-worker before anything else", () => {
    // The reason reaches telemetry, and "this browser has no workers" is a
    // different fact from "this browser lacks one media API".
    expect(pipelineRoute(none, null).reason).toBe("no-worker");
    expect(pipelineRoute({ ...all, worker: false }, standardWorker).reason).toBe("no-worker");
  });

  it("names a missing OffscreenCanvas when neither scope has one", () => {
    const mainNoCanvas = { ...standardMain, offscreenCanvas: false };
    const workerNoCanvas = { ...standardWorker, offscreenCanvas: false };
    expect(pipelineRoute(mainNoCanvas, workerNoCanvas).reason).toBe("no-offscreen-canvas");
  });

  it("never returns a protocol on the main route", () => {
    const refusals: Array<[PipelineSupport, PipelineSupport | null]> = [
      [none, null],
      [standardMain, null],
      [standardMain, none],
      [{ ...all, worker: false }, standardWorker],
    ];
    for (const [main, worker] of refusals) {
      const route = pipelineRoute(main, worker);
      expect(route.route).toBe("main");
      expect(route.protocol).toBeNull();
    }
  });
});

describe("shouldFallBack", () => {
  it("falls back when the worker reported an error", () => {
    expect(shouldFallBack({ framesDelivered: 0, elapsedMs: 10, failed: true })).toBe(true);
  });

  it("falls back when no frame has arrived by the deadline", () => {
    // The silent failure this exists for: constructed, handed a track, never
    // produces anything, nothing thrown.
    expect(
      shouldFallBack({ framesDelivered: 0, elapsedMs: FIRST_FRAME_DEADLINE_MS, failed: false }),
    ).toBe(true);
  });

  it("waits while still inside the deadline", () => {
    expect(shouldFallBack({ framesDelivered: 0, elapsedMs: 100, failed: false })).toBe(false);
  });

  it("stops applying the deadline once a frame has been delivered", () => {
    // A later stall is a slow frame, not a pipeline that was never going to
    // work, and slow frames are already somebody else's job.
    expect(
      shouldFallBack({ framesDelivered: 1, elapsedMs: 60_000, failed: false }),
    ).toBe(false);
  });

  it("still falls back on an error after frames were flowing", () => {
    // A worker that dies mid-call has stopped producing, and the member would
    // otherwise be left on a frozen tile.
    expect(shouldFallBack({ framesDelivered: 400, elapsedMs: 60_000, failed: true })).toBe(true);
  });

  it("takes a caller's deadline", () => {
    expect(shouldFallBack({ framesDelivered: 0, elapsedMs: 50, failed: false }, 40)).toBe(true);
  });
});

describe("pipelineFellBack", () => {
  it("latches, so a member does not pay the deadline twice", () => {
    expect(pipelineFellBack(false, true)).toBe(true);
    expect(pipelineFellBack(true, false)).toBe(true);
  });

  it("stays clear until something actually falls back", () => {
    expect(pipelineFellBack(false, false)).toBe(false);
  });

  /**
   * The contrast that justifies the latch, kept as a test so the reasoning
   * cannot quietly rot: the bandwidth ratchet was a bug because bandwidth
   * recovers. A missing API does not.
   */
  it("is a one-way ratchet on purpose, unlike the bandwidth one", () => {
    let fell = false;
    for (const falling of [false, true, false, false, false]) {
      fell = pipelineFellBack(fell, falling);
    }
    expect(fell).toBe(true);
  });
});

describe("mainThreadMsPerSecond", () => {
  it("turns a per-frame cost into the unit that shows why this matters", () => {
    expect(mainThreadMsPerSecond(3.5, 24)).toBeCloseTo(84, 5);
  });

  it("is zero rather than NaN on nonsense", () => {
    expect(mainThreadMsPerSecond(Number.NaN, 24)).toBe(0);
    expect(mainThreadMsPerSecond(3.5, 0)).toBe(0);
    expect(mainThreadMsPerSecond(-1, 24)).toBe(0);
    expect(mainThreadMsPerSecond(3.5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
