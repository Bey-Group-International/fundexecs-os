import {
  deriveAgentActivity,
  restingActivity,
  type AgentActivity,
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

// A non-empty glyph is required on every entry.
function assertGlyph(a: AgentActivity) {
  expect(typeof a.glyph).toBe("string");
  expect(a.glyph.length).toBeGreaterThan(0);
}

describe("deriveAgentActivity", () => {
  it("marks an agent with an in-flight task busy/active, with a glyph + non-empty label + a thought from the title", () => {
    const out = deriveAgentActivity({
      tasks: [task({ assigned_agent: "analyst", status: "in_progress", title: "Run a valuation" })],
      events: [],
    });
    expect(out.analyst.busy).toBe(true);
    expect(out.analyst.status).toBe("focusing");
    expect(out.analyst.state).toBe("active");
    expect(out.analyst.label.length).toBeGreaterThan(0);
    assertGlyph(out.analyst);
    // The specific work rides in `thought`, cleaned from the title.
    expect(out.analyst.thought).toBe("Run a valuation");
  });

  it("classifies an active edit event as busy/active with the editing glyph", () => {
    const out = deriveAgentActivity({
      tasks: [],
      events: [
        event({ agent: "pr_director", event_type: "task.progress", payload: { message: "Editing the pitch deck…" } }),
      ],
    });
    expect(out.pr_director.busy).toBe(true);
    expect(out.pr_director.status).toBe("focusing");
    expect(out.pr_director.state).toBe("active");
    expect(out.pr_director.label).toBe("Editing files");
    expect(out.pr_director.glyph).toBe("💻");
    expect(out.pr_director.thought).toBe("Editing the pitch deck");
  });

  it("classifies a search/parse event with the searching glyph", () => {
    const out = deriveAgentActivity({
      tasks: [],
      events: [
        event({ agent: "diligence", event_type: "task.progress", payload: { message: "Parsing the CIM…" } }),
      ],
    });
    expect(out.diligence.busy).toBe(true);
    expect(out.diligence.label).toBe("Searching the codebase");
    expect(out.diligence.glyph).toBe("🔎");
    expect(out.diligence.thought).toBe("Parsing the CIM");
  });

  it("reads a completed event as idle, with the ✅ glyph and 'Wrapped up a task'", () => {
    const out = deriveAgentActivity({
      tasks: [],
      events: [
        event({
          agent: "portfolio_ops",
          event_type: "task.completed",
          payload: { message: "Finished the KPI sweep" },
        }),
      ],
    });
    expect(out.portfolio_ops.busy).toBe(false);
    expect(out.portfolio_ops.state).toBe("idle");
    expect(out.portfolio_ops.status).toBe("available");
    expect(out.portfolio_ops.label).toBe("Wrapped up a task");
    expect(out.portfolio_ops.glyph).toBe("✅");
  });

  it("reads a blocked signal in a progress event as state 'blocked' with the ⛔ glyph", () => {
    const out = deriveAgentActivity({
      tasks: [],
      events: [
        event({
          agent: "fund_admin",
          event_type: "task.progress",
          payload: { message: "Blocked: awaiting bank credentials" },
        }),
      ],
    });
    expect(out.fund_admin.state).toBe("blocked");
    expect(out.fund_admin.status).toBe("focusing");
    expect(out.fund_admin.label).toBe("Blocked — needs input");
    expect(out.fund_admin.glyph).toBe("⛔");
    expect(out.fund_admin.busy).toBe(false);
  });

  it("reads a `blocked` task status as state 'blocked'", () => {
    const out = deriveAgentActivity({
      tasks: [task({ assigned_agent: "analyst", status: "blocked", title: "Stuck on the model" })],
      events: [],
    });
    expect(out.analyst.state).toBe("blocked");
    expect(out.analyst.glyph).toBe("⛔");
  });

  it("reads an `awaiting_approval` task status as state 'paused'", () => {
    const out = deriveAgentActivity({
      tasks: [task({ assigned_agent: "analyst", status: "awaiting_approval", title: "Sign off the memo" })],
      events: [],
    });
    expect(out.analyst.state).toBe("paused");
  });

  it("rests an agent with no active work", () => {
    const out = deriveAgentActivity({ tasks: [], events: [] });
    expect(out.analyst.busy).toBe(false);
    expect(out.analyst.status).toBe("available");
    expect(out.analyst.state).toBe("idle");
    expect(out.analyst.label.length).toBeGreaterThan(0);
    assertGlyph(out.analyst);
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
    expect(out.portfolio_ops.state).toBe("idle");
  });

  it("includes an entry for every known agent, each with a glyph + state", () => {
    const out = deriveAgentActivity({ tasks: [], events: [] });
    const states = new Set(["active", "idle", "blocked", "paused"]);
    for (const agent of AGENTS) {
      const entry = out[agent.key];
      expect(entry).toBeDefined();
      assertGlyph(entry);
      expect(states.has(entry.state)).toBe(true);
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

  it("keeps the freshest signal when an agent has several", () => {
    const out = deriveAgentActivity({
      tasks: [
        task({ id: "old", assigned_agent: "capital_raiser", title: "Old drafting work", created_at: "2026-07-20T09:00:00.000Z" }),
        task({ id: "new", assigned_agent: "capital_raiser", title: "New research work", created_at: "2026-07-20T11:00:00.000Z" }),
      ],
      events: [],
    });
    expect(out.capital_raiser.thought).toBe("New research work");
  });

  it("truncates a long thought to 60 chars or fewer", () => {
    const longTitle = "Reconciling the master fund waterfall against every LP capital account and side letter";
    const out = deriveAgentActivity({
      tasks: [task({ assigned_agent: "fund_admin", status: "in_progress", title: longTitle })],
      events: [],
    });
    expect(out.fund_admin.thought).toBeDefined();
    expect(out.fund_admin.thought!.length).toBeLessThanOrEqual(60);
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
  it("derives an idle label from the agent's capabilities, with an idle glyph + state", () => {
    const resting = restingActivity("analyst");
    expect(resting.busy).toBe(false);
    expect(resting.status).toBe("available");
    expect(resting.state).toBe("idle");
    assertGlyph(resting);
    // analyst's first capability is "pro_forma".
    expect(resting.label).toBe("Ready for pro forma");
  });

  it("degrades gracefully for an unknown agent key", () => {
    const resting = restingActivity("nobody");
    expect(resting.status).toBe("available");
    expect(resting.state).toBe("idle");
    expect(resting.busy).toBe(false);
    expect(resting.label).toBe("Idle at desk");
    assertGlyph(resting);
    expect(resting.thought).toBeUndefined();
  });

  it("is deterministic per key — same key yields the same glyph", () => {
    expect(restingActivity("analyst").glyph).toBe(restingActivity("analyst").glyph);
  });
});
