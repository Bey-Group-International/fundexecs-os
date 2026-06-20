// lib/run-war-room.test.ts
// Unit tests for the pure heatmap bucketing. The data-fetching helpers in
// run-war-room hit Supabase and are not exercised here; buildHeatmap is pure.
import { buildHeatmap, SEVERITY_AXIS } from "@/lib/run-war-room";
import type { DiligenceItem } from "@/lib/supabase/database.types";

function item(overrides: Partial<DiligenceItem> = {}): DiligenceItem {
  return {
    id: "d",
    organization_id: "org-1",
    deal_id: "deal-1",
    document_id: null,
    category: "legal",
    title: "Finding",
    status: "open",
    risk_severity: "high",
    finding: null,
    likelihood: "medium",
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

describe("buildHeatmap", () => {
  it("produces a 4×4 severity × likelihood grid", () => {
    const grid = buildHeatmap([]);
    expect(grid).toHaveLength(SEVERITY_AXIS.length);
    grid.forEach((row) => expect(row).toHaveLength(SEVERITY_AXIS.length));
  });

  it("places a finding in the cell for its severity and likelihood", () => {
    const grid = buildHeatmap([item({ risk_severity: "high", likelihood: "critical" })]);
    const cell = grid
      .flat()
      .find((c) => c.severity === "high" && c.likelihood === "critical");
    expect(cell?.items).toHaveLength(1);
  });

  it("buckets by residual severity once mitigated", () => {
    const grid = buildHeatmap([
      item({ risk_severity: "critical", residual_severity: "low", likelihood: "high" }),
    ]);
    const lowCell = grid.flat().find((c) => c.severity === "low" && c.likelihood === "high");
    const critCell = grid.flat().find((c) => c.severity === "critical" && c.likelihood === "high");
    expect(lowCell?.items).toHaveLength(1);
    expect(critCell?.items).toHaveLength(0);
  });

  it("defaults missing likelihood to medium and excludes resolved findings", () => {
    const grid = buildHeatmap([
      item({ id: "a", likelihood: null, risk_severity: "high" }),
      item({ id: "b", status: "cleared", risk_severity: "high" }),
    ]);
    const medCell = grid.flat().find((c) => c.severity === "high" && c.likelihood === "medium");
    expect(medCell?.items.map((i) => i.id)).toEqual(["a"]); // cleared 'b' excluded
  });
});
