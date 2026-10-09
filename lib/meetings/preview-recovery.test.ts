// Bounding how often the green room goes back for a preview device that ended.
//
// Written against a review finding on the reopen itself: a device that opens
// and then ends on its own, over and over, was reopened every time for as long
// as a guest sat waiting.

import {
  FRESH_LEDGER,
  PREVIEW_REOPEN_LIMIT,
  PREVIEW_STABLE_MS,
  reopenAfterEnded,
  trackOpened,
  type ReopenLedger,
} from "./preview-recovery";

const T0 = 1_000_000;

/** A track adopted at `at`, ending now. */
function endedAfter(ledger: ReopenLedger, openedAt: number, now: number) {
  return reopenAfterEnded(trackOpened(ledger, openedAt), now);
}

describe("the ordinary case", () => {
  it("reopens a device that ended once", () => {
    const { reopen, ledger } = endedAfter(FRESH_LEDGER, T0, T0 + 1_000);
    expect(reopen).toBe(true);
    expect(ledger.reopens).toBe(1);
    // The replacement is not open yet, so it has no lifetime to judge.
    expect(ledger.openedAt).toBeNull();
  });
});

describe("a device that keeps ending", () => {
  it("is reopened up to the limit and then left alone", () => {
    let ledger = FRESH_LEDGER;
    let now = T0;
    for (let i = 1; i <= PREVIEW_REOPEN_LIMIT; i++) {
      const next = endedAfter(ledger, now, now + 500);
      expect(next.reopen).toBe(true);
      expect(next.ledger.reopens).toBe(i);
      ledger = next.ledger;
      now += 1_000;
    }
    const over = endedAfter(ledger, now, now + 500);
    expect(over.reopen).toBe(false);
  });

  // Over the limit nothing is recorded: the ledger is handed back unchanged,
  // so a deliberate retry, which resets it, is the only way back in.
  it("does not count attempts it refused", () => {
    const spent: ReopenLedger = { reopens: PREVIEW_REOPEN_LIMIT, openedAt: T0 };
    const { ledger } = reopenAfterEnded(spent, T0 + 500);
    expect(ledger).toEqual(spent);
  });
});

describe("a device that worked for a while", () => {
  // A track that lasted the stable period was a working device. Its ending
  // is a new event, not the next turn of the same cycle.
  it("starts the count over once a replacement has stayed up long enough", () => {
    const spent: ReopenLedger = { reopens: PREVIEW_REOPEN_LIMIT, openedAt: null };
    const { reopen, ledger } = endedAfter(spent, T0, T0 + PREVIEW_STABLE_MS);
    expect(reopen).toBe(true);
    expect(ledger.reopens).toBe(1);
  });

  it("does not start over for a replacement that fell just short", () => {
    const spent: ReopenLedger = { reopens: PREVIEW_REOPEN_LIMIT, openedAt: null };
    const { reopen } = endedAfter(spent, T0, T0 + PREVIEW_STABLE_MS - 1);
    expect(reopen).toBe(false);
  });
});

describe("the numbers", () => {
  it("allows a few reopens, not many", () => {
    expect(PREVIEW_REOPEN_LIMIT).toBeGreaterThanOrEqual(2);
    expect(PREVIEW_REOPEN_LIMIT).toBeLessThanOrEqual(5);
  });

  it("calls a device stable after well under a minute", () => {
    expect(PREVIEW_STABLE_MS).toBeLessThanOrEqual(60_000);
    expect(PREVIEW_STABLE_MS).toBeGreaterThanOrEqual(10_000);
  });
});
