// The task engine — multi-step agent workflows (the Copilot choreography).
//
// A prompt becomes a WORKFLOW (parent task) with ordered STEPS (child tasks),
// planned by Claude (lib/claude.ts). The operator approves, then the engine
// executes each step in turn — each producing a real deliverable — emitting
// task_events the live Copilot streams. Human approval gates automation; the
// operator is never bypassed.
import { createServerClient } from "@/lib/supabase/server";
import type { AgentKey, Hub, GraphKind, Json, Task } from "@/lib/supabase/database.types";
import type { TaskEventType } from "@/lib/events";
import { generatePlan, executeStep, type AgentPlan } from "@/lib/claude";

type Client = ReturnType<typeof createServerClient>;

interface Ctx {
  supabase: Client;
  orgId: string;
  actorId: string;
}

function hubToGraph(hub: Hub): GraphKind | null {
  if (hub === "source") return "relationship";
  if (hub === "run") return "deal";
  if (hub === "execute") return "capital";
  return null;
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

/** Create workflow + step rows from a plan, plus the approval gate. */
async function materializePlan(
  ctx: Ctx,
  body: string,
  plan: AgentPlan,
  opts: { promptId?: string | null; workflowId?: string },
): Promise<{ workflow: Task; approvalId: string | null }> {
  let workflow: Task;

  if (opts.workflowId) {
    // Regenerate: clear prior steps, reset the workflow.
    await ctx.supabase.from("tasks").delete().eq("parent_task_id", opts.workflowId);
    const { data } = await ctx.supabase
      .from("tasks")
      .update({
        title: plan.title,
        hub: plan.hub,
        status: "awaiting_approval",
        progress: 0,
        graph_touched: hubToGraph(plan.hub),
        result: null,
        completed_at: null,
      })
      .eq("id", opts.workflowId)
      .select("*")
      .single();
    workflow = data as Task;
  } else {
    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        organization_id: ctx.orgId,
        prompt_id: opts.promptId ?? null,
        title: plan.title,
        description: body,
        hub: plan.hub,
        assigned_agent: "associate",
        status: "awaiting_approval",
        progress: 0,
        graph_touched: hubToGraph(plan.hub),
        requires_approval: true,
        created_by: ctx.actorId,
        step_order: 0,
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Failed to create workflow");
    workflow = data as Task;
  }

  // Steps as child tasks.
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    await ctx.supabase.from("tasks").insert({
      organization_id: ctx.orgId,
      parent_task_id: workflow.id,
      title: step.title,
      description: step.description,
      hub: plan.hub,
      assigned_agent: step.agent,
      status: "pending",
      progress: 0,
      requires_approval: false,
      created_by: ctx.actorId,
      step_order: i + 1,
    });
  }

  await recordEvent(ctx, {
    taskId: workflow.id,
    type: "task.created",
    agent: "associate",
    hub: plan.hub,
    payload: { title: plan.title, steps: plan.steps.length },
  });

  const { data: approval } = await ctx.supabase
    .from("approvals")
    .insert({
      organization_id: ctx.orgId,
      task_id: workflow.id,
      requested_by_agent: "associate",
      summary: `Approve & automate: ${plan.title}`,
    })
    .select("id")
    .single();

  await recordEvent(ctx, {
    taskId: workflow.id,
    type: "approval.requested",
    agent: "associate",
    hub: plan.hub,
    payload: { approval_id: approval?.id, summary: plan.summary },
  });

  return { workflow, approvalId: approval?.id ?? null };
}

/** POST /prompt — plan the prompt into a workflow awaiting approval. */
export async function handlePrompt(ctx: Ctx, body: string) {
  const plan = await generatePlan(body);

  const { data: prompt } = await ctx.supabase
    .from("prompts")
    .insert({
      organization_id: ctx.orgId,
      principal_id: ctx.actorId,
      body,
      routed_hub: plan.hub,
      routed_agent: plan.steps[0]?.agent ?? "associate",
      parsed_intent: plan as unknown as Json,
    })
    .select("id")
    .single();

  const { workflow, approvalId } = await materializePlan(ctx, body, plan, {
    promptId: prompt?.id ?? null,
  });

  return { plan, workflow, approval_id: approvalId };
}

