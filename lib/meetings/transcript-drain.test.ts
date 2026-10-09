// The last flush of a meeting, and what it does when a request fails.
//
// Written against two losses: a drain that gave up on the first failed POST
// and navigated away with everything else unsaved, and a remote `end` that
// never drained at all.

import {
  DRAIN_MAX_ROUNDS,
  DRAIN_RETRIES,
  PEER_DRAIN_GRACE_MS,
  drainRetryDelay,
  drainTranscript,
} from "./transcript-drain";

/** A server that answers each batch from a script, and a queue it drains. */
function harness(outcomes: boolean[], owed: number) {
  const calls: number[] = [];
  const sleeps: number[] = [];
  let pending = owed;
  return {
    calls, sleeps,
    pending: () => pending,
    flush: async () => {
      calls.push(pending);
      const ok = outcomes.shift() ?? true;
      if (ok) pending = Math.max(0, pending - 1);
      return ok;
    },
    sleep: async (ms: number) => { sleeps.push(ms); },
  };
}

describe("a drain that succeeds", () => {
  it("sends batches until nothing is owed", async () => {
    const h = harness([], 3);
    await expect(drainTranscript(h)).resolves.toBe(true);
    expect(h.calls).toEqual([3, 2, 1]);
    expect(h.sleeps).toEqual([]);
  });

  it("does nothing when nothing is owed", async () => {
    const h = harness([], 0);
    await expect(drainTranscript(h)).resolves.toBe(true);
    expect(h.calls).toEqual([]);
  });
});

describe("a drain that hits a failure", () => {
  // The case this exists for: one timed-out request on the way out.
  it("retries after a short pause and finishes", async () => {
    const h = harness([false, true, true], 2);
    await expect(drainTranscript(h)).resolves.toBe(true);
    expect(h.calls).toEqual([2, 2, 1]);
    expect(h.sleeps).toEqual([drainRetryDelay(1)]);
  });

  it("gives a batch that recovers a fresh budget", async () => {
    const h = harness([false, false, true, false, false, true], 2);
    await expect(drainTranscript(h)).resolves.toBe(true);
    expect(h.sleeps).toEqual([
      drainRetryDelay(1), drainRetryDelay(2),
      drainRetryDelay(1), drainRetryDelay(2),
    ]);
  });

  it("gives up after the retries are spent, saying so", async () => {
    const h = harness(Array(DRAIN_RETRIES).fill(false), 2);
    await expect(drainTranscript(h)).resolves.toBe(false);
    expect(h.calls).toHaveLength(DRAIN_RETRIES);
    expect(h.sleeps).toHaveLength(DRAIN_RETRIES - 1);
  });

  it("waits longer each time, but never long", () => {
    expect(drainRetryDelay(1)).toBeLessThan(drainRetryDelay(2));
    expect(drainRetryDelay(2)).toBeLessThan(drainRetryDelay(3));
    expect(drainRetryDelay(3)).toBeLessThanOrEqual(3_000);
    expect(drainRetryDelay(99)).toBe(drainRetryDelay(3));
  });
});

describe("the bounds", () => {
  it("stops after enough rounds to carry any meeting", async () => {
    const h = harness([], DRAIN_MAX_ROUNDS + 5);
    await expect(drainTranscript(h)).resolves.toBe(false);
    expect(h.calls).toHaveLength(DRAIN_MAX_ROUNDS);
  });

  // Long enough for a peer to settle (FINALIZE_WAIT_MS is 1.8 s) and send one
  // batch; short enough that the host is not left staring at "Ending…".
  it("gives peers a moment to drain, and no more", () => {
    expect(PEER_DRAIN_GRACE_MS).toBeGreaterThanOrEqual(2_000);
    expect(PEER_DRAIN_GRACE_MS).toBeLessThanOrEqual(4_000);
  });
});
