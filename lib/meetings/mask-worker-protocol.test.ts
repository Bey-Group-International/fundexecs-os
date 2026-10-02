// The timing the worker reports, and the rules for when it reports it.
//
// Worth its own tests because the numbers are the point of the exercise: the
// whole worker exists on the claim that the masking chain costs the main thread
// ~84ms of every second, and a number that quietly reads NaN or averages a bad
// minute back out would leave that claim unfalsifiable.

import {
  STATS_INTERVAL_FRAMES,
  accumulateTiming,
  createTimingAccumulator,
  isMainToWorker,
  shouldReportSlowFrames,
  shouldReportStats,
  timingReport,
} from "./mask-worker-protocol";
import { SLOW_FRAME_RUN } from "./backgrounds";

describe("folding a frame's timing in", () => {
  it("sums each part and tracks the worst frame", () => {
    const acc = createTimingAccumulator();
    accumulateTiming(acc, { readbackMs: 2, chainMs: 3, totalMs: 6 });
    accumulateTiming(acc, { readbackMs: 4, chainMs: 1, totalMs: 10 });
    expect(acc).toEqual({ frames: 2, readbackMs: 6, chainMs: 4, totalMs: 16, worstTotalMs: 10 });
  });

  /**
   * One NaN would poison every average after it, and an average that reads NaN
   * tells nobody anything while hiding the numbers that would have.
   */
  it("drops a non-finite reading rather than propagating it", () => {
    const acc = createTimingAccumulator();
    accumulateTiming(acc, { readbackMs: 2, chainMs: 3, totalMs: 6 });
    accumulateTiming(acc, { readbackMs: Number.NaN, chainMs: Infinity, totalMs: Number.NaN });
    const report = timingReport(acc);
    expect(Number.isFinite(report.readbackMsPerFrame)).toBe(true);
    expect(Number.isFinite(report.chainMsPerFrame)).toBe(true);
    expect(report.worstTotalMs).toBe(6);
  });

  /** A clock that went backwards -- a tab suspended mid-frame will do it. */
  it("drops a negative reading", () => {
    const acc = createTimingAccumulator();
    accumulateTiming(acc, { readbackMs: -5, chainMs: -1, totalMs: -2 });
    expect(acc.readbackMs).toBe(0);
    expect(acc.worstTotalMs).toBe(0);
  });

  it("still counts the frame, so the average is not inflated", () => {
    const acc = createTimingAccumulator();
    accumulateTiming(acc, { readbackMs: 4, chainMs: 4, totalMs: 8 });
    accumulateTiming(acc, { readbackMs: Number.NaN, chainMs: Number.NaN, totalMs: Number.NaN });
    expect(timingReport(acc).readbackMsPerFrame).toBe(2);
  });
});

describe("the report", () => {
  it("is per frame, not a sum", () => {
    const acc = createTimingAccumulator();
    for (let i = 0; i < 4; i++) accumulateTiming(acc, { readbackMs: 2, chainMs: 3, totalMs: 7 });
    expect(timingReport(acc)).toEqual({
      frames: 4,
      readbackMsPerFrame: 2,
      chainMsPerFrame: 3,
      totalMsPerFrame: 7,
      worstTotalMs: 7,
    });
  });

  it("reads zero rather than dividing by no frames", () => {
    expect(timingReport(createTimingAccumulator())).toEqual({
      frames: 0,
      readbackMsPerFrame: 0,
      chainMsPerFrame: 0,
      totalMsPerFrame: 0,
      worstTotalMs: 0,
    });
  });
});

describe("when to report", () => {
  it("once a second at the output frame rate", () => {
    expect(STATS_INTERVAL_FRAMES).toBe(24);
    expect(shouldReportStats(24)).toBe(true);
    expect(shouldReportStats(48)).toBe(true);
  });

  it("not on the frames in between", () => {
    expect(shouldReportStats(1)).toBe(false);
    expect(shouldReportStats(23)).toBe(false);
    expect(shouldReportStats(25)).toBe(false);
  });

  /** Reporting per frame would put work back on the thread this exists to free. */
  it("never on frame zero or a nonsense count", () => {
    expect(shouldReportStats(0)).toBe(false);
    expect(shouldReportStats(-1)).toBe(false);
    expect(shouldReportStats(1.5)).toBe(false);
  });

  it("falls back to the default on a nonsense interval", () => {
    expect(shouldReportStats(24, 0)).toBe(true);
    expect(shouldReportStats(24, -3)).toBe(true);
    expect(shouldReportStats(12, 1.5)).toBe(false);
  });
});

/**
 * The room acts on a RUN of slow frames and on nothing else, so the worker only
 * has two counts worth a message: the one that reaches the run, and the zero
 * that ends it.
 *
 * The alternative is a `postMessage` per frame for as long as a slow machine
 * stays slow, onto the thread the worker exists to free -- which would make the
 * reporting itself part of the problem it reports.
 */
