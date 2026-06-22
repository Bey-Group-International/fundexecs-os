// lib/engine-sla.test.ts — unit tests for the PURE engine-SLA helpers (no DB / RSC).
import {
  DEFAULT_SLA_HOURS,
  isStuck,
  stuckHours,
  stuckWorkflows,
  stuckCount,
} from "./engine-sla";
import type { GridWorkflow } from "./execution-grid";

// Fixed reference point so all age math is deterministic.
const NOW = new Date("2026-06-22T12:00:00Z");

// Build a workflow `hoursAgo` hours before NOW (or with an explicit created_at).
function wf(partial: Partial<GridWorkflow> & { id: string } & ({ hoursAgo: number } | { created_at: string })): GridWorkflow {
  const created_at =
    "created_at" in partial && partial.created_at !== undefined
      ? partial.created_at
      : new Date(NOW.getTime() - (partial as { hoursAgo: number }).hoursAgo * 3600_000).toISOString();
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    status: partial.status ?? "in_progress",
    session_id: partial.session_id ?? null,
    created_at,
    hub: partial.hub ?? ("source" as GridWorkflow["hub"]),
    description: partial.description ?? null,
    lifecycle_stage: partial.lifecycle_stage ?? null,
    target_engine: partial.target_engine ?? null,
  };
}

describe("isStuck", () => {
  it("is false for active work under the threshold", () => {
    expect(isStuck(wf({ id: "a", status: "in_progress", hoursAgo: 10 }), NOW)).toBe(false);
  });

  it("is true for active work over the threshold", () => {
    expect(isStuck(wf({ id: "a", status: "in_progress", hoursAgo: DEFAULT_SLA_HOURS + 1 }), NOW)).toBe(true);
  });

  it("flags all active statuses", () => {
    for (const status of ["awaiting_approval", "in_progress", "pending"]) {
      expect(isStuck(wf({ id: status, status, hoursAgo: 200 }), NOW)).toBe(true);
    }
  });

  it("never flags completed or terminal workflows, however old", () => {
    for (const status of ["completed", "failed", "cancelled", "blocked"]) {
      expect(isStuck(wf({ id: status, status, hoursAgo: 1000 }), NOW)).toBe(false);
    }
  });

  it("is exclusive at the boundary (exactly threshold is not stuck)", () => {
    expect(isStuck(wf({ id: "edge", status: "in_progress", hoursAgo: DEFAULT_SLA_HOURS }), NOW)).toBe(false);
    expect(isStuck(wf({ id: "edge2", status: "in_progress", hoursAgo: DEFAULT_SLA_HOURS + 0.001 }), NOW)).toBe(true);
  });

  it("honours a custom threshold", () => {
    const w = wf({ id: "c", status: "pending", hoursAgo: 5 });
    expect(isStuck(w, NOW, 4)).toBe(true);
    expect(isStuck(w, NOW, 6)).toBe(false);
  });

  it("is null-safe on bad timestamps", () => {
    expect(isStuck(wf({ id: "bad", status: "in_progress", created_at: "not-a-date" }), NOW)).toBe(false);
    expect(isStuck(wf({ id: "empty", status: "in_progress", created_at: "" }), NOW)).toBe(false);
  });
});

describe("stuckHours", () => {
  it("floors the active age in hours", () => {
    expect(stuckHours(wf({ id: "a", hoursAgo: 99.9 }), NOW)).toBe(99);
  });

  it("returns null for a bad timestamp", () => {
    expect(stuckHours(wf({ id: "bad", created_at: "nope" }), NOW)).toBeNull();
  });
});

describe("stuckWorkflows / stuckCount", () => {
  const list: GridWorkflow[] = [
    wf({ id: "fresh", status: "in_progress", hoursAgo: 1 }),
    wf({ id: "old-active", status: "awaiting_approval", hoursAgo: 100 }),
    wf({ id: "old-done", status: "completed", hoursAgo: 500 }),
    wf({ id: "old-pending", status: "pending", hoursAgo: 80 }),
    wf({ id: "bad", status: "in_progress", created_at: "x" }),
  ];

  it("returns only the stuck subset, preserving order", () => {
    expect(stuckWorkflows(list, NOW).map((w) => w.id)).toEqual(["old-active", "old-pending"]);
  });

  it("stuckCount matches the subset size", () => {
    expect(stuckCount(list, NOW)).toBe(2);
  });

  it("respects a custom threshold", () => {
    expect(stuckCount(list, NOW, 200)).toBe(0);
    expect(stuckCount(list, NOW, 0.5)).toBe(3);
  });
});
