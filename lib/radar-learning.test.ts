// lib/radar-learning.test.ts
// Unit tests for the pure Radar learning loop — the bounded, explainable adjustment
// that tunes the Source Radar from operator accept/dismiss/snooze feedback. No DB.
import {
  aggregateDelta,
  applyLearnedAdjustment,
  computeLearnedWeights,
  weightKey,
  MIN_FEEDBACK,
  MAX_ADJUSTMENT,
  type RadarAggregate,
} from "@/lib/radar-learning";

const agg = (over: Partial<RadarAggregate> = {}): RadarAggregate => ({
  entityKind: "company",
  moveKind: "buyers",
  accepted: 0,
  dismissed: 0,
  snoozed: 0,
  ...over,
});

describe("aggregateDelta (confidence floor)", () => {
  it("makes no adjustment below the feedback floor", () => {
    expect(aggregateDelta(agg({ accepted: MIN_FEEDBACK - 1 }))).toBe(0);
    expect(aggregateDelta(agg({ accepted: 1, dismissed: 1 }))).toBe(0);
  });
  it("starts adjusting once the floor is cleared", () => {
    expect(aggregateDelta(agg({ accepted: MIN_FEEDBACK }))).toBeGreaterThan(0);
  });
});

describe("aggregateDelta (direction)", () => {
  it("nudges up on consistent accepts", () => {
    const d = aggregateDelta(agg({ accepted: 10, dismissed: 0 }));
    expect(d).toBeGreaterThan(0);
    expect(d).toBe(MAX_ADJUSTMENT);
  });
  it("nudges down on consistent dismisses", () => {
    const d = aggregateDelta(agg({ accepted: 0, dismissed: 10 }));
    expect(d).toBeLessThan(0);
    expect(d).toBe(-MAX_ADJUSTMENT);
  });
  it("is ~neutral on an even split", () => {
    expect(aggregateDelta(agg({ accepted: 5, dismissed: 5 }))).toBe(0);
  });
  it("treats snoozes as mild negative signal (weaker than a dismiss)", () => {
    const withSnoozes = aggregateDelta(agg({ accepted: 6, snoozed: 6 }));
    const withDismisses = aggregateDelta(agg({ accepted: 6, dismissed: 6 }));
    expect(withSnoozes).toBeGreaterThan(withDismisses);
    expect(withSnoozes).toBeLessThan(MAX_ADJUSTMENT);
  });
});

describe("aggregateDelta (clamping bounds)", () => {
  it("never exceeds ±MAX_ADJUSTMENT in either direction", () => {
    const up = aggregateDelta(agg({ accepted: 1000 }));
    const down = aggregateDelta(agg({ dismissed: 1000 }));
    expect(up).toBeLessThanOrEqual(MAX_ADJUSTMENT);
    expect(down).toBeGreaterThanOrEqual(-MAX_ADJUSTMENT);
  });
});

describe("computeLearnedWeights", () => {
  it("omits buckets below the floor and flags inactive", () => {
    const w = computeLearnedWeights([agg({ accepted: 2 })]);
    expect(w.active).toBe(false);
    expect(w.deltas).toEqual({});
  });
  it("keys deltas by entityKind:moveKind and flags active", () => {
    const w = computeLearnedWeights([
      agg({ entityKind: "company", moveKind: "buyers", accepted: 10 }),
      agg({ entityKind: "investor", moveKind: "outreach", dismissed: 10 }),
    ]);
    expect(w.active).toBe(true);
    expect(w.deltas[weightKey("company", "buyers")]).toBe(MAX_ADJUSTMENT);
    expect(w.deltas[weightKey("investor", "outreach")]).toBe(-MAX_ADJUSTMENT);
  });
  it("is deterministic (same input → same output)", () => {
    const input = [agg({ accepted: 8, dismissed: 2 }), agg({ entityKind: "fund", moveKind: "signals", dismissed: 6 })];
    expect(computeLearnedWeights(input)).toEqual(computeLearnedWeights(input));
  });
});

describe("applyLearnedAdjustment", () => {
  const w = computeLearnedWeights([
    agg({ entityKind: "company", moveKind: "buyers", accepted: 10 }),
    agg({ entityKind: "investor", moveKind: "outreach", dismissed: 10 }),
  ]);

  it("leaves the base score unchanged with no weights", () => {
    expect(applyLearnedAdjustment(50, "company", "buyers", null)).toBe(50);
    expect(applyLearnedAdjustment(50, "company", "buyers", undefined)).toBe(50);
  });
  it("leaves the base score unchanged for an unseen combo", () => {
    expect(applyLearnedAdjustment(50, "advisor", "research", w)).toBe(50);
  });
  it("raises the score for an accepted combo", () => {
    expect(applyLearnedAdjustment(50, "company", "buyers", w)).toBe(50 + MAX_ADJUSTMENT);
  });
  it("lowers the score for a dismissed combo", () => {
    expect(applyLearnedAdjustment(50, "investor", "outreach", w)).toBe(50 - MAX_ADJUSTMENT);
  });
  it("clamps the adjusted score to 0–100", () => {
    expect(applyLearnedAdjustment(98, "company", "buyers", w)).toBe(100);
    expect(applyLearnedAdjustment(2, "investor", "outreach", w)).toBe(0);
  });
});