describe("when to report slow frames", () => {
  it("reports the count that reaches the run", () => {
    expect(shouldReportSlowFrames(false, SLOW_FRAME_RUN)).toBe(true);
  });

  it("says nothing below the run the room acts on", () => {
    expect(shouldReportSlowFrames(false, 1)).toBe(false);
    expect(shouldReportSlowFrames(false, SLOW_FRAME_RUN - 1)).toBe(false);
  });

  it("does not repeat itself while the run continues", () => {
    expect(shouldReportSlowFrames(true, SLOW_FRAME_RUN)).toBe(false);
    expect(shouldReportSlowFrames(true, SLOW_FRAME_RUN + 100)).toBe(false);
  });

  it("reports the zero that ends a reported run", () => {
    expect(shouldReportSlowFrames(true, 0)).toBe(true);
  });

  /** A zero nobody was waiting for is every good frame of a healthy call. */
  it("says nothing about a zero when no run was reported", () => {
    expect(shouldReportSlowFrames(false, 0)).toBe(false);
  });

  /** A run that merely got shorter has not ended, and the room has no use for
   *  a count below its threshold. */
  it("does not treat a shortened run as an end", () => {
    expect(shouldReportSlowFrames(true, 1)).toBe(false);
    expect(shouldReportSlowFrames(true, SLOW_FRAME_RUN - 1)).toBe(false);
  });

  it("refuses a count that is not one", () => {
    expect(shouldReportSlowFrames(true, Number.NaN)).toBe(false);
    expect(shouldReportSlowFrames(true, -1)).toBe(false);
    expect(shouldReportSlowFrames(false, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

/**
 * The worker validates what arrives rather than casting it.
 *
 * CodeQL flagged the handler for `js/missing-origin-check`. Origin verification
 * is not the control available inside a dedicated worker -- it has one owner,
 * and `MessageEvent.origin` for a `Worker.postMessage` is the empty string, so
 * the literal remedy would reject every real message. What WAS missing is this:
 * the handler hands streams to a pipeline and tears the session down, and did
 * so on an unchecked cast of `event.data`.
 */
describe("validating what arrives", () => {
  const effect = { kind: "blur", strength: "light" };
  const stream = {} as unknown;

  it("accepts the five messages the worker speaks", () => {
    expect(isMainToWorker({ kind: "start-streams", readable: stream, writable: stream, width: 640, height: 480, effect })).toBe(true);
    expect(isMainToWorker({ kind: "start-track", track: stream, width: 640, height: 480, effect })).toBe(true);
    expect(isMainToWorker({ kind: "effect", effect, image: null })).toBe(true);
    expect(isMainToWorker({ kind: "pause", paused: true })).toBe(true);
    expect(isMainToWorker({ kind: "stop" })).toBe(true);
  });

  it("rejects anything that is not a message at all", () => {
    expect(isMainToWorker(null)).toBe(false);
    expect(isMainToWorker(undefined)).toBe(false);
    expect(isMainToWorker("stop")).toBe(false);
    expect(isMainToWorker(42)).toBe(false);
    expect(isMainToWorker([])).toBe(false);
    expect(isMainToWorker({})).toBe(false);
  });

  it("rejects a kind it does not know", () => {
    expect(isMainToWorker({ kind: "start" })).toBe(false);
    expect(isMainToWorker({ kind: "teardown" })).toBe(false);
    expect(isMainToWorker({ kind: 7 })).toBe(false);
  });

  /** A start without its streams would build a pipeline around nothing. */
  it("rejects a start missing the half it cannot work without", () => {
    expect(isMainToWorker({ kind: "start-streams", writable: stream, width: 640, height: 480, effect })).toBe(false);
    expect(isMainToWorker({ kind: "start-streams", readable: stream, width: 640, height: 480, effect })).toBe(false);
    expect(isMainToWorker({ kind: "start-track", width: 640, height: 480, effect })).toBe(false);
  });

  /** A zero or negative size reaches `OffscreenCanvas` as a throw. */
  it("rejects a start with no usable size", () => {
    const base = { kind: "start-track", track: stream, effect };
    expect(isMainToWorker({ ...base, width: 0, height: 480 })).toBe(false);
    expect(isMainToWorker({ ...base, width: 640, height: -1 })).toBe(false);
    expect(isMainToWorker({ ...base, width: Number.NaN, height: 480 })).toBe(false);
    expect(isMainToWorker({ ...base, width: "640", height: 480 })).toBe(false);
  });

  it("rejects an effect that is not one", () => {
    expect(isMainToWorker({ kind: "effect", effect: null, image: null })).toBe(false);
    expect(isMainToWorker({ kind: "effect", effect: {}, image: null })).toBe(false);
    expect(isMainToWorker({ kind: "effect", effect: "blur", image: null })).toBe(false);
  });

  /** Null is the ordinary case: it means "keep whatever you have". */
  it("accepts an effect with no image and rejects a nonsense one", () => {
    expect(isMainToWorker({ kind: "effect", effect, image: null })).toBe(true);
    expect(isMainToWorker({ kind: "effect", effect, image: "a-picture" })).toBe(false);
  });

  it("rejects a pause that does not say which way", () => {
    expect(isMainToWorker({ kind: "pause" })).toBe(false);
    expect(isMainToWorker({ kind: "pause", paused: "yes" })).toBe(false);
    expect(isMainToWorker({ kind: "pause", paused: 1 })).toBe(false);
  });
});
