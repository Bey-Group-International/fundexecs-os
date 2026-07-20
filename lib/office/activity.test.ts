import {
  deriveAgentActivity,
  restingActivity,
  type TaskRow,
  type TaskEventRow,
} from "./activity";
import { AGENTS } from "@/lib/agents";

// Minimal row factories — only the columns deriveAgentActivity reads need to be
// realistic; the rest are filled with inert defaults.
function task(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: "t1",
    organization_id: "org",
    prompt_id: null,
    parent_task_id: null,
    title: "Untitled",
    description: null,
    hub: "run",
    assigned_agent: "analyst",
    status: "in_progress",
    progress: 0.5,
    graph_touched: null,
    requires_approval: false,
    result: null,
    created_by: null,
    completed_at: null,
    step_order: 0,
    automation_id: null,
    session_id: null,
    lifecycle_stage: null,
    target_engine: null,
    created_at: "2026-07-20T10:00:00.000Z",
    updated_at: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

function event(overrides: Partial<TaskEventRow>): TaskEventRow {
  return {
    id: "e1",
    organization_id: "org",
    task_id: "t1",
    event_type: "task.progress",
    agent: "analyst",
    hub: "run",
    payload: {},
    created_at: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("deriveAgentActivity", () => {
  it("marks an agent with an in-flight task busy/focusing with a non-empty label", () => {
    const out = deriveAgentActivity({
      tasks: [task({ assigned_agent: "analyst", status: "in_progress", title: "Run a valuation" })],
      events: [],
    });
    expect(out.analyst.busy).toBe(true);
    expect(out.analyst.status).toBe("focusing");
    expect(out.analyst.label).toBe("Run a valuation");
    expect(out.analyst.label.length).toBeGreaterThan(0);
  });

  it("marks an agent busy from an active task_event, labelled from the payload message", () => {
    const out = deriveAgentActivity({
      tasks: [],
      events: [
        event({ agent: "diligence", event_type: "task.progress", payload: { message: "Parsing the CIM…" } }),
      ],
    });
    expect(out.diligence.busy).toBe(true);
    expect(out.diligence.status).toBe("focusing");
    expect(out.diligence.label).toBe("Parsing the CIM");
  });

  it("rests an agent with no active work", () => {
    const out = deriveAgentActivity({ tasks: [], events: [] });
    expect(out.analyst.busy).toBe(false);
    expect(out.analyst.status).toBe("available");
    expect(out.analyst.label.length).toBeGreaterThan(0);
    // Matches the reusable resting helper exactly.
    expect(out.analyst).toEqual(restingActivity("analyst"));
  });

  it("does not treat a completed task as active", () => {
    const out = deriveAgentActivity({
      tasks: [task({ assigned_agent: "fund_admin", status: "completed", title: "Waterfall run" })],
      events: [],
    });
    expect(out.fund_admin.busy).toBe(false);
  });

  it("lets a later terminal event supersede an earlier progress event", () => {
    const out = deriveAgentActivity({
      tasks: [],
      events: [
        event({
          id: "a",
          task_id: "t9",
          agent: "portfolio_ops",
          event_type: "task.progress",
          payload: { message: "Checking KPIs…" },
          created_at: "2026-07-20T10:00:00.000Z",
        }),
        event({
          id: "b",
          task_id: "t9",
          agent: "portfolio_ops",
          event_type: "task.completed",
          payload: { message: "Done" },
          created_at: "2026-07-20T10:05:00.000Z",
        }),
      ],
    });
    expect(out.portfolio_ops.busy).toBe(false);
  });

  it("includes an entry for every known agent", () => {
    const out = deriveAgentActivity({ tasks: [], events: [] });
    for (const agent of AGENTS) {
      expect(out[agent.key]).toBeDefined();
    }
    expect(Object.keys(out)).toHaveLength(AGENTS.length);
  });

  it("ignores unknown agent keys in the data", () => {
    const out = deriveAgentActivity({
      tasks: [task({ assigned_agent: "not_a_real_agent" as TaskRow["assigned_agent"], status: "in_progress" })],
      events: [
        event({ agent: "also_fake" as TaskEventRow["agent"], event_type: "task.progress", payload: { message: "x" } }),
      ],
    });
    expect(out).not.toHaveProperty("not_a_real_agent");
    expect(out).not.toHaveProperty("also_fake");
    expect(Object.keys(out)).toHaveLength(AGENTS.length);
  });

  it("keeps the freshest signal's label when an agent has several", () => {
    const out = deriveAgentActivity({
      tasks: [
        task({ id: "old", assigned_agent: "capital_raiser", title: "Old work", created_at: "2026-07-20T09:00:00.000Z" }),
        task({ id: "new", assigned_agent: "capital_raiser", title: "New work", created_at: "2026-07-20T11:00:00.000Z" }),
      ],
      events: [],
    });
    expect(out.capital_raiser.label).toBe("New work");
  });

  it("is deterministic — identical inputs yield identical output", () => {
    const tasks = [task({ assigned_agent: "rainmaker", title: "Close the round" })];
    const events = [event({ agent: "curator", payload: { message: "Curating the room…" } })];
    const a = deriveAgentActivity({ tasks, events });
    const b = deriveAgentActivity({ tasks, events });
    expect(a).toEqual(b);
  });
});

describe("restingActivity", () => {
  it("derives an idle label from the agent's capabilities", () => {
    const resting = restingActivity("analyst");
    expect(resting.busy).toBe(false);
    expect(resting.status).toBe("available");
    // analyst's first capability is "pro_forma".
    expect(resting.label).toBe("Ready for pro forma");
  });

  it("degrades gracefully for an unknown agent key", () => {
    const resting = restingActivity("nobody");
    expect(resting).toEqual({ status: "available", label: "Idle at desk", busy: false });
  });
});
