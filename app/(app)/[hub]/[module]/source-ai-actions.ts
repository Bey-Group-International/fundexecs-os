"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { gateDecision, type ActionKind } from "@/lib/gates";
import { getActiveMandate } from "@/lib/mandates";
import { getMandate } from "@/lib/build-readiness";
import { dispatchAction } from "@/lib/integrations";
import { recordDispatch } from "@/lib/integrations/log";
import {
  generateTargets,
  scorePipeline as scorePipelineEngine,
  sourceConfigFor,
  type SourceCandidate,
  type PipelineScore,
  type SourcingMandate,
} from "@/lib/source-ai";
import type { AgentKey, InvestorType, Json } from "@/lib/supabase/database.types";

// The Source agent that owns each sourcing action — drives task assignment.
const AGENT_FOR_ACTION: Partial<Record<ActionKind, AgentKey>> = {
  research: "executive_advisor",
  build_list: "executive_advisor",
  draft_message: "investor_relations",
  send_intro_request: "rainmaker",
  send_outreach: "rainmaker",
  share_materials: "investor_relations",
};

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

// --- 1. GENERATE ------------------------------------------------------------
export interface SourceTargetsResult {
  ok: boolean;
  candidates?: SourceCandidate[];
  error?: string;
}

export async function sourceTargets(hub: string, module: string): Promise<SourceTargetsResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const key = `${hub}/${module}`;
  const cfg = sourceConfigFor(key);
  if (!cfg) return { ok: false, error: "AI sourcing is not available for this module." };

  const supabase = createServerClient();
  const { data } = await supabase
    .from(cfg.table as "investors")
    .select("name")
    .eq("organization_id", auth.ctx.orgId)
    .is("archived_at", null)
    .limit(60);
  const existing = ((data ?? []) as { name: string }[]).map((r) => r.name).filter(Boolean);
  const mandate = await loadMandate(auth.ctx.orgId);
  const candidates = await generateTargets(key, mandate, existing);
  return { ok: true, candidates };
}

// --- 2. ACCEPT → INSERT -----------------------------------------------------
export interface AddSourcedResult {
  ok: boolean;
  added?: number;
  error?: string;
}

export async function addSourcedTargets(
  hub: string,
  module: string,
  candidates: { name: string; category: string; rationale: string; sourceUrl?: string }[],
): Promise<AddSourcedResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const key = `${hub}/${module}`;
  if (!sourceConfigFor(key)) return { ok: false, error: "Unknown module." };

  const orgId = auth.ctx.orgId;
  const supabase = createServerClient();
  const clean = candidates
    .map((c) => ({
      name: String(c.name ?? "").trim(),
      category: String(c.category ?? "").trim(),
      rationale: String(c.rationale ?? "").trim(),
      // A web-sourced citation becomes the verification evidence, pre-filled so
      // the operator can confirm the (still unverified) record in one click.
      verification_note:
        typeof c.sourceUrl === "string" && /^https?:\/\/\S+$/i.test(c.sourceUrl.trim())
          ? c.sourceUrl.trim().slice(0, 500)
          : null,
    }))
    .filter((c) => c.name);
  if (clean.length === 0) return { ok: false, error: "Nothing to add." };

  // AI-sourced rows carry their fit rationale into `notes` so the operator keeps
  // the "why" when triaging the pipeline.
  const note = (r: string) => (r ? `AI-sourced — ${r}` : "AI-sourced.");

  let added = 0;
  switch (key) {
    case "source/lp_pipeline": {
      const valid = new Set<InvestorType>(["lp", "family_office", "institution", "fund_of_funds", "lender", "bank", "co_gp", "other"]);
      const rows = clean.map((c) => ({
        organization_id: orgId,
        provenance: "ai",
        name: c.name,
        investor_type: (valid.has(c.category as InvestorType) ? c.category : "other") as InvestorType,
        pipeline_stage: "prospect",
        notes: note(c.rationale),
        verification_note: c.verification_note,
      }));
      const { data: ins, error } = await supabase.from("investors").insert(rows).select("id");
      if (error) return { ok: false, error: error.message };
      added = ins?.length ?? rows.length;
      break;
    }
    case "source/deal_pipeline": {
      const rows = clean.map((c) => ({
        organization_id: orgId,
        provenance: "ai",
        name: c.name,
        stage: "sourced" as const,
        asset_class: c.category || null,
        notes: note(c.rationale),
        verification_note: c.verification_note,
      }));
      const { data: ins, error } = await supabase.from("deals").insert(rows).select("id");
      if (error) return { ok: false, error: error.message };
      added = ins?.length ?? rows.length;
      break;
    }
    case "source/debt": {
      const rows = clean.map((c) => ({
        organization_id: orgId,
        provenance: "ai",
        name: c.name,
        facility_type: c.category || "term_loan",
        status: "prospective",
        currency: "USD",
        notes: note(c.rationale),
        verification_note: c.verification_note,
      }));
      const { data: ins, error } = await supabase.from("debt_facilities").insert(rows).select("id");
      if (error) return { ok: false, error: error.message };
      added = ins?.length ?? rows.length;
      break;
    }
    case "source/partners": {
      const rows = clean.map((c) => ({
        organization_id: orgId,
        provenance: "ai",
        name: c.name,
        partner_type: c.category || "co_gp",
        status: "prospective",
        notes: note(c.rationale),
        verification_note: c.verification_note,
      }));
      const { data: ins, error } = await supabase.from("partners").insert(rows).select("id");
      if (error) return { ok: false, error: error.message };
      added = ins?.length ?? rows.length;
      break;
    }
    case "source/providers": {
      const rows = clean.map((c) => ({
        organization_id: orgId,
        provenance: "ai",
        name: c.name,
        provider_type: c.category || "legal",
        status: "prospective",
        notes: note(c.rationale),
        verification_note: c.verification_note,
      }));
      const { data: ins, error } = await supabase.from("service_providers").insert(rows).select("id");
      if (error) return { ok: false, error: error.message };
      added = ins?.length ?? rows.length;
      break;
    }
    default:
      return { ok: false, error: "Unknown module." };
  }

  revalidatePath(`/${hub}/${module}`);
  return { ok: true, added };
}

