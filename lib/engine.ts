// The task engine — multi-step agent workflows (the Copilot choreography).
//
// A prompt becomes a WORKFLOW (parent task) with ordered STEPS (child tasks),
// planned by Claude (lib/claude.ts). The operator approves, then the engine
// executes each step in turn — each producing a real deliverable — emitting
// task_events the live Copilot streams. Human approval gates automation; the
// operator is never bypassed.
import { createServerClient } from "@/lib/supabase/server";
import type { AgentKey, Hub, GraphKind, ArtifactType, Json, Task } from "@/lib/supabase/database.types";
import type { TaskEventType } from "@/lib/events";
import { generatePlan, executeStep, extractDealFields, extractAssetFields, type AgentPlan } from "@/lib/claude";

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

/**
 * Classify a step's deliverable into a first-class artifact type from the
 * authoring agent and the step title. Deterministic so it holds in fallback
 * mode (no API key) too. Coarse on purpose — enough to route and badge.
 */
function classifyArtifact(agent: AgentKey, stepTitle: string): ArtifactType {
  const t = stepTitle.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has("ic memo", "ic ", "recommend", "committee")) return "ic_memo";
  if (has("model", "lbo", "dcf", "underwrit", "pro forma", "valuation", "sensitivit"))
    return "model";
  if (has("risk", "flag", "diligence", "red flag")) return "risk_report";
  if (has("summar", "recap", "synthes")) return "summary";
  switch (agent) {
    case "analyst":
      return "analysis";
    case "diligence":
      return "risk_report";
    case "investor_relations":
      return "lp_update";
    case "fund_admin":
    case "portfolio_ops":
    case "associate":
    default:
      return "memo";
  }
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
  opts: {
    promptId?: string | null;
    workflowId?: string;
    automationId?: string | null;
    sessionId?: string | null;
  },
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
        automation_id: opts.automationId ?? null,
        session_id: opts.sessionId ?? null,
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

/**
 * Persist a structured record from a completed workflow so the Command Center
 * populates from real work — not mock data. Source-hub workflows seed a Deal in
 * the pipeline (and adopt the workflow's artifacts); Execute-hub workflows seed
 * an Asset. Fields are extracted by Claude from the prompt + step deliverables,
 * with a deterministic fallback so it holds with no API key.
 *
 * Idempotent: a workflow records its seeded record id on `tasks.result`. A
 * re-approval updates that record in place instead of creating a duplicate.
 */
async function persistOutcome(
  ctx: Ctx,
  workflow: Task,
  artifactIds: string[],
  context: string,
): Promise<{ deal_id?: string; asset_id?: string }> {
  const prior =
    workflow.result && typeof workflow.result === "object"
      ? (workflow.result as { deal_id?: string; asset_id?: string })
      : {};
  const prompt = (workflow.description?.trim() || workflow.title).slice(0, 4000);

  if (workflow.hub === "source") {
    const fields = await extractDealFields({ title: workflow.title, prompt, context });
    const row = {
      organization_id: ctx.orgId,
      // Tag the deal with the session that produced it (migration 0022) so it
      // surfaces inside that session's Source › Deal Pipeline frame.
      session_id: workflow.session_id ?? null,
      name: fields.name,
      asset_class: fields.asset_class,
      geography: fields.geography,
      target_amount: fields.target_amount,
      source: "Copilot",
      lead_principal: ctx.actorId,
      notes: prompt.slice(0, 2000),
    };
    let dealId: string | undefined;
    if (prior.deal_id) {
      // Re-approval: update in place, but only trust the id if a row was hit.
      const { data: updated, error } = await ctx.supabase
        .from("deals")
        .update(row)
        .eq("id", prior.deal_id)
        .eq("organization_id", ctx.orgId)
        .select("id")
        .maybeSingle();
      if (!error && updated) dealId = updated.id;
    }
    if (!dealId) {
      const { data: deal } = await ctx.supabase
        .from("deals")
        .insert({ ...row, stage: "sourced" })
        .select("id")
        .single();
      dealId = deal?.id;
    }
    if (dealId && artifactIds.length) {
      await ctx.supabase.from("artifacts").update({ deal_id: dealId }).in("id", artifactIds);
    }
    return dealId ? { deal_id: dealId } : {};
  }

  if (workflow.hub === "execute") {
    const fields = await extractAssetFields({ title: workflow.title, prompt, context });
    const row = {
      organization_id: ctx.orgId,
      // Tag the asset with the originating session (migration 0022) so it
      // surfaces inside that session's Execute › Asset Management frame.
      session_id: workflow.session_id ?? null,
      name: fields.name,
      asset_type: fields.asset_type,
      current_value: fields.current_value,
      status: "active",
    };
    let assetId: string | undefined;
    if (prior.asset_id) {
      // Re-approval: update in place, but only trust the id if a row was hit.
      const { data: updated, error } = await ctx.supabase
        .from("assets")
        .update(row)
        .eq("id", prior.asset_id)
        .eq("organization_id", ctx.orgId)
        .select("id")
        .maybeSingle();
      if (!error && updated) assetId = updated.id;
    }
    if (!assetId) {
      const { data: asset } = await ctx.supabase.from("assets").insert(row).select("id").single();
      assetId = asset?.id;
    }
    return assetId ? { asset_id: assetId } : {};
  }

  return {};
}

