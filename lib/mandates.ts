// lib/mandates.ts
// The bridge between the persisted `mandates` table (migration 0029) and the
// pure gate layer (lib/gates.ts). The DB stores the operator's standing
// delegation as a row; the gate consumes the lightweight `Mandate` shape
// (`{ autoApprove, autonomyCeiling }`). This module reads the active row and
// translates it into that shape.
//
// Tenancy is enforced by RLS, so we never filter by organization_id here — the
// RLS-scoped client only ever sees the caller's org (same convention as
// lib/capital-map.ts / lib/graph.ts). The `orgId` argument is accepted for
// call-site clarity and forward use but is intentionally not used to filter.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MandateRow } from "@/lib/supabase/database.types";
import type { ActionKind, GateTier, Mandate } from "@/lib/gates";

type Client = SupabaseClient<Database>;

/**
 * Resolve the org's active mandate as the gate-layer `Mandate`, or `undefined`
 * when none is active. The most recently updated active row wins. The autonomy
 * ceiling is clamped to a valid GateTier (the DB caps it at 2 — Tier 3 is never
 * delegable — but clamp defensively in case the row predates that constraint).
 */
export async function getActiveMandate(
  supabase: Client,
  orgId?: string,
): Promise<Mandate | undefined> {
  // RLS scopes the client to the caller's org, so we never filter by orgId;
  // it is accepted for call-site clarity and forward use.
  void orgId;

  const { data } = await supabase
    .from("mandates")
    .select("auto_approve, autonomy_ceiling, scope, guardrails, blast_radius_rules")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return undefined;

  const autonomyCeiling = Math.min(2, Math.max(1, data.autonomy_ceiling)) as GateTier;
  return {
    autoApprove: (data.auto_approve ?? []) as ActionKind[],
    autonomyCeiling,
  };
}

/**
 * Return the full active mandate row (including scope, guardrails, and
 * blast_radius_rules) for UI display or Earn context injection.
 * Returns undefined when no active mandate exists.
 */
export async function getActiveMandateRow(
  supabase: Client,
  orgId?: string,
): Promise<Pick<MandateRow, "auto_approve" | "autonomy_ceiling" | "scope" | "guardrails" | "blast_radius_rules"> | undefined> {
  void orgId;
  const { data } = await supabase
    .from("mandates")
    .select("auto_approve, autonomy_ceiling, scope, guardrails, blast_radius_rules")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? undefined;
}