// --- 3. SCORE ---------------------------------------------------------------
export interface ScorePipelineResult {
  ok: boolean;
  scores?: PipelineScore[];
  error?: string;
}

export async function scorePipeline(hub: string, module: string): Promise<ScorePipelineResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const key = `${hub}/${module}`;
  const cfg = sourceConfigFor(key);
  if (!cfg) return { ok: false, error: "AI sourcing is not available for this module." };

  const supabase = createServerClient();
  const { data } = await supabase
    .from(cfg.table as "investors")
    .select("*")
    .eq("organization_id", auth.ctx.orgId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? "Unnamed"),
    fields: r,
  }));
  if (rows.length === 0) return { ok: true, scores: [] };

  const mandate = await loadMandate(auth.ctx.orgId);
  const scores = await scorePipelineEngine(key, mandate, rows);
  return { ok: true, scores };
}

// --- 4. ACT (gated) ---------------------------------------------------------
// Generalized sibling of capital-map's queueNextAction: route a sourcing move
// for any Source entity through the gate. Tier 1 dispatches now; Tier 2/3 open
// an approval. Capital-binding actions are never reachable here (the engine only
// emits internal/outreach actions), but the gate enforces it regardless.
export interface QueueSourceResult {
  ok: boolean;
  gated?: boolean;
  tier?: 1 | 2 | 3;
  message?: string;
  error?: string;
}

export async function queueSourceAction(args: {
  hub: string;
  module: string;
  name: string;
  email?: string;
  action: ActionKind;
  label: string;
}): Promise<QueueSourceResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const agent = AGENT_FOR_ACTION[args.action] ?? "executive_advisor";

  const supabase = createServerClient();
  const orgId = auth.ctx.orgId;
  const mandate = await getActiveMandate(supabase, orgId);
  const decision = gateDecision(args.action, mandate);

  const title = `${args.label} — ${args.name}`;
  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: orgId,
      title,
      description: `AI sourcing action for ${args.name}.`,
      hub: "source",
      assigned_agent: agent,
      status: decision.requiresApproval ? "awaiting_approval" : "pending",
      progress: 0,
      graph_touched: "relationship",
      requires_approval: decision.requiresApproval,
      created_by: auth.ctx.userId,
      step_order: 0,
    })
    .select("id")
    .single();
  if (error || !task) return { ok: false, error: error?.message ?? "Could not queue action." };

  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: task.id,
    event_type: "task.created",
    agent,
    hub: "source",
    payload: { title, gate_tier: decision.tier } as Json,
  });

  if (decision.requiresApproval) {
    const { data: approval } = await supabase
      .from("approvals")
      .insert({
        organization_id: orgId,
        task_id: task.id,
        requested_by_agent: agent,
        summary: `Tier ${decision.tier} — ${title}`,
      })
      .select("id")
      .single();
    await supabase.from("task_events").insert({
      organization_id: orgId,
      task_id: task.id,
      event_type: "approval.requested",
      agent,
      hub: "source",
      payload: { approval_id: approval?.id, gate_tier: decision.tier, summary: title } as Json,
    });
    revalidatePath(`/${args.hub}/${args.module}`);
    revalidatePath("/dashboard");
    return { ok: true, gated: true, tier: decision.tier, message: `Tier ${decision.tier} — sent to your approvals.` };
  }

  const result = await dispatchAction({
    orgId,
    actorId: auth.ctx.userId,
    action: args.action,
    target: { name: args.name, email: args.email },
  });
  await recordDispatch(supabase, { orgId, actorId: auth.ctx.userId, taskId: task.id, action: args.action, result });
  await supabase
    .from("tasks")
    .update({
      status: result.ok ? "completed" : "failed",
      progress: 1,
      completed_at: new Date().toISOString(),
      result: { dispatch: result } as unknown as Json,
    })
    .eq("id", task.id);
  await supabase.from("task_events").insert({
    organization_id: orgId,
    task_id: task.id,
    event_type: "task.completed",
    agent,
    hub: "source",
    payload: { ok: result.ok, channel: result.channel, live: result.live, detail: result.detail } as Json,
  });

  revalidatePath(`/${args.hub}/${args.module}`);
  revalidatePath("/dashboard");
  return { ok: result.ok, gated: false, tier: decision.tier, message: result.detail, error: result.ok ? undefined : result.error };
}
