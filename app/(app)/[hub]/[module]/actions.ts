"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { ADD_ROW_CONFIGS } from "@/lib/module-forms";

// Update the active organization's Build › Profile fields. RLS restricts this
// to org admins/owners.
export async function updateProfile(formData: FormData) {
  const auth = await requireOrgContext();
  if (!auth.ok) return;

  const supabase = createServerClient();
  await supabase
    .from("organizations")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      legal_name: String(formData.get("legal_name") ?? "") || null,
      entity_type: String(formData.get("entity_type") ?? "") || null,
      jurisdiction: String(formData.get("jurisdiction") ?? "") || null,
      website: String(formData.get("website") ?? "") || null,
      description: String(formData.get("description") ?? "") || null,
    })
    .eq("id", auth.ctx.orgId);

  revalidatePath("/build/profile");
}

// --- Add-row support -------------------------------------------------------
// Field configs live in lib/module-forms.ts so the AddRowForm client component
// and this server action agree on exactly which columns are written.

// Read a text field: trimmed string, or null when empty.
function text(formData: FormData, name: string): string | null {
  const v = String(formData.get(name) ?? "").trim();
  return v === "" ? null : v;
}

// Read a numeric field: parsed number, or null when empty/invalid.
function num(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Insert a row into a table-backed module. Uses a per-module allow-list and a
// switch on the literal key so each `.from(...)` is typed against the table.
export async function createModuleRow(
  hub: string,
  module: string,
  formData: FormData,
) {
  const auth = await requireOrgContext();
  if (!auth.ok) return;

  const key = `${hub}/${module}`;
  if (!(key in ADD_ROW_CONFIGS)) return;

  const orgId = auth.ctx.orgId;
  const supabase = createServerClient();

  switch (key) {
    case "source/lp_pipeline": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("investors").insert({
        organization_id: orgId,
        name,
        investor_type:
          (text(formData, "investor_type") as
            | "lp"
            | "family_office"
            | "institution"
            | "fund_of_funds"
            | "lender"
            | "bank"
            | "co_gp"
            | "other"
            | null) ?? "lp",
        pipeline_stage: text(formData, "pipeline_stage") ?? "prospect",
      });
      break;
    }
    case "source/deal_pipeline": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("deals").insert({
        organization_id: orgId,
        name,
        stage:
          (text(formData, "stage") as
            | "sourced"
            | "screening"
            | "diligence"
            | "underwriting"
            | "ic_review"
            | "closing"
            | "owned"
            | "exited"
            | "passed"
            | "dead"
            | null) ?? "sourced",
        asset_class: text(formData, "asset_class"),
      });
      break;
    }
    case "build/thesis": {
      const title = text(formData, "title");
      if (!title) return;
      await supabase.from("investment_theses").insert({
        organization_id: orgId,
        title,
        summary: text(formData, "summary"),
        is_active: formData.get("is_active") != null,
      });
      break;
    }
    case "build/track_record": {
      const dealName = text(formData, "deal_name");
      if (!dealName) return;
      await supabase.from("track_records").insert({
        organization_id: orgId,
        deal_name: dealName,
        vintage_year: num(formData, "vintage_year"),
        gross_irr: num(formData, "gross_irr"),
        gross_moic: num(formData, "gross_moic"),
      });
      break;
    }
    case "execute/asset_management": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("assets").insert({
        organization_id: orgId,
        name,
        asset_type:
          (text(formData, "asset_type") as
            | "real_estate"
            | "operating_company"
            | "portfolio_company"
            | "fund_interest"
            | "other"
            | null) ?? "real_estate",
      });
      break;
    }
    default:
      return;
  }

  revalidatePath(`/${hub}/${module}`);
}
