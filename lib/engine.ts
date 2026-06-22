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
import { generatePlan, generatePlans, executeStep, extractDealFields, extractAssetFields, type AgentPlan } from "@/lib/claude";
import { AGENTS } from "@/lib/agents";
import { activateBrain } from "@/lib/brains";
import { brainForAgent } from "@/lib/brain-routing";
import { buildRouting } from "@/lib/intelligence";
import { shouldReuseRecord } from "@/lib/reference-binding";

type Client = ReturnType<typeof createServerClient>;

interface Ctx {
  supabase: Client;
  orgId: string;
  actorId: string;
}

/**
 * Live execution progress, surfaced to a caller that wants to stream step
 * state into the canvas. Purely observational — emitting these never changes
 * what the engine persists or how the human-approval gate behaves. Callers that
 * pass no callback get identical behavior.
 */
export type ProgressEvent =
  | { type: "step_start"; step_id: string; title: string; step_order: number }
  | { type: "step_done"; step_id: string; title: string }
  | { type: "workflow_done"; workflow_id: string };

type OnProgress = (ev: ProgressEvent) => void;

// Emit a progress event defensively: an observer throwing must never break the
// (already-persisted) workflow run.
function emitProgress(onProgress: OnProgress | undefined, ev: ProgressEvent) {
  if (!onProgress) return;
  try {
    onProgress(ev);
  } catch {
    // Swallow — progress is supplementary to the durable task/event writes.
  }
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
        lifecycle_stage: plan.lifecycle_stage,
        target_engine: plan.target_engine,
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
        lifecycle_stage: plan.lifecycle_stage,
        target_engine: plan.target_engine,
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

  // Steps as child tasks — batch insert in one round trip.
  await ctx.supabase.from("tasks").insert(
    plan.steps.map((step, i) => ({
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
    })),
  );

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
 *
 * Reference binding: a NEW follow-up workflow in the same session has no prior
 * id of its own, but it often means the session's EXISTING record ("update the
 * deal", "revise the model"). When no prior id exists, we look up the session's
 * most-recent deal/asset and — using the conservative, deterministic
 * `shouldReuseRecord` cue test — bind to it (update in place) instead of minting
 * a duplicate. A genuinely different request still creates a new record.
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
    } else if (workflow.session_id) {
      // Reference binding: a follow-up workflow with no prior id of its own may
      // mean the session's existing deal. Bind to the most-recent one when the
      // prompt/extracted name says so, and update it in place.
      const { data: existing } = await ctx.supabase
        .from("deals")
        .select("id, name")
        .eq("organization_id", ctx.orgId)
        .eq("session_id", workflow.session_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (
        existing &&
        shouldReuseRecord({ promptText: prompt, existingName: existing.name, extractedName: fields.name })
      ) {
        const { data: updated, error } = await ctx.supabase
          .from("deals")
          .update(row)
          .eq("id", existing.id)
          .eq("organization_id", ctx.orgId)
          .select("id")
          .maybeSingle();
        if (!error && updated) dealId = updated.id;
      }
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
    } else if (workflow.session_id) {
      // Reference binding: a follow-up workflow with no prior id of its own may
      // mean the session's existing asset. Bind to the most-recent one when the
      // prompt/extracted name says so, and update it in place.
      const { data: existing } = await ctx.supabase
        .from("assets")
        .select("id, name")
        .eq("organization_id", ctx.orgId)
        .eq("session_id", workflow.session_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (
        existing &&
        shouldReuseRecord({ promptText: prompt, existingName: existing.name, extractedName: fields.name })
      ) {
        const { data: updated, error } = await ctx.supabase
          .from("assets")
          .update(row)
          .eq("id", existing.id)
          .eq("organization_id", ctx.orgId)
          .select("id")
          .maybeSingle();
        if (!error && updated) assetId = updated.id;
      }
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

/**
 * Contextual awareness: surface the session's active deal/asset so the planner
 * can resolve references like "the deal" or "the model" instead of reading the
 * follow-up in isolation. Returns short context lines (newest entity first).
 */
async function gatherActiveContext(ctx: Ctx, sessionId: string): Promise<string[]> {
  const [dealRes, assetRes] = await Promise.all([
    ctx.supabase
      .from("deals")
      .select("name, asset_class, stage")
      .eq("organization_id", ctx.orgId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1),
    ctx.supabase
      .from("assets")
      .select("name, asset_type")
      .eq("organization_id", ctx.orgId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const lines: string[] = [];
  const deal = dealRes.data?.[0];
  if (deal?.name) {
    lines.push(
      `Active deal in this session: "${deal.name}"${deal.asset_class ? ` (${deal.asset_class})` : ""}${
        deal.stage ? `, stage: ${deal.stage}` : ""
      }. Resolve "the deal" to this.`,
    );
  }
  const asset = assetRes.data?.[0];
  if (asset?.name) {
    lines.push(`Active asset in this session: "${asset.name}". Resolve "the asset"/"the model" to this.`);
  }
  return lines;
}

/** POST /prompt — plan the prompt into a workflow awaiting approval. */
// Draft the plan for a prompt (no writes). Split out so the streaming endpoint
// can reveal the plan in the canvas before materializing it.
// Inside an existing session, replay its earlier prompts so Earn plans the
// follow-up with the conversation in mind (oldest first), plus the active
// deal/asset so references like "the deal" resolve.
async function gatherPriorContext(ctx: Ctx, sessionId?: string): Promise<string[]> {
  if (!sessionId) return [];
  const { data: prior } = await ctx.supabase
    .from("tasks")
    .select("description")
    .eq("session_id", sessionId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: true });
  const turns = ((prior ?? []) as { description: string | null }[])
    .map((t) => t.description?.trim() ?? "")
    .filter(Boolean);
  const active = await gatherActiveContext(ctx, sessionId);
  return [...active, ...turns];
}

export async function planPrompt(ctx: Ctx, body: string, sessionId?: string): Promise<AgentPlan> {
  return generatePlan(body, await gatherPriorContext(ctx, sessionId));
}

// Multi-intent: plan a prompt into one OR MORE workflows. Returns a single plan
// in the common case; multiple only when the request spans distinct lifecycle
// stages that should be executed and approved independently.
export async function planPrompts(ctx: Ctx, body: string, sessionId?: string): Promise<AgentPlan[]> {
  return generatePlans(body, await gatherPriorContext(ctx, sessionId));
}

// Persist a single (pre-drafted) plan as a gated workflow. Thin wrapper over
// materializePrompts so the single-workflow path can't drift from the multi one.
export async function materializePrompt(ctx: Ctx, body: string, plan: AgentPlan, sessionId?: string) {
  const { workflows, session_id } = await materializePrompts(ctx, body, [plan], sessionId);
  const primary = workflows[0];
  return { workflow: primary.workflow, approval_id: primary.approval_id, session_id };
}

/**
 * Materialize one OR MORE plans into independent sibling workflows in a single
 * session. Each workflow keeps its own approval gate and engine routing (the
 * spec's "split and route independently"). One prompt row records the original
 * message; each split workflow's description is its own slice (the plan summary)
 * so the cards read distinctly rather than repeating the full prompt.
 */
export async function materializePrompts(ctx: Ctx, body: string, plans: AgentPlan[], sessionId?: string) {
  const session = sessionId ?? (await createSession(ctx, { name: plans[0]?.title || body, origin: "earn" }));
  const split = plans.length > 1;

  const routings = plans.map((plan) =>
    buildRouting({
      prompt: body,
      hub: plan.hub,
      agents: plan.steps.map((s) => s.agent),
      stage: plan.lifecycle_stage,
    }),
  );

  // One prompt row for the operator's message; parsed_intent carries every
  // routed workflow so the split is auditable.
  const { data: prompt } = await ctx.supabase
    .from("prompts")
    .insert({
      organization_id: ctx.orgId,
      principal_id: ctx.actorId,
      body,
      routed_hub: plans[0]?.hub ?? "run",
      routed_agent: plans[0]?.steps[0]?.agent ?? "associate",
      parsed_intent: {
        split,
        workflows: plans.map((plan, i) => ({ ...plan, routing: routings[i] })),
      } as unknown as Json,
    })
    .select("id")
    .single();

  const workflows = [];
  for (const plan of plans) {
    const { workflow, approvalId } = await materializePlan(
      ctx,
      split ? plan.summary || plan.title : body,
      plan,
      { promptId: prompt?.id ?? null, sessionId: session },
    );
    workflows.push({ plan, workflow, approval_id: approvalId });
  }

  return { workflows, session_id: session, split };
}

export async function handlePrompt(ctx: Ctx, body: string, sessionId?: string) {
  const plans = await planPrompts(ctx, body, sessionId);
  const { workflows, session_id, split } = await materializePrompts(ctx, body, plans, sessionId);
  const primary = workflows[0];
  // Keep the original single-workflow contract (plan/workflow/approval_id) for
  // existing callers; expose the full set + split flag for richer consumers.
  return {
    plan: primary?.plan,
    workflow: primary?.workflow,
    approval_id: primary?.approval_id ?? null,
    workflows,
    split,
    session_id,
  };
}

/**
 * Run every step of an approved workflow, each producing a deliverable.
 *
 * `onProgress` is an optional observer that receives live step/workflow events
 * so a streaming caller can light up the canvas as steps execute. It is fired
 * after the matching DB write, so an emitted event always reflects persisted
 * state. Omitting it yields identical behavior to the gated path.
 */
async function executeWorkflow(ctx: Ctx, workflow: Task, onProgress?: OnProgress) {
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
    await Promise.all([
      ctx.supabase.from("tasks").update({ status: "in_progress", progress: 0.5 }).eq("id", step.id),
      recordEvent(ctx, {
        taskId: workflow.id,
        type: "task.progress",
        agent: step.assigned_agent,
        hub: step.hub,
        payload: { step_id: step.id, message: `${step.title}…`, active_step: step.step_order },
      }),
    ]);
    emitProgress(onProgress, {
      type: "step_start",
      step_id: step.id,
      title: step.title,
      step_order: step.step_order,
    });

    const output = await executeStep({
      workflowTitle: workflow.title,
      agent: step.assigned_agent,
      stepTitle: step.title,
      stepDescription: step.description ?? "",
      priorOutputs,
    });
    // Attribute this step's work to a Brain: the engine ORCHESTRATES, Brains
    // EXECUTE. This logs a brain_runs row tagged with the workflow's session so
    // the step surfaces in the session "Brains at work" theater. Additive and
    // defensive — a Brain failure must never break the workflow.
    try {
      await activateBrain(
        { supabase: ctx.supabase, orgId: ctx.orgId, userId: ctx.actorId, sessionId: workflow.session_id ?? null },
        brainForAgent(step.assigned_agent),
        {
          objective: step.description?.trim() || step.title,
          context: priorOutputs.length ? priorOutputs.join("\n\n") : undefined,
          autonomy: "semi",
        },
      );
    } catch {
      // Swallow: Brain attribution is supplementary to the deliverable flow.
    }

    priorOutputs.push(`${step.title}:\n${output}`);

    const artifactType = classifyArtifact(step.assigned_agent, step.title);
    const [, { data: artifact }] = await Promise.all([
      ctx.supabase
        .from("tasks")
        .update({ status: "completed", progress: 1, completed_at: new Date().toISOString(), result: { output } as Json })
        .eq("id", step.id),
      ctx.supabase
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
        .single(),
    ]);
    if (artifact?.id) artifactIds.push(artifact.id);

    await Promise.all([
      recordEvent(ctx, {
        taskId: workflow.id,
        type: "task.completed",
        agent: step.assigned_agent,
        hub: step.hub,
        payload: { step_id: step.id, message: `${step.title} — done` },
      }),
      recordEvent(ctx, {
        taskId: workflow.id,
        type: "artifact.created",
        agent: step.assigned_agent,
        hub: step.hub,
        payload: { artifact_id: artifact?.id, artifact_type: artifactType, title: step.title },
      }),
      ctx.supabase
        .from("tasks")
        .update({ progress: (i + 1) / Math.max(list.length, 1) })
        .eq("id", workflow.id),
    ]);
    emitProgress(onProgress, { type: "step_done", step_id: step.id, title: step.title });
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

  emitProgress(onProgress, { type: "workflow_done", workflow_id: workflow.id });
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

/**
 * Accept a plan as the recommendation: no agents execute. The plan (summary +
 * ordered steps) is promoted to a memo artifact so it's a durable deliverable,
 * and the workflow is marked complete.
 */
async function acceptRecommendation(ctx: Ctx, wf: Task) {
  const { data: stepData } = await ctx.supabase
    .from("tasks")
    .select("*")
    .eq("parent_task_id", wf.id)
    .order("step_order", { ascending: true });
  const steps = (stepData ?? []) as Task[];

  const body =
    `# ${wf.title}\n\n` +
    `Accepted as the recommendation — agents were not run.\n\n` +
    `## Recommended approach\n` +
    steps
      .map((s, i) => {
        const agent = AGENTS.find((a) => a.key === s.assigned_agent)?.name ?? s.assigned_agent;
        return `${i + 1}. **${s.title}** — ${s.description ?? ""} _(${agent})_`;
      })
      .join("\n");

  const { data: artifact } = await ctx.supabase
    .from("artifacts")
    .insert({
      organization_id: ctx.orgId,
      workflow_id: wf.id,
      step_id: null,
      title: `${wf.title} — Recommendation`,
      artifact_type: "memo",
      agent: "associate",
      hub: wf.hub,
      content: body,
      created_by: ctx.actorId,
    })
    .select("id")
    .single();

  await ctx.supabase
    .from("tasks")
    .update({
      status: "completed",
      progress: 1,
      completed_at: new Date().toISOString(),
      result: { accepted: true, recommendation: true } as Json,
    })
    .eq("id", wf.id);

  await recordEvent(ctx, {
    taskId: wf.id,
    type: "artifact.created",
    agent: "associate",
    hub: wf.hub,
    payload: { artifact_id: artifact?.id, artifact_type: "memo", title: `${wf.title} — Recommendation` },
  });
}

/**
 * POST /approve — capture the human decision and drive automation.
 *
 * `onProgress` (optional) lets a streaming caller observe live step execution
 * on the "approved" path; it changes nothing about the gate or persistence and
 * is ignored for every other decision. Existing callers pass nothing.
 */
export async function decideApproval(
  ctx: Ctx,
  args: { approvalId: string; decision: "approved" | "rejected" | "regenerate" | "accepted"; note?: string },
  onProgress?: OnProgress,
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
    // Persist the approved instruction as a saved Workflow so the operator can
    // re-run, edit, or — to conserve credits — stop it later from the Workflows
    // page. Skip when this run was itself spawned by an automation (no dupes).
    if (!wf.automation_id) {
      const { data: automation } = await ctx.supabase
        .from("automations")
        .insert({
          organization_id: ctx.orgId,
          name: wf.title,
          prompt: wf.description ?? wf.title,
          trigger_type: "manual",
          schedule: null,
          // They clicked "Approve & automate" — future Run-now executions go
          // end-to-end. Editable (and pausable) from the Workflows page.
          auto_approve: true,
          enabled: true,
          created_by: ctx.actorId,
        })
        .select("id")
        .single();
      if (automation?.id) {
        await ctx.supabase
          .from("tasks")
          .update({ automation_id: automation.id })
          .eq("id", wf.id);
      }
    }
    await executeWorkflow(ctx, wf, onProgress);
  } else if (args.decision === "accepted") {
    // Accept: the plan stands as the recommendation — no agents run. Capture it
    // as a first-class artifact and mark the workflow done.
    await acceptRecommendation(ctx, wf);
  } else if (args.decision === "rejected") {
    await ctx.supabase.from("tasks").update({ status: "cancelled" }).eq("id", wf.id);
    await ctx.supabase
      .from("tasks")
      .update({ status: "cancelled" })
      .eq("parent_task_id", wf.id);
  } else {
    // regenerate: build a fresh plan from the original prompt and re-gate. A note
    // (e.g. answers to Earn's clarifying questions) refines the new plan.
    const base = wf.description ?? wf.title;
    const context = args.note?.trim() ? [`Operator clarification: ${args.note.trim()}`] : [];
    const plan = await generatePlan(base, context);
    await materializePlan(ctx, base, plan, { workflowId: wf.id });
  }

  return { workflowId: wf.id, decision: args.decision };
}
