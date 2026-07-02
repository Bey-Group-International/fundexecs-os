// The task engine — multi-step agent workflows (the Copilot choreography).
//
// A prompt becomes a WORKFLOW (parent task) with ordered STEPS (child tasks),
// planned by Claude (lib/claude.ts). The operator approves, then the engine
// executes each step in turn — each producing a real deliverable — emitting
// task_events the live Copilot streams. Human approval gates automation; the
// operator is never bypassed.
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import type { AgentKey, Hub, GraphKind, ArtifactType, Json, Task } from "@/lib/supabase/database.types";
import type { TaskEventType } from "@/lib/events";
import { generatePlan, generatePlans, executeStep, extractDealFields, extractAssetFields, type AgentPlan } from "@/lib/claude";
import { AGENTS } from "@/lib/agents";
import { activateBrain } from "@/lib/brains";
import type { BrainResult } from "@/lib/brains/types";
import { computeGroundingScore } from "@/lib/grounding";
import { brainForAgent } from "@/lib/brain-routing";
import { buildRouting, deskOverride, engineForStage, executiveForStage, EXECUTIVE_LABEL, type Executive } from "@/lib/intelligence";
import { shouldReuseRecord } from "@/lib/reference-binding";
import { getRoutingCorrections, formatRoutingCorrections } from "@/lib/routing-feedback";
import { recordOperatorFeedback } from "@/lib/team-tasks";
import { classifyStepIntent, dispatchStepTool, formatDispatchOutput } from "@/lib/tool-dispatch";
import { buildArtifactAttestation } from "@/lib/attestation-seal";
import { grantReputation, REPUTATION_POINTS } from "@/lib/reputation";
import { isPrincipalIdentityVerified } from "@/lib/identity";
import { compoundingProfile } from "@/lib/compounding";
import { spendCredits } from "@/lib/credits";
import { effectiveStepCost } from "@/lib/agent-costs";
import { parseStoredEdgeContext, edgeContextToPromptLine, type EdgeContextResult } from "@/lib/edge-context";
import { selectAgentWithContext } from "@/lib/brain-routing";
import { resolveAutonomyForIntent } from "@/lib/autonomy";
import { getActiveMandate } from "@/lib/mandates";

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
      name: args.name.replace(/^\[.*?\]\s*/, "").trim().slice(0, 120) || "Untitled session",
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
async function gatherPriorContext(
  ctx: Ctx,
  sessionId?: string,
  // Pass a pre-fetched EdgeContextResult to avoid a second Supabase round-trip
  // when the caller already holds it (planPrompt / planPrompts).
  prefetchedEdgeContext?: EdgeContextResult | null,
): Promise<string[]> {
  // Closed-loop routing learning: prepend a preamble built from the operator's
  // recent reroute corrections (org-scoped) so the planner stops repeating the
  // same mis-routes. Purely additive and best-effort — a failure here must never
  // break planning, so it's swallowed and the session context flows unchanged.
  let reroute: string[] = [];
  try {
    const preamble = formatRoutingCorrections(await getRoutingCorrections(ctx.supabase, ctx.orgId));
    if (preamble) reroute = [preamble];
  } catch {
    // Ignore — routing-feedback is supplementary to the durable session context.
  }

  if (!sessionId) return reroute;

  // When prefetchedEdgeContext is supplied, skip the session fetch and use it
  // directly. Otherwise fetch both in parallel (single-session callers like
  // runAutomation that don't need agent re-scoring).
  let edgeLine = "";
  let priorData: { description: string | null }[] = [];

  if (prefetchedEdgeContext !== undefined) {
    // Caller already holds the edge context row; just fetch prior tasks.
    const priorRes = await ctx.supabase
      .from("tasks")
      .select("description")
      .eq("session_id", sessionId)
      .is("parent_task_id", null)
      .order("created_at", { ascending: true });
    priorData = (priorRes.data ?? []) as { description: string | null }[];
    edgeLine = prefetchedEdgeContext ? edgeContextToPromptLine(prefetchedEdgeContext) : "";
  } else {
    // `edge_context` added by migration 20260702000012; cast to bypass stale
    // generated types until the next type regeneration cycle.
    const [sessionRes, priorRes] = await Promise.all([
      (ctx.supabase
        .from("sessions")
        .select("edge_context")
        .eq("id", sessionId)
        .single() as unknown as Promise<{ data: { edge_context: unknown } | null; error: unknown }>),
      ctx.supabase
        .from("tasks")
        .select("description")
        .eq("session_id", sessionId)
        .is("parent_task_id", null)
        .order("created_at", { ascending: true }),
    ]);
    priorData = (priorRes.data ?? []) as { description: string | null }[];
    try {
      const parsed = parseStoredEdgeContext(sessionRes.data?.edge_context);
      edgeLine = parsed ? edgeContextToPromptLine(parsed) : "";
    } catch {
      edgeLine = "";
    }
  }

  const turns = priorData.map((t) => t.description?.trim() ?? "").filter(Boolean);
  const active = await gatherActiveContext(ctx, sessionId);
  return [...reroute, ...(edgeLine ? [edgeLine] : []), ...active, ...turns];
}

