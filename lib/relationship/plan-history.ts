// lib/relationship/plan-history.ts
// Persist and list prospecting plans so past sourcing runs can be revisited and
// compared. savePlan records a compact row + the full plan JSON; listPlanHistory
// returns the recent runs (summary only); getPlan re-hydrates a stored plan.
// RLS-scoped via the request server client; never throws on save (history is an
// enhancement, not a blocker for generating a plan).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ProspectingPlan } from "@/lib/relationship/prospecting-copilot";

export interface PlanHistoryEntry {
  id: string;
  goalText: string;
  persona: string | null;
  routedAgent: string | null;
  sequenceKey: string | null;
  prospectCount: number;
  readyCount: number;
  heldCount: number;
  createdAt: string;
}

function loose(db: SupabaseClient<Database>): SupabaseClient {
  return db as unknown as SupabaseClient;
}

// Row-shape summary derived from a plan — pure, so the counts logic is testable.
export function planSummaryRow(plan: ProspectingPlan, goalText: string) {
  return {
    goal_text: goalText.trim().slice(0, 500),
    goal_key: plan.goal?.goal ?? null,
    persona: plan.persona ?? null,
    routed_agent: plan.routedAgent ?? null,
    sequence_key: plan.sequenceKey ?? null,
    prospect_count: plan.prospects?.length ?? 0,
    ready_count: plan.readyForOutreach?.length ?? 0,
    held_count: plan.heldForReview?.length ?? 0,
  };
}

// Save a generated plan. Best-effort: returns the new id or null on failure.
export async function savePlan(
  db: SupabaseClient<Database>,
  orgId: string,
  userId: string,
  plan: ProspectingPlan,
  goalText: string,
): Promise<string | null> {
  try {
    const { data } = await loose(db)
      .from("prospecting_plans")
      .insert({
        organization_id: orgId,
        created_by: userId,
        ...planSummaryRow(plan, goalText),
        plan: plan as unknown,
      })
      .select("id")
      .single();
    return (data as { id: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

// Recent plan-history entries (summary only), newest first.
export async function listPlanHistory(
  db: SupabaseClient<Database>,
  orgId: string,
  limit = 20,
): Promise<PlanHistoryEntry[]> {
  try {
    const { data } = await loose(db)
      .from("prospecting_plans")
      .select("id, goal_text, persona, routed_agent, sequence_key, prospect_count, ready_count, held_count, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      goalText: String(r.goal_text ?? ""),
      persona: (r.persona as string | null) ?? null,
      routedAgent: (r.routed_agent as string | null) ?? null,
      sequenceKey: (r.sequence_key as string | null) ?? null,
      prospectCount: Number(r.prospect_count ?? 0),
      readyCount: Number(r.ready_count ?? 0),
      heldCount: Number(r.held_count ?? 0),
      createdAt: String(r.created_at ?? ""),
    }));
  } catch {
    return [];
  }
}

// Re-hydrate a single stored plan by id (RLS-scoped). Null if absent.
export async function getPlan(
  db: SupabaseClient<Database>,
  orgId: string,
  id: string,
): Promise<ProspectingPlan | null> {
  try {
    const { data } = await loose(db)
      .from("prospecting_plans")
      .select("plan")
      .eq("organization_id", orgId)
      .eq("id", id)
      .maybeSingle();
    const plan = (data as { plan?: unknown } | null)?.plan;
    return plan ? (plan as ProspectingPlan) : null;
  } catch {
    return null;
  }
}
