import type { Task } from "@/lib/supabase/database.types";
import { activeAgent, buildAgentTheater, __test } from "@/lib/session-theater";

function step(partial: Partial<Task>): Task {
  return {
    id: partial.id ?? Math.random().toString(36),
    organization_id: "org",
    prompt_id: null,
    parent_task_id: "workflow",
    title: partial.title ?? "Step",
    description: partial.description ?? "Do work",
    hub: partial.hub ?? "source",
    assigned_agent: partial.assigned_agent ?? "capital_raiser",
    status: partial.status ?? "pending",
    progress: partial.progress ?? 0,
    graph_touched: null,
    requires_approval: false,
    result: null,
    created_by: null,
    completed_at: null,
    step_order: partial.step_order ?? 1,
    automation_id: null,
    session_id: null,
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
  };
}

describe("buildAgentTheater", () => {
  it("groups steps by agent and prioritizes the active agent", () => {
    const nodes = buildAgentTheater([
      step({ assigned_agent: "analyst", status: "pending", title: "Build model" }),
      step({ assigned_agent: "diligence", status: "in_progress", progress: 0.5, title: "Read docs" }),
      step({ assigned_agent: "analyst", status: "completed", progress: 1, title: "Draft assumptions" }),
    ]);

    expect(nodes[0].agent).toBe("diligence");
    expect(nodes[0].status).toBe("active");
    expect(nodes[0].computations.join(" ")).toContain("Fetching context");
    expect(activeAgent(nodes)).toBe("diligence");
  });

  it("returns done computation lines when every step is complete", () => {
    const nodes = buildAgentTheater([step({ status: "completed", progress: 1 })]);
    expect(nodes[0].status).toBe("done");
    expect(nodes[0].computations.join(" ")).toContain("Persisted output");
  });
});

describe("theaterStatus", () => {
  it("maps statuses to theater states", () => {
    expect(__test.theaterStatus(["in_progress"])).toBe("active");
    expect(__test.theaterStatus(["awaiting_approval"])).toBe("waiting");
    expect(__test.theaterStatus(["completed", "completed"])).toBe("done");
    expect(__test.theaterStatus(["failed"])).toBe("blocked");
    expect(__test.theaterStatus(["pending"])).toBe("queued");
  });
});