// Apply an operator's explicit desk delegation to a generated plan, overriding
// Earn's auto-routed owner. Repoints the primary step to a representative agent
// of the desk (and pins a compliance stage for CRO), so the persisted routing —
// and everything derived from it — reflects the delegation. Pure.
export function applyDelegation(plan: AgentPlan, desk: Executive): AgentPlan {
  const ov = deskOverride(desk);
  // Repoint the primary step to the desk's representative agent so the agent-
  // derived owner (used by the UI) matches the delegation. Seed one step when a
  // plan somehow arrives empty, so routing can't silently fall back to a default
  // desk.
  const steps = plan.steps.length
    ? plan.steps.map((s, i) => (i === 0 ? { ...s, agent: ov.primaryAgent } : s))
    : [{ agent: ov.primaryAgent, title: plan.title, description: plan.summary }];
  const lifecycle_stage = ov.stage ?? plan.lifecycle_stage;
  return {
    ...plan,
    steps,
    lifecycle_stage,
    target_engine: ov.engine ?? engineForStage(lifecycle_stage),
    assigned_to: executiveForStage(lifecycle_stage, ov.primaryAgent),
  };
}

// Reads edge context from a session row (best-effort, returns null on miss).
async function getSessionEdgeContext(ctx: Ctx, sessionId?: string): Promise<EdgeContextResult | null> {
  if (!sessionId) return null;
  try {
    // TODO: remove cast after next `supabase gen types` regeneration cycle.
    const { data } = await (ctx.supabase
      .from("sessions")
      .select("edge_context")
      .eq("id", sessionId)
      .single() as unknown as Promise<{ data: { edge_context: unknown } | null }>);
    return parseStoredEdgeContext(data?.edge_context);
  } catch {
    return null;
  }
}

// Re-scores each plan's primary step agent against the edge context bias map.
// Only touches step[0] — the agent that drives hub routing and assigned_to.
// Steps produced by the planner stay otherwise unchanged.
function applyEdgeContextToPlan(plan: AgentPlan, edgeContext: EdgeContextResult | null): AgentPlan {
  if (!edgeContext || !plan.steps.length) return plan;
  const candidates = plan.steps.map((s) => s.agent);
  const best = selectAgentWithContext(candidates, edgeContext);
  if (best === plan.steps[0].agent) return plan;
  return {
    ...plan,
    steps: plan.steps.map((s, i) => (i === 0 ? { ...s, agent: best } : s)),
  };
}

export async function planPrompt(
  ctx: Ctx,
  body: string,
  sessionId?: string,
  delegate?: Executive,
): Promise<AgentPlan> {
  const edgeContext = await getSessionEdgeContext(ctx, sessionId);
  const priorContext = await gatherPriorContext(ctx, sessionId, edgeContext);
  const plan = applyEdgeContextToPlan(await generatePlan(body, priorContext), edgeContext);
  return delegate ? applyDelegation(plan, delegate) : plan;
}

