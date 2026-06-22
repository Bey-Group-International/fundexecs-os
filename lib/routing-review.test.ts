import { reviewItems } from "@/lib/routing-review";
import type { GridWorkflow } from "@/lib/execution-grid";

function w(over: Partial<GridWorkflow>): GridWorkflow {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Workflow",
    status: "in_progress",
    session_id: "s1",
    created_at: "2026-01-01T00:00:00Z",
    hub: "run",
    description: null,
    lifecycle_stage: null,
    target_engine: null,
    ...over,
  };
}

// A low-confidence workflow: no persisted stage and a prompt that matches no
// rule, so routing falls back to the hub default.
function low(over: Partial<GridWorkflow> = {}): GridWorkflow {
  return w({ lifecycle_stage: null, description: "misc admin", title: "misc", ...over });
}

// A high-confidence workflow: an explicit lifecycle stage routes authoritatively.
function high(over: Partial<GridWorkflow> = {}): GridWorkflow {
  return w({ lifecycle_stage: "Diligence", ...over });
}

describe("reviewItems", () => {
  it("includes a low-confidence (but not escalated) workflow as low_confidence", () => {
    const a = low({ id: "low-1" });
    const items = reviewItems([a], new Set());
    expect(items).toHaveLength(1);
    expect(items[0].workflow.id).toBe("low-1");
    expect(items[0].reason).toBe("low_confidence");
  });

  it("includes an escalated (but high-confidence) workflow as escalated", () => {
    const a = high({ id: "esc-1" });
    const items = reviewItems([a], new Set(["esc-1"]));
    expect(items).toHaveLength(1);
    expect(items[0].workflow.id).toBe("esc-1");
    expect(items[0].reason).toBe("escalated");
  });

  it("marks a workflow that is both low-confidence and escalated as both", () => {
    const a = low({ id: "both-1" });
    const items = reviewItems([a], new Set(["both-1"]));
    expect(items).toHaveLength(1);
    expect(items[0].reason).toBe("both");
  });

  it("excludes high-confidence workflows that are not escalated", () => {
    const a = high({ id: "ok-1" });
    expect(reviewItems([a], new Set())).toHaveLength(0);
    // An escalation referencing some other workflow does not pull it in.
    expect(reviewItems([a], new Set(["other"]))).toHaveLength(0);
  });

  it("preserves input order and only returns the needs-review subset", () => {
    const a = high({ id: "keep-high" });
    const b = low({ id: "keep-low" });
    const c = high({ id: "keep-esc" });
    const items = reviewItems([a, b, c], new Set(["keep-esc"]));
    expect(items.map((i) => i.workflow.id)).toEqual(["keep-low", "keep-esc"]);
    expect(items.map((i) => i.reason)).toEqual(["low_confidence", "escalated"]);
  });
});
