import { buildRoutingTrace, buildOutcome, desksForSteps } from "@/lib/routing-trace";
import { deriveRouting } from "@/lib/intelligence";
import type { Task, Approval } from "@/lib/supabase/database.types";

// Minimal Task/Approval fixtures — only the fields the pure helpers read.
function task(over: Partial<Task> = {}): Task {
  return {
    id: "wf1",
    organization_id: "org1",
    prompt_id: null,
    parent_task_id: null,
    title: "Diligence on Project Atlas",
    description: "Run diligence on Project Atlas",
    hub: "run",
    assigned_agent: "diligence",
    status: "awaiting_approval",
    progress: 0,
    graph_touched: null,
    requires_approval: true,
    result: null,
    created_by: "u1",
    completed_at: null,
    step_order: 0,
    automation_id: null,
    session_id: "s1",
    lifecycle_stage: "Diligence",
    target_engine: "Diligence Engine",
    created_at: "2026-06-22T14:00:00.000Z",
    updated_at: "2026-06-22T14:00:00.000Z",
    ...over,
  } as Task;
}

function step(over: Partial<Task> = {}): Task {
  return task({ id: "st1", parent_task_id: "wf1", status: "pending", ...over });
}

function approval(over: Partial<Approval> = {}): Approval {
  return {
    id: "ap1",
    organization_id: "org1",
    task_id: "wf1",
    requested_by_agent: "diligence",
    summary: "Approve to run diligence",
    decision: "pending",
    decided_by: null,
    decided_at: null,
    note: null,
    created_at: "2026-06-22T14:00:00.000Z",
    updated_at: "2026-06-22T14:00:00.000Z",
    ...over,
  } as Approval;
}

describe("desksForSteps", () => {
  it("lists distinct executive desks in first-seen order", () => {
    const routing = deriveRouting({ prompt: "x", hub: "run", agents: ["diligence"] });
    const desks = desksForSteps(
      [step({ assigned_agent: "diligence" }), step({ assigned_agent: "analyst" }), step({ assigned_agent: "diligence" })],
      routing,
    );
    expect(desks).toEqual(["Analyst.AI", "CIO.AI"]);
  });

  it("falls back to the routed owner when there are no steps", () => {
    const routing = deriveRouting({ prompt: "diligence", hub: "run", agents: ["diligence"] });
    expect(desksForSteps([], routing)).toEqual(["Analyst.AI"]);
  });
});

describe("buildRoutingTrace", () => {
  it("produces the five-leg path with a pending gate when awaiting sign-off", () => {
    const trace = buildRoutingTrace({ workflow: task(), steps: [step()], approval: approval() });
    expect(trace.map((n) => n.key)).toEqual(["intent", "engine", "hub", "desk", "gate"]);
    const gate = trace.find((n) => n.key === "gate")!;
    expect(gate.value).toBe("Your sign-off");
    expect(gate.state).toBe("pending");
    expect(gate.at).toBeNull();
  });

  it("marks the gate done and timestamped once a decision lands", () => {
    const trace = buildRoutingTrace({
      workflow: task({ status: "completed" }),
      steps: [step({ status: "completed" })],
      approval: approval({ decision: "approved", decided_at: "2026-06-22T14:05:00.000Z" }),
    });
    const gate = trace.find((n) => n.key === "gate")!;
    expect(gate.value).toBe("Approved");
    expect(gate.state).toBe("done");
    expect(gate.at).toBe("2026-06-22T14:05:00.000Z");
  });

  it("shows an internal auto-run gate for ungated work", () => {
    const trace = buildRoutingTrace({
      workflow: task({ requires_approval: false }),
      steps: [step()],
      approval: null,
    });
    const gate = trace.find((n) => n.key === "gate")!;
    expect(gate.value).toBe("Internal — auto-run");
    expect(gate.state).toBe("done");
  });
});

describe("buildOutcome", () => {
  it("is 'none' with no approval", () => {
    expect(buildOutcome({ workflow: task(), steps: [], approval: null }).kind).toBe("none");
  });

  it("is 'pending' while awaiting a decision", () => {
    const o = buildOutcome({ workflow: task(), steps: [step(), step()], approval: approval() });
    expect(o.kind).toBe("pending");
    expect(o.detail).toContain("2 steps");
  });

  it("reports approved & automated with step progress and the saved automation", () => {
    const o = buildOutcome({
      workflow: task({ status: "completed", automation_id: "auto1" }),
      steps: [step({ status: "completed" }), step({ status: "completed" })],
      approval: approval({ decision: "approved", decided_at: "2026-06-22T14:05:00.000Z" }),
    });
    expect(o.kind).toBe("approved");
    expect(o.headline).toBe("Approved & automated");
    expect(o.detail).toContain("2 of 2 steps complete");
    expect(o.detail).toContain("automation saved");
    expect(o.automationId).toBe("auto1");
  });

  it("reports an accepted recommendation distinctly from automation", () => {
    const o = buildOutcome({
      workflow: task({ status: "completed" }),
      steps: [step()],
      approval: approval({ decision: "accepted", decided_at: "2026-06-22T14:05:00.000Z" }),
    });
    expect(o.kind).toBe("accepted");
    expect(o.headline).toBe("Accepted as recommendation");
  });

  it("reports a decline", () => {
    const o = buildOutcome({
      workflow: task({ status: "cancelled" }),
      steps: [step({ status: "cancelled" })],
      approval: approval({ decision: "rejected", decided_at: "2026-06-22T14:05:00.000Z" }),
    });
    expect(o.kind).toBe("declined");
    expect(o.headline).toBe("Declined");
  });
});
