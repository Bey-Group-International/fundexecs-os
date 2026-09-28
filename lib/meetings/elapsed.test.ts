import {
  NO_ELAPSED,
  elapsedMs,
  elapsedSeconds,
  formatElapsed,
  isRunning,
  monotonicNow,
  startSpan,
  stopSpan,
  type ElapsedState,
} from "./elapsed";

describe("startSpan", () => {
  it("opens a stretch at the given moment", () => {
    const state = startSpan(NO_ELAPSED, 1_000);
    expect(state.openedAt).toBe(1_000);
    expect(isRunning(state)).toBe(true);
  });

  it("keeps the original start when called again", () => {
    // The effect that drives this re-runs on dependency changes. A restart that
    // moved the start forward would erase every second before it.
    const first = startSpan(NO_ELAPSED, 1_000);
    const again = startSpan(first, 9_000);
    expect(again.openedAt).toBe(1_000);
    expect(again).toBe(first);
  });

  it("does not disturb stretches already banked", () => {
    const state = startSpan(stopSpan(startSpan(NO_ELAPSED, 0), 5_000), 10_000);
    expect(state.spans).toHaveLength(1);
    expect(state.openedAt).toBe(10_000);
  });
});

describe("stopSpan", () => {
  it("banks the open stretch", () => {
    const state = stopSpan(startSpan(NO_ELAPSED, 1_000), 4_000);
    expect(state.spans).toEqual([{ from: 1_000, to: 4_000 }]);
    expect(state.openedAt).toBeNull();
    expect(isRunning(state)).toBe(false);
  });

  it("is a no-op when nothing is running", () => {
    // A cleanup can run after the state has already closed.
    expect(stopSpan(NO_ELAPSED, 5_000)).toBe(NO_ELAPSED);
  });

  it("banks zero rather than a negative span when the clock moves backwards", () => {
    const state = stopSpan(startSpan(NO_ELAPSED, 5_000), 1_000);
    expect(state.spans).toEqual([{ from: 5_000, to: 5_000 }]);
    expect(elapsedMs(state, 9_000)).toBe(0);
  });
});

describe("elapsedMs", () => {
  it("is zero before anything starts", () => {
    expect(elapsedMs(NO_ELAPSED, 10_000)).toBe(0);
  });

  it("counts the stretch still running", () => {
    expect(elapsedMs(startSpan(NO_ELAPSED, 1_000), 4_500)).toBe(3_500);
  });

  it("does not move once stopped, however late it is asked", () => {
    // The whole point: the answer is arithmetic on timestamps, not a total
    // assembled from callbacks, so when you look does not change what happened.
    const stopped = stopSpan(startSpan(NO_ELAPSED, 1_000), 4_000);
    expect(elapsedMs(stopped, 4_000)).toBe(3_000);
    expect(elapsedMs(stopped, 1_000_000)).toBe(3_000);
  });

  it("adds up a call that dropped and came back", () => {
    let state: ElapsedState = NO_ELAPSED;
    state = startSpan(state, 0);
    state = stopSpan(state, 10_000); // ten seconds, then the link died
    state = startSpan(state, 60_000); // fifty seconds later it recovered
    expect(elapsedMs(state, 75_000)).toBe(25_000);
    // The fifty seconds it was NOT live are not the meeting.
    expect(elapsedMs(state, 75_000)).not.toBe(75_000);
  });

  it("ignores a reading taken before the open stretch began", () => {
    expect(elapsedMs(startSpan(NO_ELAPSED, 5_000), 1_000)).toBe(0);
  });
});

describe("elapsedSeconds", () => {
  it("floors rather than rounds", () => {
    // 00:01 before a second has passed is claiming time that has not happened.
    expect(elapsedSeconds(startSpan(NO_ELAPSED, 0), 999)).toBe(0);
    expect(elapsedSeconds(startSpan(NO_ELAPSED, 0), 1_999)).toBe(1);
  });

  it("loses nothing over a long meeting, however the caller is scheduled", () => {
    // The failure this module exists to prevent. A counter incremented once per
    // callback lands on the NUMBER OF CALLBACKS; the span lands on the time.
    const state = startSpan(NO_ELAPSED, 0);
    const oneHour = 60 * 60 * 1000;

    // Simulate a loaded main thread: the tick that should fire every second
    // actually fires every 1400ms, which is what contention looks like.
    let counter = 0;
    for (let t = 1_400; t <= oneHour; t += 1_400) counter += 1;

    expect(elapsedSeconds(state, oneHour)).toBe(3_600);
    expect(counter).toBeLessThan(2_600);
    // Over an hour, the counter is more than sixteen minutes short.
    expect(elapsedSeconds(state, oneHour) - counter).toBeGreaterThan(1_000);
  });
});

describe("formatElapsed", () => {
  it("shows mm:ss under an hour", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(9)).toBe("00:09");
    expect(formatElapsed(70)).toBe("01:10");
    expect(formatElapsed(3_599)).toBe("59:59");
  });

  it("grows an hours field rather than showing 60+ minutes", () => {
    expect(formatElapsed(3_600)).toBe("1:00:00");
    expect(formatElapsed(3_661)).toBe("1:01:01");
    expect(formatElapsed(36_000)).toBe("10:00:00");
  });

  it("reads a nonsense input as zero", () => {
    expect(formatElapsed(-5)).toBe("00:00");
    expect(formatElapsed(Number.NaN)).toBe("00:00");
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe("00:00");
  });
});

describe("monotonicNow", () => {
  it("only goes forward", () => {
    const a = monotonicNow();
    const b = monotonicNow();
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it("returns a finite number even where performance.now is missing", () => {
    const original = global.performance;
    // @ts-expect-error — deliberately removing it to exercise the fallback.
    delete global.performance;
    try {
      expect(Number.isFinite(monotonicNow())).toBe(true);
    } finally {
      global.performance = original;
    }
  });
});
