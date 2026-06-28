import type { SupabaseClient } from "@supabase/supabase-js";

export interface LPRelationshipSummary {
  investorId: string;
  lastContactAt: string | null;
  lastContactDays: number | null;
  topActionTitle: string | null;
  topActionType: string | null;
  topActionDueAt: string | null;
}

export async function getLPRelationshipSummaries(
  supabase: SupabaseClient,
  orgId: string,
  investorIds: string[],
): Promise<Map<string, LPRelationshipSummary>> {
  if (investorIds.length === 0) return new Map();

  const [scoresResult, actionsResult] = await Promise.all([
    supabase
      .from("relationship_scores")
      .select("investor_id, last_contact_at, days_since_contact")
      .eq("organization_id", orgId)
      .in("investor_id", investorIds),
    supabase
      .from("next_best_actions")
      .select("investor_id, title, action_type, due_at, priority")
      .eq("organization_id", orgId)
      .in("investor_id", investorIds)
      .is("completed_at", null)
      .is("dismissed_at", null)
      .order("priority", { ascending: false }),
  ]);

  // Index top action per investor (results are priority-descending, so first wins)
  const topActions = new Map<string, { title: string; action_type: string; due_at: string | null }>();
  for (const row of actionsResult.data ?? []) {
    if (!topActions.has(row.investor_id)) {
      topActions.set(row.investor_id, {
        title: row.title,
        action_type: row.action_type,
        due_at: row.due_at,
      });
    }
  }

  const map = new Map<string, LPRelationshipSummary>();
  for (const row of scoresResult.data ?? []) {
    const action = topActions.get(row.investor_id) ?? null;
    map.set(row.investor_id, {
      investorId: row.investor_id,
      lastContactAt: row.last_contact_at,
      lastContactDays: row.days_since_contact,
      topActionTitle: action?.title ?? null,
      topActionType: action?.action_type ?? null,
      topActionDueAt: action?.due_at ?? null,
    });
  }

  // Fill in investors with no score row but who have actions
  for (const investorId of investorIds) {
    if (!map.has(investorId)) {
      const action = topActions.get(investorId) ?? null;
      if (action) {
        map.set(investorId, {
          investorId,
          lastContactAt: null,
          lastContactDays: null,
          topActionTitle: action.title,
          topActionType: action.action_type,
          topActionDueAt: action.due_at,
        });
      }
    }
  }

  return map;
}

export async function logLPContact(
  supabase: SupabaseClient,
  orgId: string,
  investorId: string,
): Promise<void> {
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("relationship_scores")
    .select("id, interaction_count")
    .eq("organization_id", orgId)
    .eq("investor_id", investorId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("relationship_scores")
      .update({
        last_contact_at: now,
        days_since_contact: 0,
        interaction_count: (existing.interaction_count ?? 0) + 1,
        updated_at: now,
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("relationship_scores").insert({
      organization_id: orgId,
      investor_id: investorId,
      last_contact_at: now,
      days_since_contact: 0,
      interaction_count: 1,
      score: 0,
      temperature: "warm",
      score_breakdown: {},
    });
  }
}
