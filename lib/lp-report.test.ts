// lib/lp-report.test.ts — unit tests for the PURE helpers in lib/lp-report.
// No DB / RSC runtime touched; only the I/O-free exports are exercised.
import {
  isExited,
  safeRatio,
  computeMultiples,
  currentQuarterLabel,
  rollupFunds,
  holdingsRows,
  summarizeActivity,
} from "./lp-report";
import type { Fund, Asset, CapitalEvent } from "@/lib/supabase/database.types";

function fund(overrides: Partial<Fund>): Fund {
  return {
    id: "f",
    organization_id: "o",
    name: "Fund",
    fund_type: "fund",
    vintage_year: 2020,
    target_size: null,
    committed_capital: 0,
    called_capital: 0,
    distributed_capital: 0,
    currency: "USD",
    created_at: "2020-01-01",
    updated_at: "2020-01-01",
    ...overrides,
  } as Fund;
}

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: "a",
    organization_id: "o",
    deal_id: null,
    fund_id: "f",
    name: "Asset",
    asset_type: "operating_company",
    acquisition_cost: 0,
    current_value: 0,
    status: "owned",
    created_at: "2020-01-01",
    updated_at: "2020-01-01",
    ...overrides,
  } as Asset;
}

function event(overrides: Partial<CapitalEvent>): CapitalEvent {
  return {
    id: "e",
    organization_id: "o",
    fund_id: "f",
    investor_id: null,
    event_type: "contribution",
    amount: 0,
    currency: "USD",
    effective_date: "2020-01-01",
    due_date: null,
    reference: null,
    notes: null,
    created_at: "2020-01-01",
    updated_at: "2020-01-01",
    ...overrides,
  } as CapitalEvent;
}

describe("isExited", () => {
  it("recognizes exited statuses case-insensitively", () => {
    expect(isExited("exited")).toBe(true);
    expect(isExited("SOLD")).toBe(true);
    expect(isExited(" Realized ")).toBe(true);
    expect(isExited("written_off")).toBe(true);
  });
  it("treats active / missing statuses as not exited", () => {
    expect(isExited("owned")).toBe(false);
    expect(isExited("")).toBe(false);
    expect(isExited(null)).toBe(false);
  });
});

describe("safeRatio", () => {
  it("divides normally", () => {
    expect(safeRatio(10, 5)).toBe(2);
  });
  it("guards a zero denominator to 0", () => {
    expect(safeRatio(10, 0)).toBe(0);
  });
});

describe("computeMultiples", () => {
  it("computes TVPI / DPI / RVPI / MOIC from a fixture", () => {
    const m = computeMultiples({ nav: 150, distributed: 50, paidIn: 100 });
    expect(m.tvpi).toBeCloseTo(2.0);
    expect(m.dpi).toBeCloseTo(0.5);
    expect(m.rvpi).toBeCloseTo(1.5);
    expect(m.moic).toBeCloseTo(2.0);
  });
  it("returns zeros when nothing is paid in", () => {
    const m = computeMultiples({ nav: 10, distributed: 10, paidIn: 0 });
    expect(m.tvpi).toBe(0);
    expect(m.dpi).toBe(0);
  });
});

describe("currentQuarterLabel", () => {
  it("labels a fixed date as its calendar quarter", () => {
    expect(currentQuarterLabel(new Date("2026-06-20T00:00:00Z"))).toBe("Q2 2026");
    expect(currentQuarterLabel(new Date("2026-01-15T00:00:00Z"))).toBe("Q1 2026");
    expect(currentQuarterLabel(new Date("2026-12-31T00:00:00Z"))).toBe("Q4 2026");
  });
});

describe("rollupFunds", () => {
  it("sums committed / called / distributed across funds", () => {
    const roll = rollupFunds([
      fund({ committed_capital: 100, called_capital: 60, distributed_capital: 20 }),
      fund({ committed_capital: 50, called_capital: 40, distributed_capital: 10 }),
    ]);
    expect(roll.committed).toBe(150);
    expect(roll.paidIn).toBe(100);
    expect(roll.distributed).toBe(30);
    expect(roll.currency).toBe("USD");
  });
  it("defaults currency to USD for an empty set", () => {
    expect(rollupFunds([]).currency).toBe("USD");
  });
});

describe("holdingsRows", () => {
  it("maps assets to rows with per-asset MOIC and exit flag", () => {
    const rows = holdingsRows([
      asset({ id: "x", acquisition_cost: 100, current_value: 250, status: "owned" }),
      asset({ id: "y", acquisition_cost: 0, current_value: 50, status: "sold" }),
    ]);
    expect(rows[0].moic).toBeCloseTo(2.5);
    expect(rows[0].exited).toBe(false);
    expect(rows[1].moic).toBe(0); // zero cost guarded
    expect(rows[1].exited).toBe(true);
  });
});

describe("summarizeActivity", () => {
  it("buckets contributions vs distributions", () => {
    const a = summarizeActivity([
      event({ event_type: "contribution", amount: 100 }),
      event({ event_type: "capital_call", amount: 50 }),
      event({ event_type: "distribution", amount: 30 }),
      event({ event_type: "return_of_capital", amount: 20 }),
      event({ event_type: "carry", amount: 5 }),
    ]);
    expect(a.contributionsCount).toBe(2);
    expect(a.contributionsTotal).toBe(150);
    expect(a.distributionsCount).toBe(2);
    expect(a.distributionsTotal).toBe(50);
  });
});
