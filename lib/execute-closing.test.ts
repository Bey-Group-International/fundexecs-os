// lib/execute-closing.test.ts
// Unit tests for the pure Execute-hub closing roll-up. No database is hit.
import { rollupExecuteClosing } from "@/lib/execute-closing";
import type { Deal, DiligenceItem, ServiceProvider, Fund } from "@/lib/supabase/database.types";

// Record-provenance fields shared by managed-record tables.
const meta = {
  provenance: "manual",
  verification_status: "unverified",
  verified_at: null,
  verified_by: null,
  verification_note: null,
  archived_at: null,
};

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    organization_id: "org-1",
    name: "Project Atlas",
    stage: "closing",
    asset_class: "real_estate",
    geography: "US",
    target_amount: 10_000_000,
    fund_id: "fund-1",
    source: null,
    lead_principal: null,
    thesis_fit: 0.8,
    expected_close: "2026-09-01",
    notes: null,
    session_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...meta,
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
    ...meta,
    ...overrides,
  };
}

function makeProvider(overrides: Partial<ServiceProvider> = {}): ServiceProvider {
  return {
    id: "sp-1",
    organization_id: "org-1",
    name: "Acme Legal",
    provider_type: "legal",
    contact_name: null,
    contact_email: null,
    status: "active",
    notes: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...meta,
    ...overrides,
  };
}

function makeFund(overrides: Partial<Fund> = {}): Fund {
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
    ...overrides,
  };
}

describe("rollupExecuteClosing", () => {
  it("is empty with no deals in the closing window", () => {
    const s = rollupExecuteClosing([makeDeal({ stage: "diligence" })], [], [], []);
    expect(s.closes).toHaveLength(0);
    expect(s.inClosing).toBe(0);
  });

  it("marks a fully-prepared closing deal as ready", () => {
    const s = rollupExecuteClosing(
      [makeDeal()],
      [makeDiligence(), makeDiligence({ id: "d2", status: "waived" })],
      [makeProvider()],
      [makeFund()],
    );
    expect(s.closes).toHaveLength(1);
    expect(s.closes[0].ready).toBe(true);
    expect(s.closes[0].progress).toBe(100);
    expect(s.readyCount).toBe(1);
    expect(s.inClosing).toBe(1);
    expect(s.capitalClosing).toBe(10_000_000);
    expect(s.closes[0].fundName).toBe("Fund I");
  });

  it("withholds diligence step when an open severe finding remains", () => {
    const s = rollupExecuteClosing(
      [makeDeal()],
      [
        makeDiligence({ id: "d1", status: "cleared" }),
        makeDiligence({ id: "d2", status: "open", risk_severity: "critical" }),
      ],
      [makeProvider()],
      [makeFund()],
    );
    const dil = s.closes[0].steps.find((x) => x.key === "diligence")!;
    expect(dil.done).toBe(false);
    expect(s.closes[0].ready).toBe(false);
    expect(s.closes[0].nextStep?.key).toBe("diligence");
  });

  it("treats an ic_review deal as awaiting IC, not yet IC-approved", () => {
    const s = rollupExecuteClosing(
      [makeDeal({ stage: "ic_review" })],
      [makeDiligence()],
      [makeProvider()],
      [makeFund()],
    );
    expect(s.inClosing).toBe(0);
    expect(s.awaitingIc).toBe(1);
    expect(s.closes[0].steps.find((x) => x.key === "ic")!.done).toBe(false);
  });

  it("flags an overdue close and computes the next close", () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    const s = rollupExecuteClosing(
      [makeDeal({ expected_close: past })],
      [makeDiligence()],
      [makeProvider()],
      [makeFund()],
    );
    expect(s.overdue).toBe(1);
    expect(s.nextClose?.days).toBeLessThan(0);
  });

  it("requires funding via a fund assignment", () => {
    const s = rollupExecuteClosing([makeDeal({ fund_id: null })], [makeDiligence()], [makeProvider()], []);
    expect(s.closes[0].steps.find((x) => x.key === "funding")!.done).toBe(false);
  });
});
