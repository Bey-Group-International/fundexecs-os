// lib/entity-insights.test.ts
import { computeEntityInsights } from "@/lib/entity-insights";
import type { EquityHolding } from "@/lib/supabase/database.types";

function h(entity_id: string, ownership_pct: number | null, units: number | null = null): EquityHolding {
  return {
    id: `h-${Math.random()}`,
    organization_id: "org-1",
    entity_id,
    stakeholder_id: "s",
    share_class_id: null,
    units,
    ownership_pct,
    invested_amount: null,
    notes: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const entities = [
  { id: "e1", name: "GP LLC", entity_type: "gp" },
  { id: "e2", name: "Fund I", entity_type: "fund" },
  { id: "e3", name: "SPV A", entity_type: "spv" },
];

describe("computeEntityInsights", () => {
  it("counts entities by type and stakeholders", () => {
    const r = computeEntityInsights(entities, [{ principal_id: "p", investor_id: null }], []);
    expect(r.entityCount).toBe(3);
    expect(r.stakeholderCount).toBe(1);
    expect(r.byType.find((t) => t.type === "gp")?.count).toBe(1);
  });

  it("flags unlinked stakeholders", () => {
    const r = computeEntityInsights(entities, [
      { principal_id: "p", investor_id: null },
      { principal_id: null, investor_id: null },
      { principal_id: null, investor_id: "i" },
    ], []);
    expect(r.unlinkedStakeholders).toBe(1);
  });

  it("flags entities whose ownership doesn't sum to 100", () => {
    const r = computeEntityInsights(entities, [], [
      h("e1", 60),
      h("e1", 30), // GP LLC sums to 90 → imbalanced
      h("e2", 50),
      h("e2", 50), // Fund I balanced
    ]);
    expect(r.entitiesWithCapTable).toBe(2);
    expect(r.imbalanced.map((i) => i.entityId)).toEqual(["e1"]);
    expect(r.imbalanced[0].totalPct).toBeCloseTo(90);
  });

  it("reports the top concentration across entities", () => {
    const r = computeEntityInsights(entities, [], [h("e1", 80), h("e1", 20), h("e2", 50), h("e2", 50)]);
    expect(r.topConcentration?.entityName).toBe("GP LLC");
    expect(r.topConcentration?.pct).toBeCloseTo(80);
  });

  it("handles no entities/holdings", () => {
    const r = computeEntityInsights([], [], []);
    expect(r.entityCount).toBe(0);
    expect(r.topConcentration).toBeNull();
    expect(r.imbalanced).toEqual([]);
  });
});
