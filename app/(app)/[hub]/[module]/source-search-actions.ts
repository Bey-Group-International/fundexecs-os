"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { getMandate } from "@/lib/build-readiness";
import {
  planSourceSearch,
  generateTargets,
  sourceConfigFor,
  sourcingEnrichmentEnabled,
  type SourcingMandate,
} from "@/lib/source-ai";
import { buildOperatorContext, isPersonalized } from "@/lib/source-intelligence";
import { getCachedCandidates, setCachedCandidates } from "@/lib/source-candidate-cache";
import { verifyCandidates, reverifyCached, type VerifiedCandidate } from "@/lib/source-verification";
import { applyMandateFit, ensureMandateFit, type ScoredCandidate } from "@/lib/source-fit";
import { EntityDedupe } from "@/lib/source-identity";
import { ADD_ROW_CONFIGS } from "@/lib/module-forms";
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
  const supabase = await createServerClient();
  // The mandate and the operator context are independent reads — planning needs
  // both, so fetch them together rather than paying for them back to back.
  const [mandate, context] = await Promise.all([
    loadMandate(orgId),
    buildOperatorContext(supabase, {
      orgId,
      principalId: auth.ctx.userId,
      role: auth.ctx.role,
    }),
  ]);
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

  // One insert for every step instead of a round trip each. step_order is the
  // stable handle back to the plan, since insert order isn't guaranteed on read.
  const stepRows = plan.steps.map((step, i) => ({
    organization_id: orgId,
    parent_task_id: workflowId,
    title: step.title,
    description: step.query,
    hub: "source",
    assigned_agent: step.agent,
    status: "pending",
    progress: 0,
    graph_touched: "relationship",
    requires_approval: false,
    created_by: auth.ctx.userId,
    step_order: i + 1,
    session_id: sessionId,
  }));

  const [{ data: stepTasks }] = await Promise.all([
    supabase.from("tasks").insert(stepRows).select("id, step_order"),
    supabase.from("task_events").insert({
      organization_id: orgId,
      task_id: workflowId,
      event_type: "task.created",
      agent: "associate",
      hub: "source",
      payload: { title: plan.summary || clean, steps: plan.steps.length } as Json,
    }),
  ]);

  const idByOrder = new Map<number, string>(
    ((stepTasks ?? []) as { id: string; step_order: number | null }[])
      .filter((r) => r.step_order != null)
      .map((r) => [r.step_order as number, r.id]),
  );

  const steps: SearchStep[] = [];
  plan.steps.forEach((step, i) => {
    const id = idByOrder.get(i + 1);
    if (!id) return;
    const cfg = sourceConfigFor(step.module);
    steps.push({
      id,
      module: step.module,
      agent: step.agent,
      agentName: AGENT_BY_KEY[step.agent]?.name ?? "Agent",
      title: step.title,
      query: step.query,
      entities: cfg?.entities ?? "targets",
    });
  });
  if (!steps.length) return { ok: false, error: "Could not stage the search steps." };

  return { ok: true, sessionId, workflowId, summary: plan.summary, steps, personalized: isPersonalized(context) };
}

export interface RunStepResult {
  ok: boolean;
  candidates?: (VerifiedCandidate & ScoredCandidate)[];
  /** True when the set came from the short-TTL cache rather than a fresh run. */
  cached?: boolean;
  /** ISO timestamp of the cached generation, for the freshness line. */
  cachedAt?: string;
  error?: string;
}

/** The category enum a module's insert path will accept, for verification. */
function allowedCategories(module: string): string[] {
  const cfg = sourceConfigFor(module);
  if (!cfg || cfg.freeCategory) return [];
  const add = ADD_ROW_CONFIGS[cfg.key];
  return add?.fields.find((f) => f.name === cfg.categoryField)?.options ?? [];
}

