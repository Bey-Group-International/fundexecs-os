// lib/cap-table.test.ts — pure cap-table roll-up, no I/O.
import { rollupCapTable } from "@/lib/cap-table";
import type { Commitment, Investor, Fund } from "@/lib/supabase/database.types";

const meta = {
  provenance: "manual",
  verification_status: "unverified",
  verified_at: null,
  verified_by: null,
  verification_note: null,
  archived_at: null,
};

function makeCommitment(o: Partial<Commitment> = {}): Commitment {
  return {
    id: "c-1",
    organization_id: "org-1",
    fund_id: "fund-1",
    investor_id: "inv-1",
    committed_amount: 1_000_000,
    called_amount: 400_000,
    distributed_amount: 100_000,
    committed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...o,
  };
}

function makeInvestor(o: Partial<Investor> = {}): Investor {
  return {
    id: "inv-1",
    organization_id: "org-1",
    name: "Alpha LP",
    investor_type: "lp",
    contact_name: null,
    contact_email: null,
    jurisdiction: null,
    aum: null,
    typical_check_min: null,
    typical_check_max: null,
    notes: null,
    pipeline_stage: "committed",
    session_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...meta,
    ...o,
  };
}

function makeFund(o: Partial<Fund> = {}): Fund {
  return {
    id: "fund-1",
    organization_id: "org-1",
    name: "Fund I",
    fund_type: "fund",
    vintage_year: 2024,
    target_size: 0,
    committed_capital: 0,
    called_capital: 0,
    distributed_capital: 0,
    currency: "USD",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...o,
  };
}

describe("rollupCapTable", () => {
  it("is empty with no commitments", () => {
    const t = rollupCapTable([], [], [], 0);
    expect(t.holderCount).toBe(0);
    expect(t.totalCommitted).toBe(0);
    expect(t.topHolderPct).toBe(0);
  });

  it("computes ownership %, unfunded, and NAV share per holder", () => {
    const t = rollupCapTable(
      [
        makeCommitment({ id: "c1", investor_id: "inv-1", committed_amount: 3_000_000, called_amount: 1_500_000, distributed_amount: 600_000 }),
        makeCommitment({ id: "c2", investor_id: "inv-2", committed_amount: 1_000_000, called_amount: 500_000, distributed_amount: 0 }),
      ],
      [makeInvestor({ id: "inv-1", name: "Alpha LP", investor_type: "lp" }), makeInvestor({ id: "inv-2", name: "Beta Co-GP", investor_type: "co_gp" })],
      [makeFund()],
      4_000_000, // total NAV
    );
    expect(t.holderCount).toBe(2);
    expect(t.totalCommitted).toBe(4_000_000);
    const alpha = t.holders[0];
    expect(alpha.name).toBe("Alpha LP");
    expect(alpha.ownershipPct).toBe(75); // 3M / 4M
    expect(alpha.unfunded).toBe(1_500_000);
    expect(alpha.navShare).toBe(3_000_000); // 75% of 4M NAV
    expect(alpha.dpi).toBe(0.4); // 600k / 1.5M
    expect(alpha.tvpi).toBe(2.4); // (600k + 3M) / 1.5M
    expect(t.topHolderPct).toBe(75);
  });

  it("aggregates a holder's commitments across multiple funds", () => {
    const t = rollupCapTable(
      [
        makeCommitment({ id: "c1", fund_id: "fund-1", investor_id: "inv-1", committed_amount: 1_000_000 }),
        makeCommitment({ id: "c2", fund_id: "fund-2", investor_id: "inv-1", committed_amount: 2_000_000 }),
      ],
      [makeInvestor({ id: "inv-1" })],
      [makeFund({ id: "fund-1" }), makeFund({ id: "fund-2" })],
      0,
    );
    expect(t.holderCount).toBe(1);
    expect(t.holders[0].committed).toBe(3_000_000);
    expect(t.fundCount).toBe(2);
  });

  it("breaks the cap table down by stakeholder type — not just LPs", () => {
    const t = rollupCapTable(
      [
        makeCommitment({ id: "c1", investor_id: "inv-1", committed_amount: 6_000_000 }),
        makeCommitment({ id: "c2", investor_id: "inv-2", committed_amount: 2_000_000 }),
        makeCommitment({ id: "c3", investor_id: "inv-3", committed_amount: 2_000_000 }),
      ],
      [
        makeInvestor({ id: "inv-1", investor_type: "institution" }),
        makeInvestor({ id: "inv-2", investor_type: "co_gp" }),
        makeInvestor({ id: "inv-3", investor_type: "family_office" }),
      ],
      [makeFund()],
      0,
    );
    expect(t.byType[0]).toMatchObject({ type: "institution", count: 1, committed: 6_000_000, pct: 60 });
    expect(t.byType).toHaveLength(3);
  });
});