/**
 * Create a Session — the first-class unit of operation. An Earn prompt opens a
 * session named from the prompt; an automated workflow opens one on each run.
 */
async function createSession(
  ctx: Ctx,
  args: { name: string; origin: "earn" | "workflow"; automationId?: string | null },
): Promise<string | undefined> {
  const { data } = await ctx.supabase
    .from("sessions")
    .insert({
      organization_id: ctx.orgId,
      name: args.name.trim().slice(0, 120) || "Untitled session",
      origin: args.origin,
      automation_id: args.automationId ?? null,
      created_by: ctx.actorId,
    })
    .select("id")
    .single();
  return data?.id;
}

/** POST /prompt — plan the prompt into a workflow awaiting approval. */
export async function handlePrompt(ctx: Ctx, body: string, sessionId?: string) {
  const plan = await generatePlan(body);

  // Sessions are the first step in operations: an Earn prompt opens a session
  // (named from the prompt) unless one was already provided.
  const session = sessionId ?? (await createSession(ctx, { name: plan.title || body, origin: "earn" }));

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
    sessionId: session,
  });

  return { plan, workflow, approval_id: approvalId, session_id: session };
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
  const artifactIds: string[] = [];

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

    // Promote the step output to a first-class, typed artifact.
    const artifactType = classifyArtifact(step.assigned_agent, step.title);
    const { data: artifact } = await ctx.supabase
      .from("artifacts")
      .insert({
        organization_id: ctx.orgId,
        workflow_id: workflow.id,
        step_id: step.id,
        title: step.title,
        artifact_type: artifactType,
        agent: step.assigned_agent,
        hub: step.hub,
        content: output,
        created_by: ctx.actorId,
      })
      .select("id")
      .single();
    if (artifact?.id) artifactIds.push(artifact.id);

    await recordEvent(ctx, {
      taskId: workflow.id,
      type: "task.completed",
      agent: step.assigned_agent,
      hub: step.hub,
      payload: { step_id: step.id, message: `${step.title} — done` },
    });
    await recordEvent(ctx, {
      taskId: workflow.id,
      type: "artifact.created",
      agent: step.assigned_agent,
      hub: step.hub,
      payload: { artifact_id: artifact?.id, artifact_type: artifactType, title: step.title },
    });

    await ctx.supabase
      .from("tasks")
      .update({ progress: (i + 1) / Math.max(list.length, 1) })
      .eq("id", workflow.id);
  }

  // Turn the finished work into a structured record (Deal / Asset).
  const outcome = await persistOutcome(ctx, workflow, artifactIds, priorOutputs.join("\n\n"));

  await ctx.supabase
    .from("tasks")
    .update({
      status: "completed",
      progress: 1,
      completed_at: new Date().toISOString(),
      result: { steps: list.map((s) => s.title), ...outcome } as Json,
    })
    .eq("id", workflow.id);

  await recordEvent(ctx, {
    taskId: workflow.id,
    type: "task.completed",
    agent: "associate",
    hub: workflow.hub,
    payload: { message: `Completed: ${workflow.title}`, ...outcome },
  });
  if (workflow.graph_touched) {
    await recordEvent(ctx, {
      taskId: workflow.id,
      type: "graph.update",
      hub: workflow.hub,
      payload: { graph: workflow.graph_touched, ...outcome },
    });
  }
}

/**
 * Fire a saved automation. Plan its natural-language instruction into a
 * workflow (same path as a Copilot prompt), link the run back to the
 * automation, and — only if the automation opts into autonomy — auto-approve
 * and execute it end-to-end, unattended. Otherwise the run queues an approval
 * for the operator, exactly like any prompt. Autonomy is opt-in; the operator
 * is never bypassed by default.
 */
export async function runAutomation(
  ctx: Ctx,
  automation: { id: string; prompt: string; auto_approve: boolean },
): Promise<{ workflowId: string; executed: boolean }> {
  const plan = await generatePlan(automation.prompt);
  // A workflow is an automated session: each run opens one.
  const session = await createSession(ctx, {
    name: plan.title || automation.prompt,
    origin: "workflow",
    automationId: automation.id,
  });
  const { workflow, approvalId } = await materializePlan(ctx, automation.prompt, plan, {
    automationId: automation.id,
    sessionId: session,
  });

  if (automation.auto_approve && approvalId) {
    await decideApproval(ctx, {
      approvalId,
      decision: "approved",
      note: "Auto-approved by automation",
    });
    return { workflowId: workflow.id, executed: true };
  }
  return { workflowId: workflow.id, executed: false };
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
