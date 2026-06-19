// lib/track-record.test.ts
// Unit tests for the pooled track-record math behind the investor one-pager.
import { blendTrackRecord } from "@/lib/track-record";
import type { TrackRecord } from "@/lib/supabase/database.types";

function makeRecord(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    id: "tr-1",
    organization_id: "org-1",
    deal_name: "Deal",
    asset_class: null,
    vintage_year: null,
    invested_amount: null,
    realized_value: null,
    unrealized_value: null,
    gross_irr: null,
    gross_moic: null,
    is_realized: false,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("blendTrackRecord", () => {
  it("returns zeroed/null metrics for an empty portfolio", () => {
    const b = blendTrackRecord([]);
    expect(b.dealCount).toBe(0);
    expect(b.totalInvested).toBe(0);
    expect(b.pooledMoic).toBeNull();
    expect(b.dpi).toBeNull();
    expect(b.weightedGrossIrr).toBeNull();
    expect(b.vintageRange).toBeNull();
  });

  it("pools MOIC, DPI, and RVPI across deals", () => {
    const b = blendTrackRecord([
      makeRecord({ invested_amount: 100, realized_value: 150, unrealized_value: 50, is_realized: true }),
      makeRecord({ invested_amount: 100, realized_value: 0, unrealized_value: 100 }),
    ]);
    expect(b.dealCount).toBe(2);
    expect(b.realizedCount).toBe(1);
    expect(b.totalInvested).toBe(200);
    expect(b.totalValue).toBe(300);
    expect(b.pooledMoic).toBeCloseTo(1.5);
    expect(b.dpi).toBeCloseTo(0.75);
    expect(b.rvpi).toBeCloseTo(0.75);
  });

  it("capital-weights gross IRR and ignores deals missing IRR or size", () => {
    const b = blendTrackRecord([
      makeRecord({ invested_amount: 300, gross_irr: 30 }),
      makeRecord({ invested_amount: 100, gross_irr: 10 }),
      makeRecord({ invested_amount: 0, gross_irr: 99 }), // no size → ignored
      makeRecord({ invested_amount: 500 }), // no IRR → ignored for IRR
    ]);
    // (30*300 + 10*100) / (300+100) = 10000/400 = 25
    expect(b.weightedGrossIrr).toBeCloseTo(25);
  });

  it("derives the vintage range from valid years only", () => {
    const b = blendTrackRecord([
      makeRecord({ vintage_year: 2019 }),
      makeRecord({ vintage_year: 2023 }),
      makeRecord({ vintage_year: null }),
    ]);
    expect(b.vintageRange).toEqual({ from: 2019, to: 2023 });
  });
});
