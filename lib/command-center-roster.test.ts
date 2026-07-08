import { buildActivityMap } from "./command-center-roster";

describe("buildActivityMap", () => {
  it("maps active tasks to their assigned executive", () => {
    const map = buildActivityMap([
      { assigned_agent: "analyst", title: "Comp pressure-test", status: "in_progress", progress: 40 },
      { assigned_agent: "diligence", title: "Risk-flag sweep", status: "pending", progress: 0 },
    ]);
    expect(map.analyst).toEqual({ task: "Comp pressure-test", progress: 0.4 });
    expect(map.diligence).toEqual({ task: "Risk-flag sweep", progress: 0 });
  });

  it("keeps the first (most recent) active task per agent", () => {
    const map = buildActivityMap([
      { assigned_agent: "analyst", title: "Newest", status: "in_progress", progress: 10 },
      { assigned_agent: "analyst", title: "Older", status: "in_progress", progress: 90 },
    ]);
    expect(map.analyst.task).toBe("Newest");
  });

  it("skips inactive statuses and rows missing an agent or title", () => {
    const map = buildActivityMap([
      { assigned_agent: "analyst", title: "Done thing", status: "completed", progress: 100 },
      { assigned_agent: "diligence", title: null, status: "in_progress", progress: 20 },
      { assigned_agent: null, title: "Orphan", status: "in_progress", progress: 20 },
    ]);
    expect(map).toEqual({});
  });

  it("normalizes 0..100 progress into 0..1 and clamps", () => {
    const map = buildActivityMap([
      { assigned_agent: "a", title: "half", status: "in_progress", progress: 50 },
      { assigned_agent: "b", title: "already-fraction", status: "in_progress", progress: 0.75 },
      { assigned_agent: "c", title: "over", status: "in_progress", progress: 150 },
      { assigned_agent: "d", title: "negative", status: "in_progress", progress: -5 },
    ]);
    expect(map.a.progress).toBe(0.5);
    expect(map.b.progress).toBe(0.75);
    expect(map.c.progress).toBe(1);
    expect(map.d.progress).toBe(0);
  });
});