// Multi-intent: plan a prompt into one OR MORE workflows. Returns a single plan
// in the common case; multiple only when the request spans distinct lifecycle
// stages that should be executed and approved independently. When `delegate` is
// set, the operator has overridden routing to a specific desk.
export async function planPrompts(
  ctx: Ctx,
  body: string,
  sessionId?: string,
  delegate?: Executive,
): Promise<AgentPlan[]> {
  const edgeContext = await getSessionEdgeContext(ctx, sessionId);
  const priorContext = await gatherPriorContext(ctx, sessionId, edgeContext);
  const plans = (await generatePlans(body, priorContext)).map((p) =>
    applyEdgeContextToPlan(p, edgeContext),
  );
  return delegate ? plans.map((p) => applyDelegation(p, delegate)) : plans;
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
  // Strip any operator-context prefix from the body before using it as a
  // fallback session name (the client prepends "[The operator is working in …]").
  const sessionName = plans[0]?.title || body.replace(/^\[[\s\S]*?\]\s*/, "").trim() || "Untitled session";
  const session = sessionId ?? (await createSession(ctx, { name: sessionName, origin: "earn" }));
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

export async function handlePrompt(ctx: Ctx, body: string, sessionId?: string, delegate?: Executive) {
  const plans = await planPrompts(ctx, body, sessionId, delegate);
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

/** Load org + active deal context for grounding step prompts. Never throws. */
async function loadOrgContext(ctx: Ctx, workflow: Task): Promise<string> {
  try {
    const { data: org } = await ctx.supabase
      .from("organizations")
      .select("name, entity_type, primary_strategy, description, hq_location, operator_role, aum_range")
      .eq("id", ctx.orgId)
      .single();

    let deal: { name: string; asset_class: string | null; stage: string | null; geography: string | null; target_amount: number | null } | null = null;
    if (workflow.session_id) {
      const { data } = await ctx.supabase
        .from("deals")
        .select("name, asset_class, stage, geography, target_amount")
        .eq("organization_id", ctx.orgId)
        .eq("session_id", workflow.session_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      deal = data ?? null;
    }

    if (!org) return "";

    const lines: string[] = [];
    const firmParts = [
      org.name ? `Firm: ${org.name}` : null,
      org.primary_strategy ? `Strategy: ${org.primary_strategy}` : null,
      org.entity_type ? `Entity: ${org.entity_type}` : null,
      org.aum_range ? `AUM: ${org.aum_range}` : null,
    ].filter(Boolean);
    if (firmParts.length) lines.push(firmParts.join(" | "));
    if (org.description) lines.push(`Description: ${org.description}`);
    const locationParts = [
      org.hq_location ? `HQ: ${org.hq_location}` : null,
      org.operator_role ? `Role: ${org.operator_role}` : null,
    ].filter(Boolean);
    if (locationParts.length) lines.push(locationParts.join(" | "));
    if (deal) {
      const dealDesc = `Active deal: ${deal.name}` +
        (deal.asset_class || deal.stage ? ` (${[deal.asset_class, deal.stage].filter(Boolean).join(", ")})` : "") +
        (deal.target_amount ? ` target $${deal.target_amount.toLocaleString()}` : "");
      lines.push(dealDesc);
    }

    return lines.join("\n");
  } catch {
    return "";
  }
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

  const [orgContext, orgProfile, activeMandate] = await Promise.all([
    loadOrgContext(ctx, workflow),
    // Resolve the org's compounding profile once for the whole workflow so all
    // steps share the same discount.
    compoundingProfile(ctx.orgId),
    // Fetch the active mandate once per workflow. Used to resolve per-step
    // autonomy mode — Tier-1 steps run auto, Tier-2 run auto when pre-authorized
    // by the mandate, Tier-3 always run manual. Best-effort: undefined on miss.
    getActiveMandate(ctx.supabase, ctx.orgId).catch(() => undefined),
  ]);

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

    const stepIntent = classifyStepIntent(step.title, step.description ?? "");
    let output: string;
    try {
      // Debit credits before execution. Throws if insufficient, which the catch
      // block below handles as a step failure — the workflow continues to remaining
      // steps so the operator can top up and re-run rather than losing all work.
      const cost = effectiveStepCost(step.assigned_agent, orgProfile);
      const spent = await spendCredits(ctx.orgId, cost, step.assigned_agent);
      if (!spent.ok) {
        throw new Error(
          `Insufficient credits: ${spent.balance ?? 0} available, ${cost} required. Top up on the Wallet page to continue.`,
        );
      }

      const dispatched = (stepIntent !== "text_generation" && stepIntent !== "draft_document")
        ? await dispatchStepTool({
            intent: stepIntent,
            stepTitle: step.title,
            stepDescription: step.description ?? "",
            workflowTitle: workflow.title,
            agent: step.assigned_agent,
            orgContext,
            orgId: ctx.orgId,
          })
        : null;
      if (dispatched) {
        output = formatDispatchOutput(dispatched);
        // Persist the raw tool result to the step task row so it surfaces in the UI.
        if (dispatched.tool_result) {
          await ctx.supabase
            .from("tasks")
            .update({ result: dispatched.tool_result as Json })
            .eq("id", step.id);
        }
      } else {
        output = await executeStep({
          workflowTitle: workflow.title,
          agent: step.assigned_agent,
          stepTitle: step.title,
          stepDescription: step.description ?? "",
          priorOutputs,
          orgContext,
          documentMode: stepIntent === "draft_document",
        });
      }
    } catch (stepErr) {
      // A step failure must never abort the remaining steps. Mark this step
      // failed, record the error, and continue so later steps still execute.
      const errMsg = stepErr instanceof Error ? stepErr.message : String(stepErr);
      await Promise.all([
        ctx.supabase
          .from("tasks")
          .update({ status: "failed", progress: 0, result: { error: errMsg } as Json })
          .eq("id", step.id),
        recordEvent(ctx, {
          taskId: workflow.id,
          type: "task.completed",
          agent: step.assigned_agent,
          hub: step.hub,
          payload: { step_id: step.id, message: `${step.title} — failed: ${errMsg}` },
        }),
        ctx.supabase
          .from("tasks")
          .update({ progress: (i + 1) / Math.max(list.length, 1) })
          .eq("id", workflow.id),
      ]);
      emitProgress(onProgress, { type: "step_done", step_id: step.id, title: step.title });
      continue;
    }

    // Attribute this step's work to a Brain: the engine ORCHESTRATES, Brains
    // EXECUTE. This logs a brain_runs row tagged with the workflow's session so
    // the step surfaces in the session "Brains at work" theater, and surfaces
    // the passages the Brain consulted as the artifact's grounding. Additive and
    // defensive — a Brain failure must never break the workflow.
    let brain: BrainResult | null = null;
    try {
      brain = await activateBrain(
        { supabase: ctx.supabase, orgId: ctx.orgId, userId: ctx.actorId, sessionId: workflow.session_id ?? null },
        brainForAgent(step.assigned_agent),
        {
          objective: step.description?.trim() || step.title,
          context: priorOutputs.length ? priorOutputs.join("\n\n") : undefined,
          autonomy: resolveAutonomyForIntent(stepIntent, activeMandate),
        },
      );
    } catch {
      // Swallow: Brain attribution is supplementary to the deliverable flow.
    }

    priorOutputs.push(`${step.title}:\n${output}`);

    // Persist the grounding citations alongside the deliverable so the output is
    // verifiable — each is the source the Brain consulted, snippet-trimmed.
    const sources = (brain?.sources ?? []).map((s) => ({
      source: s.source,
      snippet: s.text.slice(0, 240),
      score: s.score,
      kind: s.kind as "document" | "kb",
    }));
    // Automated grounding signal: how much of the deliverable reflects its
    // citations. Persisted now; the human approval gate verifies on top of it.
    const groundingScore = computeGroundingScore(output, sources);

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
          // Trust layer: AI-produced, unverified until signed off, with the
          // Brain's retrieved passages as citations and a link to its reasoning.
          provenance: "ai",
          verification_status: "unverified",
          sources: sources as unknown as Json,
          brain_run_id: brain?.runId ?? null,
          grounding_score: groundingScore,
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
        payload: { artifact_id: artifact?.id, artifact_type: artifactType, title: step.title, sources: sources.length },
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
/**
 * The human half of the trust gate: once an operator approves a workflow, its
 * artifacts are signed off — verification_status flips to 'verified', stamped
 * with who and when. Emits an `artifact.verified` event per artifact so the
 * canvas can flip the badge live. Best-effort and idempotent; verifying an
 * already-verified artifact is a harmless no-op.
 */
async function verifyWorkflowArtifacts(ctx: Ctx, wf: Task, note: string) {
  const { data: rows } = await ctx.supabase
    .from("artifacts")
    .update({
      verification_status: "verified",
      verified_by: ctx.actorId,
      verified_at: new Date().toISOString(),
      verification_note: note,
    })
    .eq("workflow_id", wf.id)
    .eq("verification_status", "unverified")
    .select("id, artifact_type, content, sources, verification_status, verified_by, verified_at, grounding_score");

  const verified = rows ?? [];

  for (const row of verified) {
    await recordEvent(ctx, {
      taskId: wf.id,
      type: "artifact.verified",
      agent: "associate",
      hub: wf.hub,
      payload: { artifact_id: row.id, artifact_type: row.artifact_type },
    });

    // Trust layer (phase 3.1): seal the verified artifact into the attestations
    // rail for tamper-evidence. Best-effort and fully defensive — a sealing
    // failure must never break the approval flow.
    try {
      const attestation = buildArtifactAttestation({
        artifactId: row.id,
        organizationId: ctx.orgId,
        attestedBy: ctx.actorId,
        hashInput: {
          content: row.content ?? "",
          sources: row.sources ?? null,
          verification_status: row.verification_status,
          verified_by: row.verified_by,
          verified_at: row.verified_at,
        },
      });
      const { data: sealed } = await ctx.supabase
        .from("attestations")
        .insert(attestation)
        .select("id")
        .single();
      if (sealed) {
        await recordEvent(ctx, {
          taskId: wf.id,
          type: "artifact.sealed",
          agent: "associate",
          hub: wf.hub,
          payload: {
            artifact_id: row.id,
            attestation_id: sealed.id,
            evidence_hash: attestation.evidence_hash,
          },
        });
      }
    } catch {
      // Swallow: tamper-evident sealing is additive trust, never a gate.
    }
  }

  // Trust layer (compounding loop): producing verified, well-grounded output
  // builds the org's standing. Fully defensive — a reputation failure must NEVER
  // break approval (verification has already happened and been sealed above).
  //
  // Identity is a SOFT gate on MINTING standing only: standing is granted iff the
  // verifying principal is itself identity-verified. If not, we simply skip the
  // grant — verification still stands; only the reputation is withheld (this
  // avoids locking everyone out before anyone is marked verified).
  try {
    if (verified.length > 0 && (await isPrincipalIdentityVerified(ctx.supabase, ctx.actorId))) {
      const service = createServiceClient();
      // Per-artifact, grounding-weighted grant: a better-grounded artifact earns
      // more, floored at 1 so any verified artifact earns something. Bounded by
      // REPUTATION_POINTS.artifact_verified (grounding_score is in [0,1]), so the
      // total per approval can never exceed points * (number of verified rows) —
      // standing is never minted unbounded.
      for (const row of verified) {
        const score = typeof row.grounding_score === "number" ? row.grounding_score : 0;
        const delta = Math.max(1, Math.round(REPUTATION_POINTS.artifact_verified * score));
        await grantReputation(service, ctx.orgId, delta, "artifact_verified", {
          sourceType: "artifact",
          sourceId: row.id,
          note,
        });
      }
    }
  } catch {
    // Swallow: earned standing is additive trust, never a gate on approval.
  }
}

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
  args: {
    approvalId: string;
    decision: "approved" | "rejected" | "regenerate" | "accepted";
    note?: string;
    // When the operator re-routes from the card, the desk to delegate the
    // rebuilt plan to. Only honored on "regenerate".
    delegate?: Executive;
  },
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
    // Operator approval is the authoritative sign-off — verify the deliverables.
    await verifyWorkflowArtifacts(ctx, wf, `Approved by operator${args.note ? `: ${args.note}` : ""}`);
  } else if (args.decision === "accepted") {
    // Accept: the plan stands as the recommendation — no agents run. Capture it
    // as a first-class artifact and mark the workflow done.
    await acceptRecommendation(ctx, wf);
    await verifyWorkflowArtifacts(ctx, wf, "Accepted as recommendation by operator");
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
    const drafted = await generatePlan(base, context);
    const plan = args.delegate ? applyDelegation(drafted, args.delegate) : drafted;
    // A desk re-route is an operator routing correction — log it to the same
    // learning loop the Execution Grid's engine re-route feeds, so the planner
    // stops repeating the mis-route. Best-effort; never blocks the re-plan.
    if (args.delegate) {
      const fromEngine = wf.target_engine ?? "(unrouted)";
      const engineChanged = fromEngine !== plan.target_engine;
      await recordOperatorFeedback(ctx.supabase, [
        {
          organizationId: ctx.orgId,
          principalId: ctx.actorId,
          signal: "reroute",
          subject: engineChanged
            ? `${fromEngine} → ${plan.target_engine}`
            : `Desk → ${EXECUTIVE_LABEL[args.delegate]}`,
          scope: "copilot_card",
          module: "copilot",
          taskId: wf.id,
          sessionId: wf.session_id ?? null,
          metadata: {
            from_engine: fromEngine,
            to_engine: plan.target_engine,
            lifecycle_stage: plan.lifecycle_stage,
            desk: args.delegate,
            title: wf.title,
          },
        },
      ]);
    }
    await materializePlan(ctx, base, plan, { workflowId: wf.id });
  }

  return { workflowId: wf.id, decision: args.decision };
}
