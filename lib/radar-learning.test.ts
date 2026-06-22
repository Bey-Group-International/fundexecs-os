// lib/radar-learning.test.ts
// Unit tests for the pure Radar learning loop — the bounded, explainable adjustment
// that tunes the Source Radar from operator accept/dismiss/snooze feedback. No DB.
import {
  aggregateDelta,
  applyLearnedAdjustment,
  computeLearnedWeights,
  outcomeDelta,
  weightKey,
  MIN_FEEDBACK,
  MAX_ADJUSTMENT,
  MIN_OUTCOME_ACCEPTED,
  type RadarAggregate,
  type EngagementAggregate,
  type OutcomeAggregate,
} from "@/lib/radar-learning";

const agg = (over: Partial<RadarAggregate> = {}): RadarAggregate => ({
  entityKind: "company",
  moveKind: "buyers",
  accepted: 0,
  dismissed: 0,
  snoozed: 0,
  ...over,
});

const eng = (over: Partial<EngagementAggregate> = {}): EngagementAggregate => ({
  entityKind: "company",
  moveKind: "buyers",
  clicked: 0,
  opened: 0,
  ...over,
});

const out = (over: Partial<OutcomeAggregate> = {}): OutcomeAggregate => ({
  moveKind: "buyers",
  accepted: 0,
  mandate: 0,
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

// ===========================================================================
// Implicit engagement (digest opens + clicks) — the second arg to the loop.
// ===========================================================================

describe("aggregateDelta (implicit engagement)", () => {
  it("is byte-identical to the prior behavior when no engagement is passed", () => {
    // Regression guard: omitting engagement must equal the explicit-only result.
    const cases: RadarAggregate[] = [
      agg({ accepted: 3 }),
      agg({ accepted: 10 }),
      agg({ dismissed: 10 }),
      agg({ accepted: 6, snoozed: 6 }),
      agg({ accepted: 8, dismissed: 2 }),
    ];
    for (const c of cases) {
      expect(aggregateDelta(c, null)).toBe(aggregateDelta(c));
      expect(aggregateDelta(c, undefined)).toBe(aggregateDelta(c));
      expect(aggregateDelta(c, eng({ clicked: 0, opened: 0 }))).toBe(aggregateDelta(c));
    }
  });

  it("nudges a neutral explicit bucket UP when clicks pile on", () => {
    const base = agg({ accepted: 5, dismissed: 5 }); // neutral → 0
    expect(aggregateDelta(base)).toBe(0);
    const withClicks = aggregateDelta(base, eng({ clicked: 8 }));
    expect(withClicks).toBeGreaterThan(0);
  });

  it("weights a click more strongly than an open", () => {
    const base = agg({ accepted: 5, dismissed: 5 });
    const clickPush = aggregateDelta(base, eng({ clicked: 8 }));
    const openPush = aggregateDelta(base, eng({ opened: 8 }));
    expect(clickPush).toBeGreaterThan(openPush);
    expect(openPush).toBeGreaterThanOrEqual(0);
  });

  it("never manufactures a negative — engagement is positive-only", () => {
    const dismissals = agg({ accepted: 0, dismissed: 10 });
    const withOpens = aggregateDelta(dismissals, eng({ opened: 4 }));
    // Opens can only soften a negative, never push it below the dismiss-only floor.
    expect(withOpens).toBeGreaterThanOrEqual(aggregateDelta(dismissals));
    expect(withOpens).toBeLessThanOrEqual(0);
  });

  it("can lift a thin bucket over the confidence floor on engagement alone", () => {
    // 1 explicit accept (below MIN_FEEDBACK) but plenty of clicks → clears floor.
    const thin = agg({ accepted: 1 });
    expect(aggregateDelta(thin)).toBe(0);
    const lifted = aggregateDelta(thin, eng({ clicked: 12 }));
    expect(lifted).toBeGreaterThan(0);
  });

  it("respects the confidence floor for weak opens", () => {
    // A couple of opens (fractional weight) on an empty bucket stays under floor.
    expect(aggregateDelta(agg(), eng({ opened: 3 }))).toBe(0);
  });

  it("stays clamped to ±MAX_ADJUSTMENT with extreme engagement", () => {
    const d = aggregateDelta(agg({ accepted: 50 }), eng({ clicked: 1000, opened: 1000 }));
    expect(d).toBeLessThanOrEqual(MAX_ADJUSTMENT);
    expect(d).toBeGreaterThanOrEqual(-MAX_ADJUSTMENT);
  });
});

describe("computeLearnedWeights (with engagement)", () => {
  it("is byte-identical to the 1-arg call when engagement is empty/absent", () => {
    const input = [
      agg({ entityKind: "company", moveKind: "buyers", accepted: 10 }),
      agg({ entityKind: "investor", moveKind: "outreach", dismissed: 10 }),
    ];
    expect(computeLearnedWeights(input)).toEqual(computeLearnedWeights(input, []));
    expect(computeLearnedWeights(input)).toEqual(computeLearnedWeights(input, null));
    expect(computeLearnedWeights(input)).toEqual(computeLearnedWeights(input, undefined));
  });

  it("joins engagement onto the matching explicit bucket", () => {
    const explicit = [agg({ entityKind: "company", moveKind: "buyers", accepted: 5, dismissed: 5 })];
    const base = computeLearnedWeights(explicit);
    expect(base.deltas[weightKey("company", "buyers")]).toBeUndefined(); // neutral → omitted

    const tuned = computeLearnedWeights(explicit, [eng({ clicked: 10 })]);
    expect(tuned.active).toBe(true);
    expect(tuned.deltas[weightKey("company", "buyers")]).toBeGreaterThan(0);
  });

  it("scores an engagement-only bucket (no explicit feedback yet)", () => {
    const tuned = computeLearnedWeights(
      [],
      [eng({ entityKind: "fund", moveKind: "signals", clicked: 12 })],
    );
    expect(tuned.deltas[weightKey("fund", "signals")]).toBeGreaterThan(0);
  });

  it("is deterministic with engagement", () => {
    const explicit = [agg({ accepted: 8, dismissed: 2 })];
    const engagement = [eng({ clicked: 4, opened: 6 })];
    expect(computeLearnedWeights(explicit, engagement)).toEqual(
      computeLearnedWeights(explicit, engagement),
    );
  });
});

// ===========================================================================
// Real-outcome attribution (accepted → mandate conversion) — the third arg.
// This is the signal driven by lib/radar-attribution.ts, keyed by move_kind only.
// ===========================================================================

describe("outcomeDelta (confidence floor)", () => {
  it("makes no adjustment below the accepted floor", () => {
    // Even a perfect conversion can't move the ranking on too-few accepts.
    expect(outcomeDelta(out({ accepted: MIN_OUTCOME_ACCEPTED - 1, mandate: 1 }))).toBe(0);
  });
  it("starts adjusting once the accepted floor is cleared", () => {
    expect(outcomeDelta(out({ accepted: MIN_OUTCOME_ACCEPTED, mandate: 2 }))).toBeGreaterThan(0);
  });
});

describe("outcomeDelta (direction)", () => {
  it("boosts a move_kind that genuinely converts to mandates", () => {
    const d = outcomeDelta(out({ accepted: 10, mandate: 9 }));
    expect(d).toBeGreaterThan(0);
  });
  it("damps a move_kind that fizzles (real volume, zero mandates)", () => {
    const d = outcomeDelta(out({ accepted: 20, mandate: 0 }));
    expect(d).toBeLessThan(0);
  });
  it("is ~neutral at the baseline conversion", () => {
    // ~15% conversion sits at the neutral baseline → no meaningful push.
    const d = outcomeDelta(out({ accepted: 20, mandate: 3 }));
    expect(Math.abs(d)).toBeLessThanOrEqual(1);
  });
  it("never lets a perfect conversion exceed its own band", () => {
    const d = outcomeDelta(out({ accepted: 100, mandate: 100 }));
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(MAX_ADJUSTMENT);
  });
  it("clamps dirty data where mandate exceeds accepted", () => {
    const d = outcomeDelta(out({ accepted: 5, mandate: 50 }));
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(MAX_ADJUSTMENT);
  });
});

describe("computeLearnedWeights (with outcomes)", () => {
  it("is byte-identical to the 2-arg call when outcomes are empty/absent (regression)", () => {
    const explicit = [
      agg({ entityKind: "company", moveKind: "buyers", accepted: 10 }),
      agg({ entityKind: "investor", moveKind: "outreach", dismissed: 10 }),
    ];
    const engagement = [eng({ clicked: 4 })];
    // No outcomes arg, undefined, null, and [] must all equal the prior 2-arg output.
    expect(computeLearnedWeights(explicit, engagement)).toEqual(
      computeLearnedWeights(explicit, engagement, undefined),
    );
    expect(computeLearnedWeights(explicit, engagement)).toEqual(
      computeLearnedWeights(explicit, engagement, null),
    );
    expect(computeLearnedWeights(explicit, engagement)).toEqual(
      computeLearnedWeights(explicit, engagement, []),
    );
    // And the 1-arg call is unchanged by an empty outcomes arg too.
    expect(computeLearnedWeights(explicit)).toEqual(
      computeLearnedWeights(explicit, null, []),
    );
  });

  it("boosts every entity_kind sharing a high-converting move_kind", () => {
    // Two entity_kinds, both on move_kind "buyers", neutral explicit feedback.
    const explicit = [
      agg({ entityKind: "company", moveKind: "buyers", accepted: 5, dismissed: 5 }),
      agg({ entityKind: "investor", moveKind: "buyers", accepted: 5, dismissed: 5 }),
    ];
    const base = computeLearnedWeights(explicit);
    expect(base.deltas[weightKey("company", "buyers")]).toBeUndefined();
    expect(base.deltas[weightKey("investor", "buyers")]).toBeUndefined();

    const tuned = computeLearnedWeights(explicit, null, [
      out({ moveKind: "buyers", accepted: 10, mandate: 9 }),
    ]);
    expect(tuned.active).toBe(true);
    // The single move_kind outcome lifts BOTH entity_kinds that share it.
    expect(tuned.deltas[weightKey("company", "buyers")]).toBeGreaterThan(0);
    expect(tuned.deltas[weightKey("investor", "buyers")]).toBeGreaterThan(0);
  });

  it("damps a fizzling move_kind below its neutral feedback", () => {
    const explicit = [agg({ entityKind: "company", moveKind: "buyers", accepted: 5, dismissed: 5 })];
    const tuned = computeLearnedWeights(explicit, null, [
      out({ moveKind: "buyers", accepted: 20, mandate: 0 }),
    ]);
    expect(tuned.deltas[weightKey("company", "buyers")]).toBeLessThan(0);
  });

  it("does not introduce an outcome-only key (no feedback, no engagement)", () => {
    // An outcome for a move_kind nothing else surfaces has no key to attach to.
    const tuned = computeLearnedWeights([], null, [
      out({ moveKind: "research", accepted: 20, mandate: 18 }),
    ]);
    expect(tuned.deltas[weightKey("company", "research")]).toBeUndefined();
    expect(Object.keys(tuned.deltas)).toEqual([]);
    expect(tuned.active).toBe(false);
  });

  it("does nothing below the outcome confidence floor", () => {
    const explicit = [agg({ entityKind: "company", moveKind: "buyers", accepted: 5, dismissed: 5 })];
    const base = computeLearnedWeights(explicit);
    const tuned = computeLearnedWeights(explicit, null, [
      out({ moveKind: "buyers", accepted: MIN_OUTCOME_ACCEPTED - 1, mandate: 3 }),
    ]);
    expect(tuned).toEqual(base); // floor not cleared → outcome is a no-op
  });

  it("stays clamped to ±MAX_ADJUSTMENT when stacked with feedback + engagement", () => {
    // Strong accepts (+MAX) + heavy clicks + perfect conversion → still capped.
    const explicit = [agg({ entityKind: "company", moveKind: "buyers", accepted: 50 })];
    const engagement = [eng({ entityKind: "company", moveKind: "buyers", clicked: 100, opened: 100 })];
    const outcomes = [out({ moveKind: "buyers", accepted: 100, mandate: 100 })];
    const tuned = computeLearnedWeights(explicit, engagement, outcomes);
    const d = tuned.deltas[weightKey("company", "buyers")];
    expect(d).toBe(MAX_ADJUSTMENT);

    // And a fully damping outcome on a fully negative feedback stays at -MAX.
    const neg = computeLearnedWeights(
      [agg({ entityKind: "company", moveKind: "buyers", dismissed: 50 })],
      null,
      [out({ moveKind: "buyers", accepted: 50, mandate: 0 })],
    );
    expect(neg.deltas[weightKey("company", "buyers")]).toBe(-MAX_ADJUSTMENT);
  });

  it("is deterministic with outcomes", () => {
    const explicit = [agg({ accepted: 5, dismissed: 5 })];
    const engagement = [eng({ clicked: 2 })];
    const outcomes = [out({ moveKind: "buyers", accepted: 12, mandate: 7 })];
    expect(computeLearnedWeights(explicit, engagement, outcomes)).toEqual(
      computeLearnedWeights(explicit, engagement, outcomes),
    );
  });

  it("sums duplicate move_kind outcome buckets before scoring", () => {
    const explicit = [agg({ entityKind: "company", moveKind: "buyers", accepted: 5, dismissed: 5 })];
    const merged = computeLearnedWeights(explicit, null, [
      out({ moveKind: "buyers", accepted: 6, mandate: 5 }),
      out({ moveKind: "buyers", accepted: 6, mandate: 5 }),
    ]);
    const single = computeLearnedWeights(explicit, null, [
      out({ moveKind: "buyers", accepted: 12, mandate: 10 }),
    ]);
    expect(merged.deltas[weightKey("company", "buyers")]).toBe(
      single.deltas[weightKey("company", "buyers")],
    );
  });
});
