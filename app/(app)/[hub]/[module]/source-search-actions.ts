"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { getMandate } from "@/lib/build-readiness";
import {
  planSourceSearch,
  generateTargets,
  sourceConfigFor,
  type SourceCandidate,
  type SourcingMandate,
} from "@/lib/source-ai";
import { buildOperatorContext, isPersonalized } from "@/lib/source-intelligence";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { AgentKey, Json } from "@/lib/supabase/database.types";

async function loadMandate(orgId: string): Promise<SourcingMandate | null> {
  const m = await getMandate(orgId);
  if (!m) return null;
  return {
    thesisTitle: m.thesisTitle,
    assetClasses: m.assetClasses,
    geographies: m.geographies,
    checkSizeMin: m.checkSizeMin,
    checkSizeMax: m.checkSizeMax,
    targetIrr: m.targetIrr,
    targetMoic: m.targetMoic,
  };
}

// A planned step enriched with display metadata so the client never needs the
// (Anthropic-importing) engine module.
export interface SearchStep {
  id: string;
  module: string; // full key, e.g. "source/lp_pipeline"
  agent: AgentKey;
  agentName: string;
  title: string;
  query: string;
  /** Plural entity noun for grouping/labels, e.g. "LPs". */
  entities: string;
}

export interface StartSearchResult {
  ok: boolean;
  sessionId?: string | null;
  workflowId?: string;
  summary?: string;
  steps?: SearchStep[];
  /** True when the plan was tuned by this operator's learned preferences. */
  personalized?: boolean;
  error?: string;
}

// Earn briefs the Source team: plan the request, open a session + workflow, and
// stage one (pending) task per agent step. The client then runs the steps,
// which stream the live timeline.
export async function startSourceSearch(prompt: string): Promise<StartSearchResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const clean = String(prompt ?? "").trim().slice(0, 500);
  if (!clean) return { ok: false, error: "Describe what you want to source." };

  const orgId = auth.ctx.orgId;
  const supabase = createServerClient();
  const mandate = await loadMandate(orgId);
  const context = await buildOperatorContext(supabase, {
    orgId,
    principalId: auth.ctx.userId,
    role: auth.ctx.role,
  });
  const plan = await planSourceSearch(clean, mandate, context);
  if (!plan.steps.length) return { ok: false, error: "Couldn't plan that search." };

  const { data: session } = await supabase
    .from("sessions")
    .insert({ organization_id: orgId, name: clean.slice(0, 120), origin: "earn", created_by: auth.ctx.userId })
    .select("id")
    .single();
  const sessionId = session?.id ?? null;

  const { data: workflow, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: orgId,
      title: plan.summary || clean,
      description: `Source search: ${clean}`,
      hub: "source",
      assigned_agent: "associate",
      status: "in_progress",
      progress: 0.05,
      graph_touched: "relationship",
      requires_approval: false,
      created_by: auth.ctx.userId,
      step_order: 0,
      session_id: sessionId,
    })
    .select("id")
    .single();
  if (error || !workflow) return { ok: false, error: error?.message ?? "Could not start the search." };
  const workflowId = workflow.id;

  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: workflowId,
    event_type: "task.created",
    agent: "associate",
    hub: "source",
    payload: { title: plan.summary || clean, steps: plan.steps.length } as Json,
  });

  const steps: SearchStep[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    const cfg = sourceConfigFor(s.module);
    const { data: stepTask } = await supabase
      .from("tasks")
      .insert({
        organization_id: orgId,
        parent_task_id: workflowId,
        title: s.title,
        description: s.query,
        hub: "source",
        assigned_agent: s.agent,
        status: "pending",
        progress: 0,
        graph_touched: "relationship",
        requires_approval: false,
        created_by: auth.ctx.userId,
        step_order: i + 1,
        session_id: sessionId,
      })
      .select("id")
      .single();
    if (stepTask?.id) {
      steps.push({
        id: stepTask.id,
        module: s.module,
        agent: s.agent,
        agentName: AGENT_BY_KEY[s.agent]?.name ?? "Agent",
        title: s.title,
        query: s.query,
        entities: cfg?.entities ?? "targets",
      });
    }
  }

  return { ok: true, sessionId, workflowId, summary: plan.summary, steps, personalized: isPersonalized(context) };
}

export interface RunStepResult {
  ok: boolean;
  candidates?: SourceCandidate[];
  error?: string;
}

// Execute one agent step: stream progress, generate candidates against the
// mandate + the step's query, and close the task. Returns the candidates.
export async function runSourceStep(args: {
  workflowId: string;
  stepId: string;
  module: string;
  query: string;
}): Promise<RunStepResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const cfg = sourceConfigFor(args.module);
  if (!cfg) return { ok: false, error: "Unknown module." };

  const orgId = auth.ctx.orgId;
  const supabase = createServerClient();

  await supabase.from("tasks").update({ status: "in_progress", progress: 0.5 }).eq("id", args.stepId);
  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: args.workflowId,
    event_type: "task.progress",
    agent: cfg.agent,
    hub: "source",
    payload: { step_id: args.stepId, message: `Sourcing ${cfg.entities}…` } as Json,
  });

  const mandate = await loadMandate(orgId);
  const { data } = await supabase
    .from(cfg.table as "investors")
    .select("name")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .limit(60);
  const existing = ((data ?? []) as { name: string }[]).map((r) => r.name).filter(Boolean);
  const context = await buildOperatorContext(supabase, {
    orgId,
    principalId: auth.ctx.userId,
    role: auth.ctx.role,
    module: args.module,
  });
  const candidates = await generateTargets(args.module, mandate, existing, args.query, context);

  await supabase
    .from("tasks")
    .update({ status: "completed", progress: 1, completed_at: new Date().toISOString() })
    .eq("id", args.stepId);
  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: args.workflowId,
    event_type: "task.completed",
    agent: cfg.agent,
    hub: "source",
    payload: { step_id: args.stepId, count: candidates.length } as Json,
  });

  return { ok: true, candidates };
}

// Mark the workflow complete once the client has run every step.
export async function completeSourceSearch(workflowId: string): Promise<{ ok: boolean }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false };
  const supabase = createServerClient();
  await supabase
    .from("tasks")
    .update({ status: "completed", progress: 1, completed_at: new Date().toISOString() })
    .eq("id", workflowId);
  await supabase.from("task_events").insert({
    organization_id: auth.ctx.orgId,
    task_id: workflowId,
    event_type: "task.completed",
    agent: "associate",
    hub: "source",
    payload: { message: "Search complete." } as Json,
  });
  revalidatePath("/source/search");
  revalidatePath("/dashboard");
  return { ok: true };
}
