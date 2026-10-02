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
  shouldReportStats,
  timingReport,
} from "./mask-worker-protocol";

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
