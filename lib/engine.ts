// The task engine (mock). Implements the sacred loop without real LLM calls:
// a prompt is routed to a hub + agent, a task is created, the assigned agent
// "executes" (advances progress and emits events), then raises an approval
// request. Human approval completes (or regenerates / cancels) the task.
//
// Every state change writes a row to `task_events`, which Realtime streams to
// the live workspace. When real agents land, only the execution body changes —
// the surrounding contract stays put.
import type { createServerClient } from "@/lib/supabase/server";
import type {
  AgentKey,
  Hub,
  GraphKind,
  Json,
  Task,
} from "@/lib/supabase/database.types";
import type { TaskEventType } from "@/lib/events";

type Client = ReturnType<typeof createServerClient>;

interface Ctx {
  supabase: Client;
  orgId: string;
  actorId: string;
}

interface Routing {
  hub: Hub;
  agent: AgentKey;
  title: string;
  graph: GraphKind | null;
}

// Naive keyword intent parser. Deterministic and dependency-free — good enough
// to exercise routing end-to-end until a real parser replaces it.
export function routePrompt(body: string): Routing {
  const t = body.toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));

  let hub: Hub = "run";
  let agent: AgentKey = "associate";
  let graph: GraphKind | null = null;

  if (has("underwrit", "pro forma", "valuation", "irr", "model", "sensitiv")) {
    hub = "run";
    agent = "analyst";
    graph = "deal";
  } else if (has("diligence", "document", "risk", "legal", "lease")) {
    hub = "run";
    agent = "diligence";
    graph = "deal";
  } else if (has("waterfall", "fund accounting", "audit", "carry")) {
    hub = "execute";
    agent = "fund_admin";
    graph = "capital";
  } else if (has("capital call", "distribution", "lp ", "investor", "report")) {
    hub = "execute";
    agent = "investor_relations";
    graph = "capital";
  } else if (has("kpi", "budget", "capex", "variance", "asset")) {
    hub = "execute";
    agent = "portfolio_ops";
  } else if (has("source", "pipeline", "deal", "relationship", "introduc")) {
    hub = "source";
    agent = "associate";
    graph = "relationship";
  }

  const title = body.trim().slice(0, 80) || "Untitled task";
  return { hub, agent, title, graph };
}

async function recordEvent(
  ctx: Ctx,
  args: {
    taskId: string | null;
    type: TaskEventType;
    agent?: AgentKey | null;
    hub?: Hub | null;
    payload?: Record<string, unknown>;
  },
) {
  await ctx.supabase.from("task_events").insert({
    organization_id: ctx.orgId,
    task_id: args.taskId,
    event_type: args.type,
    agent: args.agent ?? null,
    hub: args.hub ?? null,
    payload: (args.payload ?? {}) as Json,
  });
}

/** Mock execution: advance the task, then raise an approval request. */
async function runMockExecution(
  ctx: Ctx,
  task: { id: string; hub: Hub; assigned_agent: AgentKey; title: string },
) {
  await ctx.supabase
    .from("tasks")
    .update({ status: "in_progress", progress: 0.5 })
    .eq("id", task.id);
  await recordEvent(ctx, {
    taskId: task.id,
    type: "task.progress",
    agent: task.assigned_agent,
    hub: task.hub,
    payload: { progress: 0.5, message: `${task.assigned_agent} is working…` },
  });

  const { data: approval } = await ctx.supabase
    .from("approvals")
    .insert({
      organization_id: ctx.orgId,
      task_id: task.id,
      requested_by_agent: task.assigned_agent,
      summary: `Proposed result for: ${task.title}`,
    })
    .select("id")
    .single();

  await ctx.supabase
    .from("tasks")
    .update({ status: "awaiting_approval", progress: 0.8 })
    .eq("id", task.id);

  await recordEvent(ctx, {
    taskId: task.id,
    type: "approval.requested",
    agent: task.assigned_agent,
    hub: task.hub,
    payload: { approval_id: approval?.id, summary: `Proposed result for: ${task.title}` },
  });

  return approval?.id ?? null;
}

/** Entry point for POST /prompt: store the prompt, route it, create the task. */
export async function handlePrompt(ctx: Ctx, body: string) {
  const routing = routePrompt(body);

  const { data: prompt } = await ctx.supabase
    .from("prompts")
    .insert({
      organization_id: ctx.orgId,
      principal_id: ctx.actorId,
      body,
      routed_hub: routing.hub,
      routed_agent: routing.agent,
      parsed_intent: {
        hub: routing.hub,
        agent: routing.agent,
        graph: routing.graph,
      } as Json,
    })
    .select("id")
    .single();

  const task = await createTask(ctx, {
    title: routing.title,
    description: body,
    hub: routing.hub,
    agent: routing.agent,
    graph: routing.graph,
    promptId: prompt?.id ?? null,
  });

  return { routing, prompt_id: prompt?.id ?? null, task };
}

