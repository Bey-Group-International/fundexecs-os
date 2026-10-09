// Whether a member is told that their words are not being saved.
//
// Written against a client that retried a refused save every thirty seconds
// for the whole meeting, silently, while telling the room it was covered.

import { SAVE_FAILURES_BEFORE_NOTICE, saveFailureNotice, savesCovered } from "./transcript-saving";

describe("a blip", () => {
  it("says nothing for the first failures", () => {
    for (let n = 0; n < SAVE_FAILURES_BEFORE_NOTICE; n++) {
      expect(saveFailureNotice(n, 500)).toBeNull();
      expect(savesCovered(n)).toBe(true);
    }
  });
});

describe("a save that keeps failing", () => {
  it("is reported, and the member is no longer counted as covered", () => {
    expect(saveFailureNotice(SAVE_FAILURES_BEFORE_NOTICE, 500)).toMatch(/aren't reaching the transcript/);
    expect(savesCovered(SAVE_FAILURES_BEFORE_NOTICE)).toBe(false);
  });

  // The remedy that works for an expired session or a refused participant
  // check is a rejoin; "saving failed" would leave them waiting for a retry
  // that can never succeed.
  it("tells an auth refusal to rejoin", () => {
    for (const status of [401, 403]) {
      expect(saveFailureNotice(SAVE_FAILURES_BEFORE_NOTICE, status)).toMatch(/rejoin/i);
    }
  });

  it("does not tell a server error to rejoin", () => {
    expect(saveFailureNotice(SAVE_FAILURES_BEFORE_NOTICE, 503)).not.toMatch(/rejoin/i);
    expect(saveFailureNotice(SAVE_FAILURES_BEFORE_NOTICE, null)).not.toMatch(/rejoin/i);
  });

  it("needs more than one failure, and not many", () => {
    expect(SAVE_FAILURES_BEFORE_NOTICE).toBeGreaterThanOrEqual(2);
    expect(SAVE_FAILURES_BEFORE_NOTICE).toBeLessThanOrEqual(5);
  });
});
