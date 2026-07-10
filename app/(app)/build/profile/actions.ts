"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { IDENTITY_WRITABLE_FIELDS } from "@/lib/firm-identity";

export type ProfileSaveState = { error?: string; ok?: true };

// Inline answer for the Firm Identity guided interview: writes a single
// whitelisted `organizations` column. Unlike saveOrgProfile (which rewrites the
// whole row), this touches only the one field the operator just answered, so a
// partial answer never clears the rest of the profile. Empty input clears that
// one field.
export async function answerIdentityQuestion(
  field: string,
  value: string,
): Promise<ProfileSaveState> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  if (!IDENTITY_WRITABLE_FIELDS.has(field)) return { error: "Unknown field" };

  const trimmed = value.trim();
  const update: Record<string, unknown> = {
    [field]: trimmed || null,
    updated_at: new Date().toISOString(),
  };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("organizations")
    .update(update as never)
    .eq("id", ctx.orgId);

  if (error) return { error: error.message };

  revalidatePath("/build/profile");
  revalidatePath("/settings");
  return { ok: true };
}

// Persist edits to the organization profile. All fields are optional — an
// empty string is coerced to null so the DB never stores stale placeholder
// text. fund_count is parsed as an integer; non-numeric input becomes null.
//
// Signature is (prevState, formData) so the form can drive it through
// useActionState and surface success/error inline.
export async function saveOrgProfile(
  _prevState: ProfileSaveState,
  formData: FormData,
): Promise<ProfileSaveState> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const str = (key: string) =>
    (String(formData.get(key) ?? "").trim() || null);

  const fundCountRaw = String(formData.get("fund_count") ?? "").trim();
  const fund_count = fundCountRaw ? parseInt(fundCountRaw, 10) || null : null;

  const update = {
    name: str("name"),
    legal_name: str("legal_name"),
    entity_type: str("entity_type"),
    tagline: str("tagline"),
    logo_url: str("logo_url"),
    primary_strategy: str("primary_strategy"),
    operator_role: str("operator_role"),
    aum_range: str("aum_range"),
    fund_count,
    hq_location: str("hq_location"),
    jurisdiction: str("jurisdiction"),
    website: str("website"),
    description: str("description"),
    brand_voice: str("brand_voice"),
    updated_at: new Date().toISOString(),
  };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("organizations")
    .update(update as never)
    .eq("id", ctx.orgId);

  if (error) return { error: error.message };

  revalidatePath("/build/profile");
  revalidatePath("/settings");
  revalidatePath("/build/brand");
  return { ok: true };
}
