import { engineAnalytics, type AnalyticsWorkflow } from "@/lib/grid-analytics";
import { TARGET_ENGINES } from "@/lib/intelligence";

function w(over: Partial<AnalyticsWorkflow>): AnalyticsWorkflow {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Workflow",
    status: "completed",
    session_id: "s1",
    created_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    hub: "run",
    description: null,
    lifecycle_stage: null,
    target_engine: null,
    ...over,
  };
}

describe("engineAnalytics", () => {
  it("returns all seven engines in canonical order, zeroed when empty", () => {
    const { engines, rollup } = engineAnalytics([]);
    expect(engines.map((e) => e.engine)).toEqual(TARGET_ENGINES);
    expect(engines.every((e) => e.total === 0 && e.avgCycleHours === null)).toBe(true);
    expect(rollup).toEqual({ total: 0, active: 0, completed: 0, avgCycleHours: null });
  });

  it("tallies total/active/completed per engine", () => {
    const { engines } = engineAnalytics([
      w({ lifecycle_stage: "Diligence", status: "completed", completed_at: "2026-01-01T02:00:00Z" }),
      w({ lifecycle_stage: "Diligence", status: "in_progress" }),
      w({ lifecycle_stage: "Diligence", status: "pending" }),
      w({ lifecycle_stage: "Underwriting", status: "awaiting_approval" }),
    ]);
    const diligence = engines.find((e) => e.engine === "Diligence Engine")!;
    expect(diligence.total).toBe(3);
    expect(diligence.completed).toBe(1);
    expect(diligence.active).toBe(2);
    const capital = engines.find((e) => e.engine === "Capital Stack Engine")!;
    expect(capital.total).toBe(1);
    expect(capital.active).toBe(1);
    expect(capital.completed).toBe(0);
  });

  it("averages cycle time over completed workflows with a completed_at", () => {
    const { engines, rollup } = engineAnalytics([
      // 2h and 4h completed -> mean 3h.
      w({ lifecycle_stage: "Diligence", status: "completed", created_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T02:00:00Z" }),
      w({ lifecycle_stage: "Diligence", status: "completed", created_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T04:00:00Z" }),
      // Completed but no completed_at -> excluded from the average.
      w({ lifecycle_stage: "Diligence", status: "completed", completed_at: null }),
      // Not completed -> excluded even though it has a completed_at.
      w({ lifecycle_stage: "Diligence", status: "in_progress", completed_at: "2026-01-01T09:00:00Z" }),
    ]);
    const diligence = engines.find((e) => e.engine === "Diligence Engine")!;
    expect(diligence.avgCycleHours).toBe(3);
    expect(rollup.avgCycleHours).toBe(3);
  });

  it("reports avgCycleHours null when no completed workflow has a completed_at", () => {
    const { engines, rollup } = engineAnalytics([
      w({ lifecycle_stage: "Diligence", status: "in_progress", completed_at: null }),
      w({ lifecycle_stage: "Diligence", status: "completed", completed_at: null }),
    ]);
    const diligence = engines.find((e) => e.engine === "Diligence Engine")!;
    expect(diligence.total).toBe(2);
    expect(diligence.avgCycleHours).toBeNull();
    expect(rollup.avgCycleHours).toBeNull();
  });

  it("ignores unparseable or negative spans", () => {
    const { rollup } = engineAnalytics([
      w({ status: "completed", created_at: "2026-01-01T05:00:00Z", completed_at: "2026-01-01T03:00:00Z" }),
      w({ status: "completed", created_at: "not-a-date", completed_at: "2026-01-01T03:00:00Z" }),
    ]);
    expect(rollup.completed).toBe(2);
    expect(rollup.avgCycleHours).toBeNull();
  });

  it("rolls up totals across engines", () => {
    const { rollup } = engineAnalytics([
      w({ lifecycle_stage: "Diligence", status: "completed", completed_at: "2026-01-01T01:00:00Z" }),
      w({ lifecycle_stage: "Underwriting", status: "in_progress" }),
      w({ lifecycle_stage: "Reporting & Communications", status: "pending" }),
    ]);
    expect(rollup.total).toBe(3);
    expect(rollup.completed).toBe(1);
    expect(rollup.active).toBe(2);
  });
});
