import { ADMISSION_POLL_SCHEDULE, WATCHED_POLL_SCHEDULE, nextPollDelay, pollCount, shouldPollNow,
  REFUSAL_BACKOFF_MS,
  admissionStatusFromResponse,
  refusalDelay,
  retryAfterMs,
} from "./admission-poll";

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

describe("what an answer from the status endpoint means", () => {
  it("passes a real verdict through", () => {
    expect(admissionStatusFromResponse(200, { status: "admitted" })).toBe("admitted");
    expect(admissionStatusFromResponse(200, { status: "denied" })).toBe("denied");
    expect(admissionStatusFromResponse(200, { status: "waiting" })).toBe("waiting");
  });

  // The one non-OK response that is an answer rather than an accident. A guest
  // whose host cancelled the meeting used to watch a spinner for ten minutes.
  it("treats a meeting that is not there as ended", () => {
    expect(admissionStatusFromResponse(404, null)).toBe("ended");
  });

  // "Slower", not "never" — so it is not a verdict. But it is not nothing
  // either: no row was inserted, so the guest is in no queue, and reading it as
  // "no news" is what let the screen claim they were waiting on the host.
  it("names a refusal rather than calling it no news", () => {
    expect(admissionStatusFromResponse(429, null)).toBe("busy");
  });

  it("keeps waiting through a bad minute on the server", () => {
    expect(admissionStatusFromResponse(500, null)).toBeNull();
    expect(admissionStatusFromResponse(503, null)).toBeNull();
  });

  it("keeps waiting when the answer has no status in it", () => {
    expect(admissionStatusFromResponse(200, {})).toBeNull();
    expect(admissionStatusFromResponse(200, null)).toBeNull();
  });
});

// ── Backing off when the server says to ─────────────────────────────────────
//
// The waiting room used to read a 429 as "no news" and keep asking on the
// fastest cadence, which is exactly what kept a refused guest refused — while
// the limiter was sending Retry-After into a header nobody read.

describe("retryAfterMs", () => {
  it("reads the seconds our limiter sends", () => {
    expect(retryAfterMs("30")).toBe(30_000);
    expect(retryAfterMs(" 5 ")).toBe(5_000);
  });

  it("has no opinion when the header is missing or unusable", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs(undefined)).toBeNull();
    expect(retryAfterMs("")).toBeNull();
    // An HTTP-date is legal in the spec and is not what we send; rather than
    // half-parse it, fall through to our own ladder.
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    expect(retryAfterMs("-1")).toBeNull();
  });

  // "The window just turned" is not permission to ask again this instant.
  it("treats zero as no guidance rather than as go-ahead", () => {
    expect(retryAfterMs("0")).toBeNull();
  });

  it("will not be talked into waiting for hours", () => {
    expect(retryAfterMs("86400")).toBe(5 * 60_000);
  });
});

describe("refusalDelay", () => {
  it("lengthens with each consecutive refusal, then holds", () => {
    const ladder = [1, 2, 3, 4, 5, 9].map((n) => refusalDelay(n));
    expect(ladder).toEqual([...REFUSAL_BACKOFF_MS, REFUSAL_BACKOFF_MS[3], REFUSAL_BACKOFF_MS[3]]);
  });

  // The whole point of the fix: whatever we back off to must be slower than the
  // 1.5s cadence that was keeping the guest refused.
  it("is always slower than the fastest poll cadence", () => {
    for (let n = 1; n <= 6; n += 1) expect(refusalDelay(n)).toBeGreaterThan(1_500);
  });

  it("defers to the server when it said longer", () => {
    expect(refusalDelay(1, 45_000)).toBe(45_000);
  });

  // The ladder is the floor: a server that says "come back in one second" is
  // still a server that just refused us.
  it("keeps its own floor when the server said less", () => {
    expect(refusalDelay(3, 1_000)).toBe(REFUSAL_BACKOFF_MS[2]);
  });

  it("ignores a missing or nonsensical server answer", () => {
    expect(refusalDelay(2, null)).toBe(REFUSAL_BACKOFF_MS[1]);
    expect(refusalDelay(2, 0)).toBe(REFUSAL_BACKOFF_MS[1]);
  });
});
