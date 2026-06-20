// lib/diligence-templates.test.ts
// Unit tests for the pure Run › Diligence logic. No DB — in-memory fixtures only.
import {
  DILIGENCE_CATEGORIES,
  DILIGENCE_TEMPLATES,
  isDiligenceCategory,
  templateItemsFor,
  newTemplateItems,
  coverageByCategory,
  groupByDeal,
  openCount,
  isResolved,
  isOverdue,
  overdueCount,
} from "@/lib/diligence-templates";
import type { DiligenceItem, DiligenceStatus } from "@/lib/supabase/database.types";

function makeItem(overrides: Partial<DiligenceItem> = {}): DiligenceItem {
  return {
    id: "dil-1",
    organization_id: "org-1",
    deal_id: "deal-1",
    document_id: null,
    category: "legal",
    title: "Title review",
    status: "open",
    risk_severity: null,
    finding: null,
    likelihood: null,
    mitigation: null,
    residual_severity: null,
    owner: null,
    due_date: null,
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

describe("templates", () => {
  it("every category has a non-empty template", () => {
    for (const cat of DILIGENCE_CATEGORIES) {
      expect(DILIGENCE_TEMPLATES[cat].length).toBeGreaterThan(0);
    }
  });

  it("isDiligenceCategory narrows known/unknown", () => {
    expect(isDiligenceCategory("legal")).toBe(true);
    expect(isDiligenceCategory("nonsense")).toBe(false);
  });

  it("templateItemsFor('all') flattens every category", () => {
    const all = templateItemsFor("all");
    const expected = DILIGENCE_CATEGORIES.reduce((n, c) => n + DILIGENCE_TEMPLATES[c].length, 0);
    expect(all.length).toBe(expected);
    expect(all.every((r) => typeof r.title === "string" && r.category)).toBe(true);
  });

  it("templateItemsFor(category) scopes to one category", () => {
    const legal = templateItemsFor("legal");
    expect(legal.length).toBe(DILIGENCE_TEMPLATES.legal.length);
    expect(legal.every((r) => r.category === "legal")).toBe(true);
  });

  it("templateItemsFor(unknown) is empty", () => {
    // @ts-expect-error exercising the runtime guard
    expect(templateItemsFor("bogus")).toEqual([]);
  });
});

describe("newTemplateItems (idempotency)", () => {
  it("drops titles that already exist, case/space-insensitive", () => {
    const rows = templateItemsFor("legal");
    const existing = ["  material contracts REVIEW "];
    const fresh = newTemplateItems(rows, existing);
    expect(fresh.length).toBe(rows.length - 1);
    expect(fresh.some((r) => r.title === "Material contracts review")).toBe(false);
  });

  it("keeps everything when nothing exists", () => {
    const rows = templateItemsFor("tax");
    expect(newTemplateItems(rows, [])).toEqual(rows);
  });
});

describe("coverageByCategory", () => {
  it("computes resolved/total ratio per category, sorted", () => {
    const items = [
      makeItem({ id: "a", category: "legal", status: "cleared" }),
      makeItem({ id: "b", category: "legal", status: "open" }),
      makeItem({ id: "c", category: "tax", status: "waived" }),
    ];
    const cov = coverageByCategory(items);
    expect(cov.map((c) => c.category)).toEqual(["legal", "tax"]);
    expect(cov[0]).toMatchObject({ total: 2, resolved: 1, ratio: 0.5 });
    expect(cov[1]).toMatchObject({ total: 1, resolved: 1, ratio: 1 });
  });

  it("treats missing category as 'general'", () => {
    const cov = coverageByCategory([makeItem({ category: "" })]);
    expect(cov[0].category).toBe("general");
  });

  it("empty input yields empty coverage", () => {
    expect(coverageByCategory([])).toEqual([]);
  });
});

describe("isResolved", () => {
  it.each<[DiligenceStatus, boolean]>([
    ["open", false],
    ["in_review", false],
    ["flagged", false],
    ["cleared", true],
    ["waived", true],
  ])("%s -> %s", (status, expected) => {
    expect(isResolved({ status })).toBe(expected);
  });
});

describe("groupByDeal", () => {
  it("groups by deal with progress, preserving first-seen order", () => {
    const items = [
      makeItem({ id: "a", deal_id: "d2", status: "open" }),
      makeItem({ id: "b", deal_id: "d1", status: "cleared" }),
      makeItem({ id: "c", deal_id: "d2", status: "waived" }),
    ];
    const groups = groupByDeal(items);
    expect(groups.map((g) => g.dealId)).toEqual(["d2", "d1"]);
    expect(groups[0]).toMatchObject({ total: 2, resolved: 1, progress: 0.5 });
    expect(groups[1]).toMatchObject({ total: 1, resolved: 1, progress: 1 });
  });
});

describe("openCount", () => {
  it("counts unresolved items", () => {
    const items = [
      makeItem({ status: "open" }),
      makeItem({ status: "in_review" }),
      makeItem({ status: "cleared" }),
    ];
    expect(openCount(items)).toBe(2);
  });
});

describe("overdue", () => {
  const today = "2026-06-20";

  it("flags open items past their due date", () => {
    expect(isOverdue({ due_date: "2026-06-19", status: "open" }, today)).toBe(true);
  });

  it("does not flag items due today or later", () => {
    expect(isOverdue({ due_date: "2026-06-20", status: "open" }, today)).toBe(false);
    expect(isOverdue({ due_date: "2026-07-01", status: "open" }, today)).toBe(false);
  });

  it("does not flag resolved items even if past due", () => {
    expect(isOverdue({ due_date: "2026-01-01", status: "cleared" }, today)).toBe(false);
  });

  it("does not flag items with no due date", () => {
    expect(isOverdue({ due_date: null, status: "open" }, today)).toBe(false);
  });

  it("overdueCount tallies overdue open items", () => {
    const items = [
      makeItem({ due_date: "2026-06-01", status: "open" }),
      makeItem({ due_date: "2026-06-01", status: "cleared" }),
      makeItem({ due_date: "2026-12-01", status: "open" }),
    ];
    expect(overdueCount(items, today)).toBe(1);
  });
});
