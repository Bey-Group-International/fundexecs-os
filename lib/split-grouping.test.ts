// lib/split-grouping.test.ts
// Unit tests for the pure split-grouping helper that drives the Copilot
// "Split · N of M" chip: siblings share a non-null prompt_id, are ordered by
// created_at then step_order, and singletons / null prompt_ids are never grouped.
import { splitPositions, type SplitWorkflow } from "@/lib/split-grouping";

function wf(overrides: Partial<SplitWorkflow> = {}): SplitWorkflow {
  return {
    id: "wf-1",
    prompt_id: "prompt-1",
    created_at: "2026-06-22T00:00:00.000Z",
    step_order: 0,
    ...overrides,
  };
}

describe("splitPositions", () => {
  it("indexes siblings of a split prompt by created_at order", () => {
    const positions = splitPositions([
      wf({ id: "b", prompt_id: "p", created_at: "2026-06-22T00:00:02.000Z" }),
      wf({ id: "a", prompt_id: "p", created_at: "2026-06-22T00:00:01.000Z" }),
    ]);
    expect(positions.get("a")).toEqual({ index: 1, total: 2 });
    expect(positions.get("b")).toEqual({ index: 2, total: 2 });
  });

  it("falls back to step_order when created_at ties", () => {
    const ts = "2026-06-22T00:00:01.000Z";
    const positions = splitPositions([
      wf({ id: "b", prompt_id: "p", created_at: ts, step_order: 5 }),
      wf({ id: "a", prompt_id: "p", created_at: ts, step_order: 1 }),
    ]);
    expect(positions.get("a")).toEqual({ index: 1, total: 2 });
    expect(positions.get("b")).toEqual({ index: 2, total: 2 });
  });

  it("does not group a single-workflow prompt", () => {
    const positions = splitPositions([wf({ id: "solo", prompt_id: "p" })]);
    expect(positions.has("solo")).toBe(false);
  });

  it("never groups null prompt_ids", () => {
    const positions = splitPositions([
      wf({ id: "a", prompt_id: null }),
      wf({ id: "b", prompt_id: null }),
    ]);
    expect(positions.size).toBe(0);
  });

  it("handles several independent split groups at once", () => {
    const positions = splitPositions([
      wf({ id: "a1", prompt_id: "p1", created_at: "2026-06-22T00:00:01.000Z" }),
      wf({ id: "a2", prompt_id: "p1", created_at: "2026-06-22T00:00:02.000Z" }),
      wf({ id: "solo", prompt_id: "p2" }),
      wf({ id: "b1", prompt_id: "p3", created_at: "2026-06-22T00:00:01.000Z" }),
      wf({ id: "b2", prompt_id: "p3", created_at: "2026-06-22T00:00:02.000Z" }),
      wf({ id: "b3", prompt_id: "p3", created_at: "2026-06-22T00:00:03.000Z" }),
    ]);
    expect(positions.get("a1")).toEqual({ index: 1, total: 2 });
    expect(positions.get("a2")).toEqual({ index: 2, total: 2 });
    expect(positions.has("solo")).toBe(false);
    expect(positions.get("b3")).toEqual({ index: 3, total: 3 });
  });
});
