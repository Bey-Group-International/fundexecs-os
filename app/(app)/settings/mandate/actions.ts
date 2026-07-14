"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import {
  sanitizeMandateActions,
  sanitizeGuardrails,
  parseBlastRadiusForm,
} from "@/lib/mandate-options";
import { blastRadiusToRules } from "@/lib/mandates";

// The standing mandate's display name when this editor creates one. The editor
// tunes a single, always-present delegation rather than naming bespoke mandates.
const STANDING_MANDATE_NAME = "Standing mandate";

/**
 * Persist the operator's standing mandate from the editor form.
 *
 * - Requires org-writer context (RLS also enforces `is_org_writer`; we check
 *   here so an unauthenticated submit fails fast and quietly).
 * - Reads the toggled action kinds and sanitizes them down to valid Tier-2
 *   kinds via `sanitizeMandateActions` — anything Tier-1, Tier-3, or unknown is
 *   dropped, so the stored mandate can never claim to authorize work the gate
 *   would refuse to delegate.
 * - Reads the autonomy ceiling and clamps it to 1 or 2 (Tier 3 is never
 *   delegable; the DB also caps it).
 * - Upserts the org's active mandate: updates the most-recent active row if one
 *   exists, otherwise inserts a fresh active row.
 */
export async function saveMandate(formData: FormData): Promise<void> {
  const auth = await requireOrgContext();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const autoApprove = sanitizeMandateActions(
    formData.getAll("auto_approve").map((v) => String(v)),
  );

  // Clamp the ceiling to a delegable tier (1 = draft only, 2 = act within
  // mandate). Default to 1 on a missing/garbage value — the conservative choice.
  const rawCeiling = Number(formData.get("autonomy_ceiling"));
  const autonomyCeiling = Number.isFinite(rawCeiling)
    ? Math.min(2, Math.max(1, Math.trunc(rawCeiling)))
    : 1;

  // Scope, guardrails, and blast-radius limits round out the standing mandate.
  // Guardrails and forbidden domains are free text; sanitize/cap them before
  // persisting. Blast radius is stored as the normalized `{type,value}[]` jsonb.
  const scope = String(formData.get("scope") ?? "").trim() || null;
  const guardrails = sanitizeGuardrails(String(formData.get("guardrails") ?? ""));
  const blastRadiusRules = blastRadiusToRules(
    parseBlastRadiusForm({
      maxOutreachPerDay: formData.get("max_outreach_per_day"),
      maxDollarPerAction: formData.get("max_dollar_per_action"),
      forbiddenDomains: String(formData.get("forbidden_domains") ?? ""),
    }),
  );

  const supabase = await createServerClient();

  // Find the org's most-recent active mandate to update in place.
  const { data: existing } = await supabase
    .from("mandates")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("mandates")
      .update({
        auto_approve: autoApprove,
        autonomy_ceiling: autonomyCeiling,
        scope,
        guardrails,
        blast_radius_rules: blastRadiusRules,
        is_active: true,
      })
      .eq("id", existing.id)
      .eq("organization_id", orgId);
  } else {
    await supabase.from("mandates").insert({
      organization_id: orgId,
      name: STANDING_MANDATE_NAME,
      auto_approve: autoApprove,
      autonomy_ceiling: autonomyCeiling,
      scope,
      guardrails,
      blast_radius_rules: blastRadiusRules,
      is_active: true,
      created_by: userId,
    });
  }

  revalidatePath("/settings/mandate");
}