// Execute one agent step: generate candidates against the mandate + the step's
// query, verify them, and close the task. Returns the verified candidates.
//
// Steps are independent, so the client runs several at once; everything here is
// written to be safe under that concurrency and to spend as little wall-clock as
// possible — the three context reads happen together, and the task bookkeeping
// runs alongside the generation rather than in front of it.
export async function runSourceStep(args: {
  workflowId: string;
  stepId: string;
  module: string;
  query: string;
  /** Names already surfaced by earlier steps — keeps one plan from repeating itself. */
  exclude?: string[];
  /** Skip the candidate cache and force a fresh generation. */
  refresh?: boolean;
}): Promise<RunStepResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const cfg = sourceConfigFor(args.module);
  if (!cfg) return { ok: false, error: "Unknown module." };

  const orgId = auth.ctx.orgId;
  const supabase = await createServerClient();

  // Progress bookkeeping is for the timeline, not for correctness — start it
  // and get on with the work instead of waiting two round trips to begin.
  const announced = Promise.all([
    supabase.from("tasks").update({ status: "in_progress", progress: 0.5 }).eq("id", args.stepId),
    supabase.from("task_events").insert({
      organization_id: orgId,
      task_id: args.workflowId,
      event_type: "task.progress",
      agent: cfg.agent,
      hub: "source",
      payload: { step_id: args.stepId, message: `Sourcing ${cfg.entities}…` } as Json,
    }),
  ]).catch(() => undefined);

  // Three independent reads: the mandate, what's already in this module, and the
  // operator context. Nothing here depends on anything else here.
  const [mandate, existingRows, context] = await Promise.all([
    loadMandate(orgId),
    supabase
      .from(cfg.table as "investors")
      .select("name")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(120),
    buildOperatorContext(supabase, {
      orgId,
      principalId: auth.ctx.userId,
      role: auth.ctx.role,
      module: args.module,
    }),
  ]);

  const existing = ((existingRows.data ?? []) as { name: string }[]).map((r) => r.name).filter(Boolean);
  // Earlier steps' results count as "already surfaced" so a multi-module plan
  // can't hand the operator the same firm twice under two headings.
  const exclusions = [...existing, ...(args.exclude ?? []).filter(Boolean)];

  const cacheKey = {
    module: args.module,
    mandate,
    query: args.query,
    existing: exclusions,
    enriched: sourcingEnrichmentEnabled(),
  };

  let candidates: (VerifiedCandidate & ScoredCandidate)[];
  let cached = false;
  let cachedAt: string | undefined;

  const hit = await getCachedCandidates(orgId, cacheKey, args.refresh);
  if (hit) {
    // Cached sets were verified before storage. Re-run the free structural
    // checks so a stale entry can't outlive a validation rule change, while
    // keeping the provider corroboration the cache exists to avoid repeating.
    // The cached blend was computed against this same mandate (it's part of the
    // key), so it stands; only an entry predating the scoring gets filled in.
    candidates = await reverifyCached(
      ensureMandateFit(hit.candidates, mandate),
      allowedCategories(args.module),
    );
    cached = true;
    cachedAt = hit.cachedAt;
  } else {
    const generated = await generateTargets(args.module, mandate, exclusions, args.query, context);
    // Re-score against the mandate before verifying, so the evidence-first
    // ranking inside verifyCandidates sorts on the blended figure rather than
    // the model's unaudited one.
    const scored = applyMandateFit(generated, mandate);
    // Nothing reaches the operator unverified: shape and cross-field checks
    // always, provider corroboration when Apollo is configured.
    candidates = await verifyCandidates(scored, allowedCategories(args.module));
    await setCachedCandidates(orgId, cacheKey, candidates);
  }

  // Belt and braces: the cache key can't see another step's in-flight results,
  // so filter the final set against the exclusions one more time.
  const dedupe = new EntityDedupe(exclusions);
  candidates = candidates.filter((c) => dedupe.add(c.name));

  await announced;
  await Promise.all([
    supabase
      .from("tasks")
      .update({ status: "completed", progress: 1, completed_at: new Date().toISOString() })
      .eq("id", args.stepId),
    supabase.from("task_events").insert({
      organization_id: orgId,
      task_id: args.workflowId,
      event_type: "task.completed",
      agent: cfg.agent,
      hub: "source",
      payload: {
        step_id: args.stepId,
        count: candidates.length,
        cached,
        verified: candidates.filter((c) => c.verification.status === "verified").length,
      } as Json,
    }),
  ]);

  return { ok: true, candidates, cached, cachedAt };
}

// Mark the workflow complete once the client has run every step.
export async function completeSourceSearch(workflowId: string): Promise<{ ok: boolean }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false };
  const supabase = await createServerClient();
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
