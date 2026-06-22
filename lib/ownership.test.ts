// lib/ownership.test.ts — pure unified-ownership merge, no I/O.
import { unifyOwnership } from "@/lib/ownership";
import type { Stakeholder, EquityHolding, Commitment, InvestorType } from "@/lib/supabase/database.types";

const ts = { created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };

function stakeholder(o: Partial<Stakeholder> = {}): Stakeholder {
  return {
    id: "s1",
    organization_id: "org-1",
    name: "Alpha",
    kind: "investor",
    email: null,
    notes: null,
    created_by: null,
    principal_id: null,
    investor_id: null,
    ...ts,
    ...o,
  };
}

function holding(o: Partial<EquityHolding> = {}): EquityHolding {
  return {
    id: "h1",
    organization_id: "org-1",
    entity_id: "e1",
    stakeholder_id: "s1",
    share_class_id: null,
    units: null,
    ownership_pct: 10,
    invested_amount: 250_000,
    notes: null,
    created_by: null,
    ...ts,
    ...o,
  };
}

function commitment(o: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1",
    organization_id: "org-1",
    fund_id: "fund-1",
    investor_id: "inv1",
    committed_amount: 1_000_000,
    called_amount: 400_000,
    distributed_amount: 100_000,
    committed_at: null,
    ...ts,
    ...o,
  };
}

const entities = [{ id: "e1", name: "GP LLC" }];
const investors: { id: string; name: string; investor_type: InvestorType }[] = [
  { id: "inv1", name: "Alpha Capital", investor_type: "institution" },
  { id: "inv2", name: "Beta LP", investor_type: "lp" },
];

describe("unifyOwnership", () => {
  it("merges a stakeholder's equity and fund commitment into one linked holder", () => {
    const u = unifyOwnership(
      [stakeholder({ id: "s1", investor_id: "inv1", name: "Alpha" })],
      [holding({ stakeholder_id: "s1", invested_amount: 250_000, ownership_pct: 10 })],
      entities,
      [commitment({ investor_id: "inv1" })],
      investors,
    );
    expect(u.holderCount).toBe(1);
    const h = u.holders[0];
    expect(h.linked).toBe(true);
    expect(h.hasEquity).toBe(true);
    expect(h.hasFund).toBe(true);
    expect(h.equityInvested).toBe(250_000);
    expect(h.fund?.committed).toBe(1_000_000);
    expect(h.equity[0].entityName).toBe("GP LLC");
    expect(u.linkedCount).toBe(1);
  });

  it("keeps an investor with commitments but no stakeholder as fund-only", () => {
    const u = unifyOwnership([], [], entities, [commitment({ investor_id: "inv2" })], investors);
    expect(u.holderCount).toBe(1);
    expect(u.fundOnly).toBe(1);
    expect(u.holders[0].name).toBe("Beta LP");
    expect(u.holders[0].linked).toBe(false);
  });

  it("treats a stakeholder with equity but no fund link as equity-only", () => {
    const u = unifyOwnership(
      [stakeholder({ id: "s2", investor_id: null, name: "Founder" })],
      [holding({ id: "h2", stakeholder_id: "s2", invested_amount: 0, ownership_pct: 60 })],
      entities,
      [],
      investors,
    );
    expect(u.equityOnly).toBe(1);
    expect(u.holders[0].hasFund).toBe(false);
  });

  it("ignores bare stakeholders with neither equity nor commitments", () => {
    const u = unifyOwnership([stakeholder({ id: "s3", name: "Nobody" })], [], entities, [], investors);
    expect(u.holderCount).toBe(0);
  });

  it("sorts linked holders ahead of single-world holders", () => {
    const u = unifyOwnership(
      [stakeholder({ id: "s1", investor_id: "inv1", name: "Linked" })],
      [holding({ stakeholder_id: "s1" })],
      entities,
      [commitment({ investor_id: "inv1" }), commitment({ id: "c2", investor_id: "inv2" })],
      investors,
    );
    expect(u.holders[0].linked).toBe(true);
    expect(u.holders[0].name).toBe("Linked");
  });
});
