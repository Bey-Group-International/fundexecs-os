// lib/stock-comp.test.ts — pure ASC 718 expensing math, no I/O.
import {
  totalCompCost,
  recognizedExpense,
  periodExpense,
  rollupStockComp,
  Grant,
} from "@/lib/stock-comp";

// 10,000 options @ $4.20 grant-date FV, 48-month vest from 2024-01-01.
const grant: Grant = {
  units: 10_000,
  fairValuePerUnit: 4.2,
  grantDate: "2024-01-01",
  vestingMonths: 48,
};

describe("totalCompCost", () => {
  it("is units × grant-date fair value", () => {
    expect(totalCompCost(grant)).toBe(42_000);
  });

  it("scales down by an expected forfeiture rate", () => {
    // 42,000 × (1 − 0.10) = 37,800
    expect(totalCompCost({ ...grant, forfeitureRate: 0.1 })).toBe(37_800);
  });

  it("guards bad inputs", () => {
    expect(totalCompCost({ ...grant, units: -5 })).toBe(0);
    expect(totalCompCost({ ...grant, fairValuePerUnit: NaN })).toBe(0);
  });
});

describe("recognizedExpense", () => {
  it("recognizes nothing before the grant date", () => {
    const r = recognizedExpense(grant, "2023-06-01");
    expect(r.recognized).toBe(0);
    expect(r.remaining).toBe(42_000);
    expect(r.vestedFraction).toBe(0);
  });

  it("recognizes straight-line at the halfway point (24 of 48 months)", () => {
    const r = recognizedExpense(grant, "2026-01-01");
    expect(r.vestedFraction).toBe(0.5);
    expect(r.recognized).toBe(21_000);
    expect(r.remaining).toBe(21_000);
  });

  it("caps at total cost once fully vested", () => {
    const r = recognizedExpense(grant, "2030-01-01"); // well past 48 months
    expect(r.vestedFraction).toBe(1);
    expect(r.recognized).toBe(42_000);
    expect(r.remaining).toBe(0);
  });

  it("recognizes immediately for a zero-month (fully vested) grant", () => {
    const r = recognizedExpense({ ...grant, vestingMonths: 0 }, "2024-02-01");
    expect(r.recognized).toBe(42_000);
  });
});

describe("periodExpense", () => {
  it("recognizes one fiscal year of a 48-month grant (~25% of cost)", () => {
    // FY2025: 12 of 48 months → 42,000 × 12/48 = 10,500
    const fy = periodExpense(grant, "2025-01-01", "2026-01-01");
    expect(fy).toBeCloseTo(10_500, 0);
  });

  it("a single quarter recognizes ~3/48 of the cost", () => {
    // Q1 2025 → 42,000 × 3/48 = 2,625
    const q = periodExpense(grant, "2025-01-01", "2025-04-01");
    expect(q).toBeCloseTo(2_625, 0);
  });

  it("never goes negative when the period is reversed", () => {
    expect(periodExpense(grant, "2026-01-01", "2025-01-01")).toBe(0);
  });
});

describe("rollupStockComp", () => {
  it("sums total, recognized, and remaining across grants", () => {
    const grants: Grant[] = [
      grant, // 42,000 total, half recognized at 2026-01-01 = 21,000
      {
        units: 5_000,
        fairValuePerUnit: 6,
        grantDate: "2025-01-01",
        vestingMonths: 48,
      }, // 30,000 total, 12/48 = 7,500 recognized at 2026-01-01
    ];
    const roll = rollupStockComp(grants, "2026-01-01");
    expect(roll.totalCost).toBe(72_000);
    expect(roll.recognized).toBeCloseTo(28_500, 0);
    expect(roll.remaining).toBeCloseTo(43_500, 0);
    expect(roll.grants).toBe(2);
  });

  it("is empty-safe", () => {
    const roll = rollupStockComp([], "2026-01-01");
    expect(roll.totalCost).toBe(0);
    expect(roll.recognized).toBe(0);
    expect(roll.remaining).toBe(0);
  });
});
