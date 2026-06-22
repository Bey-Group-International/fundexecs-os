// lib/sourcing-signals.test.ts
// Unit tests for the pure helpers behind Signals & Triggers — the deterministic
// propensity score (likelihood-to-sell / likelihood-to-raise), the signal
// summarizer, the tone buckets, and the deterministic fallback generator. No DB,
// no model key.
import { __test, SIGNAL_TYPES, type SignalType } from "@/lib/sourcing-signals";

const { propensityScore, summarizeSignals, signalTone, fallbackSignals, compound } = __test;

const sig = (signalType: SignalType, strength: number) => ({ signalType, strength });

describe("propensityScore", () => {
  it("returns zero for no signals", () => {
    expect(propensityScore(null, [])).toEqual({ sell: 0, raise: 0 });
  });

  it("is deterministic — same input, same output", () => {
    const signals = [sig("sale_intent", 80), sig("ownership_change", 60)];
    expect(propensityScore({ kind: "company" }, signals)).toEqual(
      propensityScore({ kind: "company" }, signals),
    );
  });

  it("scores sale_intent toward sell, raise_intent toward raise", () => {
    const sell = propensityScore(null, [sig("sale_intent", 90)]);
    expect(sell.sell).toBeGreaterThan(sell.raise);
    expect(sell.sell).toBeGreaterThanOrEqual(66);

    const raise = propensityScore(null, [sig("raise_intent", 90)]);
    expect(raise.raise).toBeGreaterThan(raise.sell);
    expect(raise.raise).toBeGreaterThanOrEqual(66);
  });

  it("a fresh funding round lifts raise and dampens sell", () => {
    const p = propensityScore(null, [sig("funding_round", 90)]);
    expect(p.raise).toBeGreaterThan(0);
    expect(p.sell).toBe(0); // negative sell weight floors at 0
  });

  it("stays within 0–100", () => {
    const all = SIGNAL_TYPES.map((t) => sig(t, 100));
    const p = propensityScore(null, all);
    expect(p.sell).toBeGreaterThanOrEqual(0);
    expect(p.sell).toBeLessThanOrEqual(100);
    expect(p.raise).toBeGreaterThanOrEqual(0);
    expect(p.raise).toBeLessThanOrEqual(100);
  });

  it("stronger signals score higher than weaker ones of the same type", () => {
    const weak = propensityScore(null, [sig("sale_intent", 20)]);
    const strong = propensityScore(null, [sig("sale_intent", 95)]);
    expect(strong.sell).toBeGreaterThan(weak.sell);
  });

  it("ignores unknown signal types", () => {
    const p = propensityScore(null, [
      sig("sale_intent", 80),
      { signalType: "bogus" as SignalType, strength: 100 },
    ]);
    expect(p).toEqual(propensityScore(null, [sig("sale_intent", 80)]));
  });
});

describe("compound", () => {
  it("diminishes returns — ten weak signals never beat one strong", () => {
    const oneStrong = compound([0.9]);
    const manyWeak = compound(Array(10).fill(0.1));
    expect(oneStrong).toBeGreaterThan(manyWeak);
  });

  it("clamps to 0–100", () => {
    expect(compound([1, 1, 1, 1])).toBeLessThanOrEqual(100);
    expect(compound([-1, -1])).toBeGreaterThanOrEqual(0);
  });
});

describe("signalTone", () => {
  it("buckets scores into hot/warm/cool", () => {
    expect(signalTone(80)).toBe("hot");
    expect(signalTone(50)).toBe("warm");
    expect(signalTone(10)).toBe("cool");
  });
  it("uses inclusive thresholds at the boundaries", () => {
    expect(signalTone(66)).toBe("hot");
    expect(signalTone(33)).toBe("warm");
    expect(signalTone(32)).toBe("cool");
  });
});

describe("summarizeSignals", () => {
  it("reports an empty bundle", () => {
    expect(summarizeSignals([])).toBe("No signals yet.");
  });

  it("leads with the stronger propensity and lists top types", () => {
    const out = summarizeSignals([sig("sale_intent", 90), sig("ownership_change", 70)]);
    expect(out).toMatch(/Leaning sell/);
    expect(out).toMatch(/Sale intent/);
  });

  it("counts repeated types", () => {
    const out = summarizeSignals([sig("hiring", 60), sig("hiring", 70), sig("raise_intent", 80)]);
    expect(out).toMatch(/Hiring surge ×2/);
  });
});

describe("fallbackSignals", () => {
  it("returns nothing for a nameless entity", () => {
    expect(fallbackSignals({ name: "" })).toEqual([]);
  });

  it("is deterministic per subject", () => {
    const a = fallbackSignals({ name: "Acme Industrial", kind: "company" });
    const b = fallbackSignals({ name: "Acme Industrial", kind: "company" });
    expect(a).toEqual(b);
  });

  it("produces 2–3 valid signals carrying the subject + kind", () => {
    const out = fallbackSignals({ name: "Northwind Capital", kind: "investor", entityId: "e1" });
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThanOrEqual(3);
    for (const s of out) {
      expect(SIGNAL_TYPES).toContain(s.signalType);
      expect(s.subjectName).toBe("Northwind Capital");
      expect(s.kind).toBe("investor");
      expect(s.entityId).toBe("e1");
      expect(s.strength).toBeGreaterThanOrEqual(0);
      expect(s.strength).toBeLessThanOrEqual(100);
    }
  });

  it("tailors signal types to the entity kind", () => {
    const investor = fallbackSignals({ name: "Fund X", kind: "fund" });
    // funds should never surface company-only sale_intent in the deterministic profile
    expect(investor.every((s) => s.signalType !== "sale_intent")).toBe(true);
  });
});
