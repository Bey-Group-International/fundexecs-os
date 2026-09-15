// Going back for a device the meeting started without.
//
// The rules here are about cost and about honesty: ask again for the failures
// that resolve on their own, stop asking for the one that cannot, and never
// build a loop that can only ever fail.

import {
  REACQUIRE_DELAYS_MS,
  REACQUIRE_GIVE_UP_MS,
  REACQUIRE_SETTLED_MS,
  reacquireDelay,
  shouldTryNow,
  watchFor,
} from "./device-reacquire";
import type { MediaFailure } from "./media-acquisition";

describe("what to do about a failure", () => {
  // The case this whole module exists for. A camera held by Zoom is free the
  // moment Zoom quits, and nothing else will tell us.
  it("goes back for a device something else was holding", () => {
    expect(watchFor("in_use")).toBe("poll");
  });

  it("goes back for an attempt that was merely interrupted", () => {
    expect(watchFor("aborted")).toBe("poll");
  });

  // A device can be plugged in. devicechange is the better signal and the room
  // listens for it, but it is not emitted reliably on every platform.
  it("goes back for hardware that was not there", () => {
    expect(watchFor("missing")).toBe("poll");
  });

  it("goes back for a failure it could not identify", () => {
    expect(watchFor("unknown")).toBe("poll");
  });

  // Asking again cannot re-prompt — a browser that has been told no rejects the
  // next call outright — so a poll here would be a loop that can never succeed.
  // The browser announces the change instead, and that is what to wait for.
  it("waits to be told about a refused permission rather than asking again", () => {
    expect(watchFor("denied")).toBe("permission");
  });

  // The one that looks retryable and is not: the device is present and working
  // and cannot do what was asked, so the identical request fails identically
  // for as long as the hardware is that hardware.
  it("does not go back for a device that cannot do what was asked", () => {
    expect(watchFor("overconstrained")).toBe("never");
  });

  it("has an answer for every failure the classifier can produce", () => {
    const all: MediaFailure[] = ["denied", "in_use", "missing", "overconstrained", "aborted", "unknown"];
    for (const failure of all) {
      expect(["poll", "permission", "never"]).toContain(watchFor(failure));
    }
  });
});

describe("the backoff", () => {
  it("asks quickly at first, because that is when the answer changes", () => {
    expect(reacquireDelay(0, 0)).toBe(2_000);
    expect(reacquireDelay(1, 2_000)).toBe(5_000);
  });

  it("widens, then settles rather than climbing forever", () => {
    const delays = REACQUIRE_DELAYS_MS.map((_, i) => reacquireDelay(i, 0));
    // Each step waits at least as long as the one before it.
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
    // Past the front-loaded attempts it holds steady: a meeting runs for hours,
    // and a device freed forty minutes in should still be picked up.
    expect(reacquireDelay(REACQUIRE_DELAYS_MS.length, 0)).toBe(REACQUIRE_SETTLED_MS);
    expect(reacquireDelay(REACQUIRE_DELAYS_MS.length + 50, 0)).toBe(REACQUIRE_SETTLED_MS);
  });

  it("stops once the member has plainly made their peace with it", () => {
    expect(reacquireDelay(9, REACQUIRE_GIVE_UP_MS)).toBeNull();
    expect(reacquireDelay(9, REACQUIRE_GIVE_UP_MS + 1)).toBeNull();
  });

  it("is still going just before the cutoff", () => {
    expect(reacquireDelay(9, REACQUIRE_GIVE_UP_MS - 1)).toBe(REACQUIRE_SETTLED_MS);
  });

  // Nonsense in, nothing out — rather than a zero-delay timer that spins.
  it("refuses a nonsensical attempt count instead of looping flat out", () => {
    expect(reacquireDelay(-1, 0)).toBeNull();
    expect(reacquireDelay(Number.NaN, 0)).toBeNull();
  });

  it("keeps trying when the clock is unreadable", () => {
    // A missing elapsed time must not be mistaken for "past the cutoff": that
    // would silently disable the whole mechanism.
    expect(reacquireDelay(0, Number.NaN)).toBe(2_000);
  });
});

describe("an event that changes the answer", () => {
  // The thing a backoff is bad at: somebody plugs a webcam in at second three,
  // and the next scheduled attempt was chosen assuming nothing had happened.
  it("tries at once when hardware appears", () => {
    expect(shouldTryNow("poll", "devicechange")).toBe(true);
  });

  it("tries at once when the member changes their mind about permission", () => {
    expect(shouldTryNow("permission", "permissionchange")).toBe(true);
  });

  // Waiting on a permission means no polling, so a device being plugged in is
  // not the event that unblocks this one — the refusal still stands.
  it("ignores new hardware while waiting on a permission", () => {
    expect(shouldTryNow("permission", "devicechange")).toBe(false);
  });

  // A device held elsewhere reports as denied on some browsers and in_use on
  // others, so a granted permission is worth acting on whichever way the first
  // failure was classified.
  it("tries at once on a permission change even when it was polling", () => {
    expect(shouldTryNow("poll", "permissionchange")).toBe(true);
  });

  it("stays stopped for a device that cannot do what was asked", () => {
    expect(shouldTryNow("never", "devicechange")).toBe(false);
    expect(shouldTryNow("never", "permissionchange")).toBe(false);
  });
});
