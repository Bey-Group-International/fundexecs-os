// lib/source-war-room.test.ts
// Unit tests for the pure helpers behind the LP war room. No database is hit —
// all inputs are small in-memory fixtures. We deliberately avoid importing
// getInvestorWarRoom here: it pulls in server-only Supabase wiring (cookies,
// react cache) that isn't available under jest.
import {
  sumCommitments,
  investorTemperature,
  formatCompactCurrency,
} from "@/lib/source-war-room";
import type { Commitment, Investor } from "@/lib/supabase/database.types";

// --- Fixtures ---------------------------------------------------------------
function makeCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "com-1",
    organization_id: "org-1",
    fund_id: "fund-1",
    investor_id: "inv-1",
    committed_amount: 0,
    called_amount: 0,
    distributed_amount: 0,
    committed_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeInvestor(overrides: Partial<Investor> = {}): Investor {
  return {
    id: "inv-1",
    organization_id: "org-1",
    name: "Acme Family Office",
    investor_type: "family_office",
    contact_name: null,
    contact_email: null,
    jurisdiction: null,
    aum: null,
    typical_check_min: null,
    typical_check_max: null,
    notes: null,
    pipeline_stage: "new",
    session_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    provenance: "manual",
    verification_status: "unverified",
    verified_at: null,
    verified_by: null,
    verification_note: null,
    archived_at: null,
    ...overrides,
  };
}

// --- sumCommitments ---------------------------------------------------------
describe("sumCommitments", () => {
  it("returns zeroed totals for no commitments", () => {
    expect(sumCommitments([])).toEqual({
      committedTotal: 0,
      calledTotal: 0,
      distributedTotal: 0,
    });
  });

  it("sums committed, called, and distributed across funds independently", () => {
    const totals = sumCommitments([
      makeCommitment({ committed_amount: 1_000_000, called_amount: 400_000, distributed_amount: 100_000 }),
      makeCommitment({ fund_id: "fund-2", committed_amount: 500_000, called_amount: 250_000, distributed_amount: 0 }),
    ]);
    expect(totals).toEqual({
      committedTotal: 1_500_000,
      calledTotal: 650_000,
      distributedTotal: 100_000,
    });
  });

  it("treats nullish numerics as zero without producing NaN", () => {
    const totals = sumCommitments([
      makeCommitment({
        committed_amount: null as unknown as number,
        called_amount: undefined as unknown as number,
        distributed_amount: 250_000,
      }),
    ]);
    expect(totals.committedTotal).toBe(0);
    expect(totals.calledTotal).toBe(0);
    expect(totals.distributedTotal).toBe(250_000);
  });
});

// --- investorTemperature ----------------------------------------------------
describe("investorTemperature", () => {
  it("is committed whenever there is a live commitment, regardless of stage", () => {
    const inv = makeInvestor({ pipeline_stage: "new" });
    expect(investorTemperature(inv, 1_000_000)).toBe("committed");
  });

  it("falls back to the pipeline stage when nothing is committed", () => {
    expect(investorTemperature(makeInvestor({ pipeline_stage: "diligence" }), 0)).toBe("active");
    expect(investorTemperature(makeInvestor({ pipeline_stage: "contacted" }), 0)).toBe("warm");
    expect(investorTemperature(makeInvestor({ pipeline_stage: "new" }), 0)).toBe("cold");
  });
});

// --- formatCompactCurrency --------------------------------------------------
describe("formatCompactCurrency", () => {
  it("scales into K / M / B with one decimal, trimming trailing .0", () => {
    expect(formatCompactCurrency(2_400_000_000)).toBe("$2.4B");
    expect(formatCompactCurrency(1_200_000)).toBe("$1.2M");
    expect(formatCompactCurrency(2_000_000)).toBe("$2M");
    expect(formatCompactCurrency(850_000)).toBe("$850K");
    expect(formatCompactCurrency(640)).toBe("$640");
  });

  it("handles zero and nullish input as $0", () => {
    expect(formatCompactCurrency(0)).toBe("$0");
    expect(formatCompactCurrency(null)).toBe("$0");
    expect(formatCompactCurrency(undefined)).toBe("$0");
  });

  it("preserves sign on negative amounts", () => {
    expect(formatCompactCurrency(-1_500_000)).toBe("-$1.5M");
  });
});
