// lib/run-conviction.test.ts
// Unit tests for the pure Run-hub conviction roll-up. No database is hit — the
// fetch (getRunConviction) is the only impure wrapper; rollupRunConviction and
// toPercent are exercised here with small in-memory fixtures.
import { rollupRunConviction, toPercent, effectiveSeverity } from "@/lib/run-conviction";
import type { Mandate } from "@/lib/build-readiness";
import type { Deal, Underwriting, DiligenceItem, TrackRecord } from "@/lib/supabase/database.types";

// --- Fixtures ---------------------------------------------------------------
function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    organization_id: "org-1",
    name: "Project Atlas",
    stage: "diligence",
    asset_class: "real_estate",
    geography: "US",
    target_amount: null,
    fund_id: null,
    source: null,
    lead_principal: null,
    thesis_fit: 0.8,
    expected_close: null,
    notes: null,
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

function makeUnderwriting(overrides: Partial<Underwriting> = {}): Underwriting {
  return {
    id: "uw-1",
    organization_id: "org-1",
    deal_id: "deal-1",
    name: "Base Case",
    scenario: "base",
    model: {},
    projected_irr: 0.22,
    projected_moic: 2.1,
    equity_required: null,
    created_by: null,
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

function makeDiligence(overrides: Partial<DiligenceItem> = {}): DiligenceItem {
  return {
    id: "dil-1",
    organization_id: "org-1",
    deal_id: "deal-1",
    document_id: null,
    category: "legal",
    title: "Title review",
    status: "cleared",
    risk_severity: null,
    finding: null,
    likelihood: null,
    mitigation: null,
    residual_severity: null,
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

const MANDATE: Mandate = {
  thesisTitle: "Core-plus US RE",
  assetClasses: ["real_estate"],
  geographies: ["US"],
  checkSizeMin: null,
  checkSizeMax: null,
  targetIrr: 18,
  targetMoic: 2,
};

// --- toPercent --------------------------------------------------------------
describe("toPercent", () => {
  it("treats a fraction as a percentage", () => {
    expect(toPercent(0.22)).toBe(22);
  });
  it("leaves a whole-number percent as-is", () => {
    expect(toPercent(22)).toBe(22);
  });
  it("passes null through", () => {
    expect(toPercent(null)).toBeNull();
  });
});

// --- rollupRunConviction ----------------------------------------------------
describe("rollupRunConviction", () => {
  it("returns an empty portfolio when no deals are in evaluation", () => {
    const sourced = makeDeal({ stage: "sourced" });
    const r = rollupRunConviction([sourced], [], [], [], MANDATE);
    expect(r.overall).toBe(0);
    expect(r.deals).toHaveLength(0);
    expect(r.benchmark.dealsInEval).toBe(0);
    expect(r.nextAction).toBeNull();
  });

  it("only counts active-stage deals as the working set", () => {
    const deals = [
      makeDeal({ id: "a", stage: "diligence" }),
      makeDeal({ id: "b", stage: "sourced" }),
      makeDeal({ id: "c", stage: "owned" }),
      makeDeal({ id: "d", stage: "ic_review" }),
    ];
    const r = rollupRunConviction(deals, [], [], [], MANDATE);
    expect(r.benchmark.dealsInEval).toBe(2);
    expect(r.deals.map((d) => d.deal.id).sort()).toEqual(["a", "d"]);
  });

  it("scores a fully evaluated deal as IC-ready", () => {
    const deal = makeDeal();
    const uw = [
      makeUnderwriting({ id: "base", scenario: "base", projected_irr: 0.22 }),
      makeUnderwriting({ id: "down", scenario: "downside", projected_irr: 0.12 }),
    ];
    const dil = [
      makeDiligence({ id: "1", status: "cleared" }),
      makeDiligence({ id: "2", status: "cleared" }),
    ];
    const r = rollupRunConviction([deal], uw, dil, [], MANDATE);
    expect(r.deals[0].score).toBe(100);
    expect(r.deals[0].stage.key).toBe("ic_ready");
    expect(r.benchmark.icReadyCount).toBe(1);
    expect(r.nextAction).toBeNull(); // nothing left to push
  });

  it("flags open critical risk and surfaces it as the next action", () => {
    const deal = makeDeal();
    // Everything else cleared so the open critical risk is the first pending
    // check the next-best action lands on.
    const uw = [
      makeUnderwriting({ id: "base", scenario: "base" }),
      makeUnderwriting({ id: "down", scenario: "downside", projected_irr: 0.12 }),
    ];
    const dil = [
      makeDiligence({ id: "1", status: "cleared" }),
      makeDiligence({ id: "2", status: "cleared" }),
      makeDiligence({ id: "3", status: "cleared" }),
      makeDiligence({ id: "4", status: "flagged", risk_severity: "critical" }),
    ];
    const r = rollupRunConviction([deal], uw, dil, [], MANDATE);
    expect(r.benchmark.openCriticalRisks).toBe(1);
    expect(r.deals[0].openRisks).toHaveLength(1);
    expect(r.deals[0].stage.key).not.toBe("ic_ready");
    expect(r.nextAction?.label).toMatch(/risk/i);
  });

  it("benchmarks pipeline IRR against the mandate target and track record", () => {
    const deal = makeDeal();
    const uw = [makeUnderwriting({ projected_irr: 0.2 })]; // 20%
    const track: TrackRecord[] = [
      {
        id: "t1",
        organization_id: "org-1",
        deal_name: "Prior",
        asset_class: "real_estate",
        vintage_year: 2018,
        invested_amount: null,
        realized_value: null,
        unrealized_value: null,
        gross_irr: 0.16,
        gross_moic: 1.9,
        is_realized: true,
        notes: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const r = rollupRunConviction([deal], uw, [], track, MANDATE);
    expect(r.benchmark.avgPipelineIrr).toBe(20);
    expect(r.benchmark.targetIrr).toBe(18);
    expect(r.benchmark.historicalIrr).toBe(16);
  });

  it("ranks deals by conviction, strongest first", () => {
    const strong = makeDeal({ id: "strong", name: "Strong" });
    const weak = makeDeal({ id: "weak", name: "Weak", thesis_fit: null });
    const uw = [makeUnderwriting({ deal_id: "strong" })];
    const dil = [makeDiligence({ deal_id: "strong", status: "cleared" })];
    const r = rollupRunConviction([strong, weak], uw, dil, [], MANDATE);
    expect(r.deals[0].deal.id).toBe("strong");
    expect(r.deals[0].score).toBeGreaterThan(r.deals[1].score);
  });

  it("lets a recorded mitigation buy conviction back via residual severity", () => {
    const deal = makeDeal();
    const uw = [
      makeUnderwriting({ id: "base", scenario: "base" }),
      makeUnderwriting({ id: "down", scenario: "downside", projected_irr: 0.12 }),
    ];
    // Three cleared + one critical finding that has been mitigated down to low.
    const dil = [
      makeDiligence({ id: "1", status: "cleared" }),
      makeDiligence({ id: "2", status: "cleared" }),
      makeDiligence({ id: "3", status: "cleared" }),
      makeDiligence({
        id: "4",
        status: "flagged",
        risk_severity: "critical",
        mitigation: "Indemnity + escrow",
        residual_severity: "low",
      }),
    ];
    const r = rollupRunConviction([deal], uw, dil, [], MANDATE);
    expect(r.deals[0].openRisks).toHaveLength(0); // residual low no longer bites
    expect(r.deals[0].stage.key).toBe("ic_ready");
  });
});

describe("effectiveSeverity", () => {
  it("prefers residual severity once a mitigation is recorded", () => {
    expect(
      effectiveSeverity(makeDiligence({ risk_severity: "critical", residual_severity: "low" })),
    ).toBe("low");
  });
  it("falls back to raw severity when there is no residual", () => {
    expect(effectiveSeverity(makeDiligence({ risk_severity: "high", residual_severity: null }))).toBe("high");
  });
});
