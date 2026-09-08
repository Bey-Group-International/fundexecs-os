import { ADMISSION_POLL_SCHEDULE, WATCHED_POLL_SCHEDULE, nextPollDelay, pollCount, shouldPollNow } from "./admission-poll";

describe("nextPollDelay", () => {
  it("asks fastest in the first seconds, where the host usually answers", () => {
    expect(nextPollDelay(0)).toBe(1_500);
    expect(nextPollDelay(19_999)).toBe(1_500);
  });

  it("widens as the wait goes on", () => {
    expect(nextPollDelay(20_000)).toBe(3_000);
    expect(nextPollDelay(60_000)).toBe(6_000);
    expect(nextPollDelay(180_000)).toBe(10_000);
    expect(nextPollDelay(60 * 60_000)).toBe(10_000);
  });

  it("never speeds back up", () => {
    let last = 0;
    for (let t = 0; t <= 300_000; t += 1_000) {
      const d = nextPollDelay(t);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });

  it("is defined at every boundary in the schedule", () => {
    for (const step of ADMISSION_POLL_SCHEDULE) {
      expect(nextPollDelay(step.afterMs)).toBe(step.everyMs);
    }
  });

  it("treats a negative elapsed time as the start of the wait", () => {
    expect(nextPollDelay(-1)).toBe(1_500);
  });
});

describe("the trade this schedule makes", () => {
  // The point is not "fewer requests" on its own — it is fewer requests on the
  // long waits that do not need them, and MORE in the first seconds that do.
  it("polls more often than a flat 3s over the first 20 seconds", () => {
    expect(pollCount(20_000)).toBeGreaterThan(Math.floor(20_000 / 3_000));
  });

  it("polls less than a flat 3s over a five-minute wait", () => {
    expect(pollCount(300_000)).toBeLessThan(Math.floor(300_000 / 3_000));
  });

  it("roughly halves the requests of a flat 3s over ten minutes", () => {
    const flat = Math.floor(600_000 / 3_000);
    expect(pollCount(600_000)).toBeLessThan(flat * 0.6);
  });
});

describe("shouldPollNow", () => {
  it("polls a visible tab", () => {
    expect(shouldPollNow("visible")).toBe(true);
  });

  it("skips a hidden tab — the decision keeps until they come back", () => {
    expect(shouldPollNow("hidden")).toBe(false);
  });

  // Non-browser and older environments report nothing; those must still poll.
  it("polls when visibility is unknown", () => {
    expect(shouldPollNow(undefined)).toBe(true);
  });
});

describe("WATCHED_POLL_SCHEDULE", () => {
  // With a nudge arriving on a broadcast, the poll is a safety net for a push
  // that never came — so it must be much cheaper, without being absent.
  it("is far slower than the unwatched schedule at every point", () => {
    for (const t of [0, 10_000, 30_000, 90_000, 400_000]) {
      expect(nextPollDelay(t, WATCHED_POLL_SCHEDULE)).toBeGreaterThan(nextPollDelay(t));
    }
  });

  it("still asks, so a guest whose socket died is not stranded", () => {
    expect(nextPollDelay(0, WATCHED_POLL_SCHEDULE)).toBeLessThanOrEqual(15_000);
  });

  it("widens as the wait goes on, like the other one", () => {
    expect(nextPollDelay(0, WATCHED_POLL_SCHEDULE)).toBe(15_000);
    expect(nextPollDelay(60_000, WATCHED_POLL_SCHEDULE)).toBe(30_000);
    expect(nextPollDelay(300_000, WATCHED_POLL_SCHEDULE)).toBe(60_000);
  });

  it("costs a fraction of the unwatched schedule over a five-minute wait", () => {
    expect(pollCount(300_000, WATCHED_POLL_SCHEDULE)).toBeLessThan(pollCount(300_000) / 4);
  });
});