/** Build a short, single-line summary from step outputs, truncated. */
function summarize(priorOutputs: string[], max: number): string {
  const text = priorOutputs.join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/**
 * Best-effort: turn the finished workflow into one real domain record so the
 * hub modules populate from actual work. Failures are swallowed — they must
 * never fail the workflow. "run" artifacts need a deal FK, so we skip them.
 */
async function persistArtifact(ctx: Ctx, workflow: Task, priorOutputs: string[]) {
  try {
    let created: string | null = null;

    switch (workflow.hub) {
      case "source": {
        const { error } = await ctx.supabase.from("deals").insert({
          organization_id: ctx.orgId,
          name: truncate(workflow.title, 80),
          stage: "sourced",
          source: "copilot",
          notes: summarize(priorOutputs, 500),
          lead_principal: ctx.actorId,
        });
        if (!error) created = "deal";
        break;
      }
      case "build": {
        const { error } = await ctx.supabase.from("investment_theses").insert({
          organization_id: ctx.orgId,
          title: truncate(workflow.title, 80),
          summary: summarize(priorOutputs, 240),
          is_active: true,
        });
        if (!error) created = "thesis";
        break;
      }
      case "execute": {
        const { error } = await ctx.supabase.from("assets").insert({
          organization_id: ctx.orgId,
          name: truncate(workflow.title, 80),
          asset_type: "other",
          status: "active",
        });
        if (!error) created = "asset";
        break;
      }
      case "run":
      default:
        break;
    }

    if (created) {
      await recordEvent(ctx, {
        taskId: workflow.id,
        type: "graph.update",
        hub: workflow.hub,
        payload: { created, graph: hubToGraph(workflow.hub) },
      });
    }
  } catch {
    // Best-effort persistence — never fail the workflow on an artifact error.
  }
}

/** Run every step of an approved workflow, each producing a deliverable. */
async function executeWorkflow(ctx: Ctx, workflow: Task) {
  await ctx.supabase
    .from("tasks")
    .update({ status: "in_progress", progress: 0.05 })
    .eq("id", workflow.id);

  const { data: steps } = await ctx.supabase
    .from("tasks")
    .select("*")
    .eq("parent_task_id", workflow.id)
    .order("step_order", { ascending: true });

  const list = (steps ?? []) as Task[];
  const priorOutputs: string[] = [];

  for (let i = 0; i < list.length; i++) {
    const step = list[i];
    await ctx.supabase
      .from("tasks")
      .update({ status: "in_progress", progress: 0.5 })
      .eq("id", step.id);
    await recordEvent(ctx, {
      taskId: workflow.id,
      type: "task.progress",
      agent: step.assigned_agent,
      hub: step.hub,
      payload: { step_id: step.id, message: `${step.title}…`, active_step: step.step_order },
    });

    const output = await executeStep({
      workflowTitle: workflow.title,
      agent: step.assigned_agent,
      stepTitle: step.title,
      stepDescription: step.description ?? "",
      priorOutputs,
    });
    priorOutputs.push(`${step.title}:\n${output}`);

    await ctx.supabase
      .from("tasks")
      .update({
        status: "completed",
        progress: 1,
        completed_at: new Date().toISOString(),
        result: { output } as Json,
      })
      .eq("id", step.id);
    await recordEvent(ctx, {
      taskId: workflow.id,
      type: "task.completed",
      agent: step.assigned_agent,
      hub: step.hub,
      payload: { step_id: step.id, message: `${step.title} — done` },
    });

    await ctx.supabase
      .from("tasks")
      .update({ progress: (i + 1) / Math.max(list.length, 1) })
      .eq("id", workflow.id);
  }

  await ctx.supabase
    .from("tasks")
    .update({
      status: "completed",
      progress: 1,
      completed_at: new Date().toISOString(),
      result: { steps: list.map((s) => s.title) } as Json,
    })
    .eq("id", workflow.id);

  await recordEvent(ctx, {
    taskId: workflow.id,
    type: "task.completed",
    agent: "associate",
    hub: workflow.hub,
    payload: { message: `Completed: ${workflow.title}` },
  });
  if (workflow.graph_touched) {
    await recordEvent(ctx, {
      taskId: workflow.id,
      type: "graph.update",
      hub: workflow.hub,
      payload: { graph: workflow.graph_touched },
    });
  }

  // Persist a real domain record so hub modules populate from actual work.
  await persistArtifact(ctx, workflow, priorOutputs);
}

/** POST /approve — capture the human decision and drive automation. */
export async function decideApproval(
  ctx: Ctx,
  args: { approvalId: string; decision: "approved" | "rejected" | "regenerate"; note?: string },
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

  const { data: workflow } = await ctx.supabase
    .from("tasks")
    .select("*")
    .eq("id", approval.task_id)
    .single();
  if (!workflow) throw new Error("Workflow not found");
  const wf = workflow as Task;

  await recordEvent(ctx, {
    taskId: wf.id,
    type: "approval.response",
    agent: "associate",
    hub: wf.hub,
    payload: { approval_id: args.approvalId, decision: args.decision },
  });

  if (args.decision === "approved") {
    await executeWorkflow(ctx, wf);
  } else if (args.decision === "rejected") {
    await ctx.supabase.from("tasks").update({ status: "cancelled" }).eq("id", wf.id);
    await ctx.supabase
      .from("tasks")
      .update({ status: "cancelled" })
      .eq("parent_task_id", wf.id);
  } else {
    // regenerate: build a fresh plan from the original prompt and re-gate.
    const plan = await generatePlan(wf.description ?? wf.title);
    await materializePlan(ctx, wf.description ?? wf.title, plan, { workflowId: wf.id });
  }

  return { workflowId: wf.id, decision: args.decision };
}
