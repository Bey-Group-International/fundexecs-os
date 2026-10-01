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
  it("takes the worker with the standardised generator", () => {
    // Firefox's shape: MediaStreamTrackProcessor plus VideoTrackGenerator.
    const route = pipelineRoute(without({ mediaStreamTrackGenerator: false }));
    expect(route).toEqual({ route: "worker", generator: "video-track-generator", reason: "supported" });
  });

  it("takes the worker with Chrome's pre-standard generator", () => {
    const route = pipelineRoute(without({ videoTrackGenerator: false }));
    expect(route).toEqual({
      route: "worker",
      generator: "media-stream-track-generator",
      reason: "supported",
    });
  });

  it("prefers the standard name when a browser has both", () => {
    // So a browser that grows the standard name migrates onto it with no edit
    // here. Chrome shipped its own in 2021, before the API was standardised.
    expect(pipelineRoute(all).generator).toBe("video-track-generator");
  });

  it("stays on the main thread when only the input half exists", () => {
    // The dangerous case: frames can be read but never written back, so a
    // pipeline that checked one half would hand the room a black tile.
    const route = pipelineRoute(
      without({ videoTrackGenerator: false, mediaStreamTrackGenerator: false }),
    );
    expect(route.route).toBe("main");
    expect(route.reason).toBe("no-generator");
    expect(route.generator).toBeNull();
  });

  it("stays on the main thread when only the output half exists", () => {
    const route = pipelineRoute(without({ trackProcessor: false }));
    expect(route.route).toBe("main");
    expect(route.reason).toBe("no-track-processor");
  });

  it("names each missing capability it refuses on", () => {
    expect(pipelineRoute(without({ worker: false })).reason).toBe("no-worker");
    expect(pipelineRoute(without({ offscreenCanvas: false })).reason).toBe("no-offscreen-canvas");
    expect(pipelineRoute(without({ videoFrame: false })).reason).toBe("no-video-frame");
  });

  it("reports the most structural reason first", () => {
    // A browser with nothing is "no-worker", not whichever check ran first --
    // the reason reaches telemetry, and "this browser has no workers" is a
    // different fact from "this browser lacks one media API".
    const nothing: PipelineSupport = {
      worker: false,
      trackProcessor: false,
      videoTrackGenerator: false,
      mediaStreamTrackGenerator: false,
      offscreenCanvas: false,
      videoFrame: false,
    };
    expect(pipelineRoute(nothing).reason).toBe("no-worker");
  });

  it("never returns a generator on the main route", () => {
    const refusals = [
      without({ worker: false }),
      without({ trackProcessor: false }),
      without({ offscreenCanvas: false }),
      without({ videoFrame: false }),
      without({ videoTrackGenerator: false, mediaStreamTrackGenerator: false }),
    ];
    for (const support of refusals) {
      const route = pipelineRoute(support);
      expect(route.route).toBe("main");
      expect(route.generator).toBeNull();
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
