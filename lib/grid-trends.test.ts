import { engineTrends, type TrendWorkflow } from "@/lib/grid-trends";
import { TARGET_ENGINES } from "@/lib/intelligence";

function w(over: Partial<TrendWorkflow>): TrendWorkflow {
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

// A Wednesday — its UTC week starts Monday 2026-06-15.
const NOW = new Date("2026-06-17T12:00:00Z");

describe("engineTrends", () => {
  it("returns all seven engines in canonical order, each with `weeks` empty points", () => {
    const trends = engineTrends([], { now: NOW });
    expect(trends.map((t) => t.engine)).toEqual(TARGET_ENGINES);
    expect(trends.every((t) => t.series.length === 8)).toBe(true);
    expect(trends.every((t) => t.series.every((p) => p.completed === 0))).toBe(true);
  });

  it("respects a custom bucket count", () => {
    const trends = engineTrends([], { now: NOW, weeks: 4 });
    expect(trends.every((t) => t.series.length === 4)).toBe(true);
  });

  it("buckets completions into the correct weeks, oldest → newest", () => {
    const trends = engineTrends(
      [
        // Latest week (2026-06-15 → 2026-06-21).
        w({ lifecycle_stage: "Diligence", completed_at: "2026-06-17T09:00:00Z" }),
        w({ lifecycle_stage: "Diligence", completed_at: "2026-06-21T23:00:00Z" }),
        // One week earlier (2026-06-08 → 2026-06-14).
        w({ lifecycle_stage: "Diligence", completed_at: "2026-06-10T00:00:00Z" }),
      ],
      { now: NOW },
    );
    const diligence = trends.find((t) => t.engine === "Diligence Engine")!;
    // The injected `now` pins the newest bucket to the week of 2026-06-15.
    expect(diligence.series[7].weekStart).toBe("2026-06-15T00:00:00.000Z");
    expect(diligence.series[6].weekStart).toBe("2026-06-08T00:00:00.000Z");
    expect(diligence.series[7].completed).toBe(2);
    expect(diligence.series[6].completed).toBe(1);
    // Earlier (empty) weeks stay zeroed.
    expect(diligence.series.slice(0, 6).every((p) => p.completed === 0)).toBe(true);
    // A different engine sees none of these.
    const capital = trends.find((t) => t.engine === "Capital Stack Engine")!;
    expect(capital.series.every((p) => p.completed === 0)).toBe(true);
  });

  it("separates completions by engine", () => {
    const trends = engineTrends(
      [
        w({ lifecycle_stage: "Diligence", completed_at: "2026-06-17T09:00:00Z" }),
        w({ lifecycle_stage: "Underwriting", completed_at: "2026-06-17T09:00:00Z" }),
      ],
      { now: NOW },
    );
    expect(trends.find((t) => t.engine === "Diligence Engine")!.series[7].completed).toBe(1);
    expect(trends.find((t) => t.engine === "Capital Stack Engine")!.series[7].completed).toBe(1);
  });

  it("ignores workflows outside the window or with missing/unparseable completed_at", () => {
    const trends = engineTrends(
      [
        // Before the 8-week window.
        w({ lifecycle_stage: "Diligence", completed_at: "2026-01-01T00:00:00Z" }),
        // After the window (future week).
        w({ lifecycle_stage: "Diligence", completed_at: "2026-07-01T00:00:00Z" }),
        // No completed_at.
        w({ lifecycle_stage: "Diligence", completed_at: null }),
        // Unparseable completed_at.
        w({ lifecycle_stage: "Diligence", completed_at: "not-a-date" }),
      ],
      { now: NOW },
    );
    const diligence = trends.find((t) => t.engine === "Diligence Engine")!;
    expect(diligence.series.every((p) => p.completed === 0)).toBe(true);
  });

  it("is deterministic for an injected `now` (accepts Date or epoch ms)", () => {
    const fromDate = engineTrends([], { now: NOW });
    const fromMs = engineTrends([], { now: NOW.getTime() });
    expect(fromMs).toEqual(fromDate);
    // Same window every run for the same `now`.
    expect(engineTrends([], { now: NOW })).toEqual(fromDate);
  });
});
