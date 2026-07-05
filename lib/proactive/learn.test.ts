// Tests for the learn loop — budget decay from dismissals, recovery from
// approvals, and the confidence floor.
import { learnedWeight, learnedWeights, emptyTally, tallyVerdict } from "./learn";
import { LEARNING } from "./config";

describe("learnedWeight", () => {
  it("stays neutral below the confidence floor", () => {
    expect(learnedWeight({ approved: 0, dismissed: 2, snoozed: 0 })).toBe(1.0);
  });

  it("decays a repeatedly-dismissed signal type toward the floor", () => {
    const w = learnedWeight({ approved: 0, dismissed: 5, snoozed: 0 });
    expect(w).toBeLessThan(1.0);
    expect(w).toBe(LEARNING.minWeight); // all-dismissed → clamped to floor
  });

  it("recovers a repeatedly-approved signal type toward the ceiling", () => {
    const w = learnedWeight({ approved: 5, dismissed: 0, snoozed: 0 });
    expect(w).toBeGreaterThan(1.0);
    expect(w).toBe(LEARNING.maxWeight);
  });

  it("counts a snooze as a fractional dismissal (soft negative)", () => {
    const allSnooze = learnedWeight({ approved: 0, dismissed: 0, snoozed: 4 });
    const allDismiss = learnedWeight({ approved: 0, dismissed: 4, snoozed: 0 });
    expect(allSnooze).toBeGreaterThan(allDismiss); // snooze hurts less
    expect(allSnooze).toBeLessThan(1.0);
  });

  it("never leaves the [minWeight, maxWeight] band", () => {
    const lo = learnedWeight({ approved: 0, dismissed: 100, snoozed: 0 });
    const hi = learnedWeight({ approved: 100, dismissed: 0, snoozed: 0 });
    expect(lo).toBeGreaterThanOrEqual(LEARNING.minWeight);
    expect(hi).toBeLessThanOrEqual(LEARNING.maxWeight);
  });

  it("a decayed weight suppresses items the operator keeps rejecting", () => {
    // With enough dismissals the multiplier drops a borderline item under cutoff.
    const decayed = learnedWeight({ approved: 1, dismissed: 6, snoozed: 0 });
    expect(decayed).toBeLessThan(1.0);
  });
});

describe("learnedWeights map", () => {
  it("aggregates decisions per trigger key", () => {
    const map = learnedWeights([
      { triggerKey: "cold_lp", verdict: "dismissed" },
      { triggerKey: "cold_lp", verdict: "dismissed" },
      { triggerKey: "cold_lp", verdict: "dismissed" },
      { triggerKey: "stale_mark", verdict: "approved" },
      { triggerKey: "stale_mark", verdict: "approved" },
      { triggerKey: "stale_mark", verdict: "approved" },
    ]);
    expect(map.cold_lp).toBeLessThan(1.0);
    expect(map.stale_mark).toBeGreaterThan(1.0);
  });
});

describe("tally helpers", () => {
  it("accumulates verdicts immutably", () => {
    let t = emptyTally();
    t = tallyVerdict(t, "approved");
    t = tallyVerdict(t, "dismissed");
    expect(t).toEqual({ approved: 1, dismissed: 1, snoozed: 0 });
  });
});
