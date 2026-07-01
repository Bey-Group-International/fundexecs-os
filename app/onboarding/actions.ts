"use server";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { sanitizeMandateActions } from "@/lib/mandate-options";
import { matchNewOrgAndNotify } from "@/lib/ecosystem-match.server";
import { claimReferralCode } from "@/lib/gift-earn";

// Updates the authenticated principal's personal profile fields collected in the
// first onboarding step. Returns a result object so the wizard can stay on the
// client and show inline errors.
export async function updateUserProfile(
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Not authenticated" };

  const supabase = createServerClient();
  const full_name = String(formData.get("full_name") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const avatar_url = String(formData.get("avatar_url") ?? "").trim() || null;

  const { error } = await supabase
    .from("principals")
    .update({ full_name, title, phone, avatar_url, updated_at: new Date().toISOString() })
    .eq("id", ctx.userId);

  if (error) return { error: error.message };
  return {};
}

// The standing mandate's display name, matching the settings editor so onboarding
// and the editor tune the same single, always-present delegation.
const STANDING_MANDATE_NAME = "Standing mandate";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "org"
  );
}

// Creates the organization and its firm profile. The DB trigger
// handle_new_organization adds the creating principal as owner, so the new org
// is immediately accessible. Returns a result instead of redirecting — the
// client wizard navigates on success, so a redirect can't be swallowed by its
// try/catch.
export async function createOrganization(
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Not authenticated" };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Organization name is required" };

  const supabase = createServerClient();
  const orgId = randomUUID();
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;

  const { error } = await supabase
    .from("organizations")
    .insert({
      id: orgId,
      name,
      slug,
      entity_type: String(formData.get("entity_type") ?? "") || null,
      hq_location: String(formData.get("hq_location") ?? "") || null,
      operator_role: String(formData.get("role") ?? "") || null,
      aum_range: String(formData.get("aum_range") ?? "") || null,
      fund_count: Number(formData.get("fund_count")) || null,
      primary_strategy: String(formData.get("strategy") ?? "") || null,
      first_hub: String(formData.get("first_hub") ?? "") || null,
      created_by: ctx.userId,
    });

  if (error) return { error: error.message };

  // Persist the operator's standing mandate chosen on the optional final step.
  // The org is brand-new, so there's never a prior active row to update — we
  // insert one. We mirror the settings editor's invariants: auto_approve is
  // sanitized down to valid Tier-2 kinds, and the ceiling is clamped to 1–2
  // (Tier 3 is never delegable). A non-blocking failure here must not strand the
  // operator outside their freshly created org, so we ignore the mandate error.
  const autoApprove = sanitizeMandateActions(
    formData.getAll("auto_approve").map((v) => String(v)),
  );
  const rawCeiling = Number(formData.get("autonomy_ceiling"));
  const autonomyCeiling = Number.isFinite(rawCeiling)
    ? Math.min(2, Math.max(1, Math.trunc(rawCeiling)))
    : 1;

  await supabase.from("mandates").insert({
    organization_id: orgId,
    name: STANDING_MANDATE_NAME,
    auto_approve: autoApprove,
    autonomy_ceiling: autonomyCeiling,
    is_active: true,
    created_by: ctx.userId,
  });

  // The profile is live — let Earn match it across the ecosystem and fan out
  // professional alerts to matching orgs (and a reciprocal digest back). This
  // is a delight, not a gate: a never-block call so a matchmaking hiccup can
  // never strand the operator outside the org they just created.
  try {
    await matchNewOrgAndNotify(orgId);
  } catch {
    // ignore — onboarding succeeds regardless of matchmaking
  }

  // Auto-claim any referral code that was stored when the user landed via a
  // /join?ref=CODE link. Best-effort: a bad code or a DB hiccup must never
  // block the newly created org from entering the app.
  try {
    const jar = await cookies();
    const refCode = jar.get("referral_code")?.value ?? "";
    if (refCode) {
      await claimReferralCode(refCode, orgId);
      jar.delete("referral_code");
    }
  } catch {
    // ignore
  }

  return {};
}
