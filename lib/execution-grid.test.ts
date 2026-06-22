import { groupByEngine, engineOfWorkflow, type GridWorkflow } from "@/lib/execution-grid";
import { TARGET_ENGINES } from "@/lib/intelligence";

function w(over: Partial<GridWorkflow>): GridWorkflow {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Workflow",
    status: "completed",
    session_id: "s1",
    created_at: "2026-01-01T00:00:00Z",
    hub: "run",
    description: null,
    lifecycle_stage: null,
    target_engine: null,
    ...over,
  };
}

describe("engineOfWorkflow", () => {
  it("uses the persisted lifecycle stage to resolve the engine", () => {
    expect(engineOfWorkflow(w({ lifecycle_stage: "Diligence" }))).toBe("Diligence Engine");
    expect(engineOfWorkflow(w({ lifecycle_stage: "Underwriting" }))).toBe("Capital Stack Engine");
  });
  it("falls back deterministically for legacy rows with no stage", () => {
    expect(engineOfWorkflow(w({ lifecycle_stage: null, description: "Build the diligence pack", hub: "run" }))).toBe(
      "Diligence Engine",
    );
    // Pure hub default when nothing else matches.
    expect(engineOfWorkflow(w({ lifecycle_stage: null, title: "misc", description: null, hub: "source" }))).toBe(
      "Outbound Engine",
    );
  });
});

describe("groupByEngine", () => {
  it("returns all seven panes in canonical order, even when empty", () => {
    const panes = groupByEngine([]);
    expect(panes.map((p) => p.engine)).toEqual(TARGET_ENGINES);
    expect(panes.every((p) => p.total === 0)).toBe(true);
  });

  it("buckets workflows and tallies active/done", () => {
    const panes = groupByEngine([
      w({ lifecycle_stage: "Diligence", status: "completed" }),
      w({ lifecycle_stage: "Diligence", status: "in_progress" }),
      w({ lifecycle_stage: "Underwriting", status: "awaiting_approval" }),
    ]);
    const diligence = panes.find((p) => p.engine === "Diligence Engine")!;
    expect(diligence.total).toBe(2);
    expect(diligence.done).toBe(1);
    expect(diligence.active).toBe(1);
    const capital = panes.find((p) => p.engine === "Capital Stack Engine")!;
    expect(capital.total).toBe(1);
    expect(capital.active).toBe(1);
  });

  it("preserves input (newest-first) order within a pane", () => {
    const a = w({ lifecycle_stage: "Reporting & Communications", title: "newer" });
    const b = w({ lifecycle_stage: "Reporting & Communications", title: "older" });
    const pane = groupByEngine([a, b]).find((p) => p.engine === "Reporting Engine")!;
    expect(pane.workflows.map((x) => x.title)).toEqual(["newer", "older"]);
  });
});