/** Entry point for POST /task. Also used internally by handlePrompt. */
export async function createTask(
  ctx: Ctx,
  args: {
    title: string;
    description?: string | null;
    hub: Hub;
    agent: AgentKey;
    graph?: GraphKind | null;
    promptId?: string | null;
    requiresApproval?: boolean;
  },
): Promise<Task> {
  const { data: task, error } = await ctx.supabase
    .from("tasks")
    .insert({
      organization_id: ctx.orgId,
      prompt_id: args.promptId ?? null,
      title: args.title,
      description: args.description ?? null,
      hub: args.hub,
      assigned_agent: args.agent,
      graph_touched: args.graph ?? null,
      requires_approval: args.requiresApproval ?? true,
      status: "pending",
      progress: 0,
      created_by: ctx.actorId,
    })
    .select("*")
    .single();

  if (error || !task) throw new Error(error?.message ?? "Failed to create task");

  await recordEvent(ctx, {
    taskId: task.id,
    type: "task.created",
    agent: args.agent,
    hub: args.hub,
    payload: { title: args.title },
  });

  await runMockExecution(ctx, {
    id: task.id,
    hub: args.hub,
    assigned_agent: args.agent,
    title: args.title,
  });

  return task;
}

/** POST /handoff: transfer a task to another agent. */
export async function handoffTask(
  ctx: Ctx,
  args: { taskId: string; toAgent: AgentKey; reason?: string },
) {
  const { data: task } = await ctx.supabase
    .from("tasks")
    .select("*")
    .eq("id", args.taskId)
    .single();
  if (!task) throw new Error("Task not found");

  await ctx.supabase.from("task_handoffs").insert({
    organization_id: ctx.orgId,
    task_id: args.taskId,
    from_agent: task.assigned_agent,
    to_agent: args.toAgent,
    reason: args.reason ?? null,
  });

  await ctx.supabase
    .from("tasks")
    .update({ assigned_agent: args.toAgent, status: "in_progress" })
    .eq("id", args.taskId);

  await recordEvent(ctx, {
    taskId: args.taskId,
    type: "task.handoff",
    agent: args.toAgent,
    hub: task.hub,
    payload: { from_agent: task.assigned_agent, to_agent: args.toAgent, reason: args.reason },
  });
}

/** POST /approve: capture the human decision and resolve the loop. */
export async function decideApproval(
  ctx: Ctx,
  args: {
    approvalId: string;
    decision: "approved" | "rejected" | "regenerate";
    note?: string;
  },
) {
  const { data: approval } = await ctx.supabase
    .from("approvals")
    .select("*")
    .eq("id", args.approvalId)
    .single();
  if (!approval) throw new Error("Approval not found");

  await ctx.supabase
    .from("approvals")
    .update({
      decision: args.decision,
      decided_by: ctx.actorId,
      decided_at: new Date().toISOString(),
      note: args.note ?? null,
    })
    .eq("id", args.approvalId);

  const { data: task } = await ctx.supabase
    .from("tasks")
    .select("*")
    .eq("id", approval.task_id)
    .single();
  if (!task) throw new Error("Task not found");

  await recordEvent(ctx, {
    taskId: task.id,
    type: "approval.response",
    agent: task.assigned_agent,
    hub: task.hub,
    payload: { approval_id: args.approvalId, decision: args.decision },
  });

  if (args.decision === "approved") {
    await ctx.supabase
      .from("tasks")
      .update({
        status: "completed",
        progress: 1,
        completed_at: new Date().toISOString(),
        result: { approved: true, summary: `Completed: ${task.title}` } as Json,
      })
      .eq("id", task.id);
    await recordEvent(ctx, {
      taskId: task.id,
      type: "task.completed",
      agent: task.assigned_agent,
      hub: task.hub,
      payload: { message: `Completed: ${task.title}` },
    });
    if (task.graph_touched) {
      await recordEvent(ctx, {
        taskId: task.id,
        type: "graph.update",
        agent: task.assigned_agent,
        hub: task.hub,
        payload: { graph: task.graph_touched },
      });
    }
  } else if (args.decision === "rejected") {
    await ctx.supabase.from("tasks").update({ status: "cancelled" }).eq("id", task.id);
  } else {
    // regenerate: run another execution pass that raises a fresh approval.
    await runMockExecution(ctx, {
      id: task.id,
      hub: task.hub,
      assigned_agent: task.assigned_agent,
      title: task.title,
    });
  }

  return { taskId: task.id, decision: args.decision };
}
