// lib/entity-ownership.test.ts
import { rollupOwnership } from "@/lib/entity-ownership";
import type { EquityHolding, Stakeholder, ShareClass } from "@/lib/supabase/database.types";

function sh(id: string, name: string, kind = "person"): Stakeholder {
  return {
    id,
    organization_id: "org-1",
    name,
    kind,
    email: null,
    notes: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
function hold(overrides: Partial<EquityHolding>): EquityHolding {
  return {
    id: "h",
    organization_id: "org-1",
    entity_id: "e-1",
    stakeholder_id: "s-1",
    share_class_id: null,
    units: null,
    ownership_pct: null,
    invested_amount: null,
    notes: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const classes: ShareClass[] = [
  {
    id: "c-1",
    organization_id: "org-1",
    entity_id: "e-1",
    name: "Common",
    kind: "common",
    authorized_units: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

describe("rollupOwnership", () => {
  it("derives % from each holder's share of total units", () => {
    const r = rollupOwnership(
      [
        hold({ id: "h1", stakeholder_id: "s-1", units: 700, share_class_id: "c-1" }),
        hold({ id: "h2", stakeholder_id: "s-2", units: 300, share_class_id: "c-1" }),
      ],
      [sh("s-1", "Founder"), sh("s-2", "Partner")],
      classes,
    );
    expect(r.rows[0].name).toBe("Founder");
    expect(r.rows[0].ownershipPct).toBeCloseTo(70);
    expect(r.rows[1].ownershipPct).toBeCloseTo(30);
    expect(r.totalPct).toBeCloseTo(100);
    expect(r.balanced).toBe(true);
    expect(r.topHolderPct).toBeCloseTo(70);
  });

  it("honors explicit ownership_pct over units", () => {
    const r = rollupOwnership(
      [hold({ id: "h1", stakeholder_id: "s-1", units: 999, ownership_pct: 55 })],
      [sh("s-1", "GP")],
      [],
    );
    expect(r.rows[0].ownershipPct).toBe(55);
    expect(r.balanced).toBe(false);
  });

  it("splits evenly when neither units nor % are given", () => {
    const r = rollupOwnership(
      [hold({ id: "h1", stakeholder_id: "s-1" }), hold({ id: "h2", stakeholder_id: "s-2" })],
      [sh("s-1", "A"), sh("s-2", "B")],
      [],
    );
    expect(r.rows[0].ownershipPct).toBeCloseTo(50);
    expect(r.totalPct).toBeCloseTo(100);
  });

  it("breaks ownership down by share class", () => {
    const r = rollupOwnership(
      [
        hold({ id: "h1", stakeholder_id: "s-1", ownership_pct: 60, share_class_id: "c-1" }),
        hold({ id: "h2", stakeholder_id: "s-2", ownership_pct: 40 }),
      ],
      [sh("s-1", "A"), sh("s-2", "B")],
      classes,
    );
    const common = r.byClass.find((c) => c.className === "Common");
    expect(common?.pct).toBeCloseTo(60);
    expect(r.byClass.find((c) => c.className === "Unclassified")?.pct).toBeCloseTo(40);
  });

  it("returns an empty rollup for no holdings", () => {
    const r = rollupOwnership([], [], []);
    expect(r.rows).toEqual([]);
    expect(r.totalPct).toBe(0);
    expect(r.balanced).toBe(false);
  });
});
