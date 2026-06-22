// lib/valuation-409a.test.ts — pure 409A fair-value engine, no I/O.
import { incomeValue, marketValue, conclude, markAsset, type ApproachResult } from "@/lib/valuation-409a";

describe("incomeValue", () => {
  it("capitalizes NOI at the cap rate", () => {
    expect(incomeValue(650_000, 6.5)).toBe(10_000_000); // 650k / 0.065
  });
  it("is null for a non-positive cap rate or NOI", () => {
    expect(incomeValue(650_000, 0)).toBeNull();
    expect(incomeValue(0, 6.5)).toBeNull();
  });
});

describe("marketValue", () => {
  it("applies the comp multiple and bridges off net debt", () => {
    expect(marketValue(2_000_000, 6, 3_000_000)).toBe(9_000_000); // 12M EV − 3M debt
  });
});

describe("conclude", () => {
  it("weight-normalizes the approaches", () => {
    const approaches: ApproachResult[] = [
      { approach: "income", value: 10_000_000, weight: 1, rationale: "" },
      { approach: "market", value: 12_000_000, weight: 1, rationale: "" },
    ];
    const r = conclude(approaches);
    expect(r.grossValue).toBe(11_000_000);
    expect(r.concludedValue).toBe(11_000_000); // no DLOM
  });

  it("applies a discount for lack of marketability", () => {
    const r = conclude([{ approach: "income", value: 10_000_000, weight: 1, rationale: "" }], 0.2);
    expect(r.concludedValue).toBe(8_000_000);
    expect(r.primary).toBe("income");
  });

  it("zeroes out when no approach is usable", () => {
    const r = conclude([{ approach: "cost", value: 0, weight: 1, rationale: "" }]);
    expect(r.grossValue).toBe(0);
    expect(r.primary).toBeNull();
  });
});

describe("markAsset", () => {
  it("blends income and market, with cost as a half-weight backstop", () => {
    const r = markAsset({
      noi: 650_000,
      capRatePct: 6.5,
      marketMetric: 2_000_000,
      marketMultiple: 6,
      netDebt: 0,
      cost: 8_000_000,
    })!;
    // income 10M (w1) + market 12M (w1) + cost 8M (w0.5) → 10.4M
    expect(r.concludedValue).toBe(10_400_000);
    expect(r.approaches).toHaveLength(3);
  });

  it("falls back to cost alone when nothing else is available", () => {
    const r = markAsset({ cost: 5_000_000 })!;
    expect(r.concludedValue).toBe(5_000_000);
    expect(r.primary).toBe("cost");
  });

  it("returns null with no usable inputs", () => {
    expect(markAsset({})).toBeNull();
  });
});
