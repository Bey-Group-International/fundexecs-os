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

function text(formData: FormData, name: string): string | null {
  const v = String(formData.get(name) ?? "").trim();
  return v === "" ? null : v;
}

function num(formData: FormData, name: string): number | null {
  const v = String(formData.get(name) ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Insert a row into a table-backed module. Uses a per-module allow-list and a
// switch on the literal key so each `.from(...)` stays typed against the table.
export async function createModuleRow(hub: string, module: string, formData: FormData) {
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
    case "source/partners": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("partners").insert({
        organization_id: orgId,
        name,
        partner_type: text(formData, "partner_type") ?? "co_gp",
        relationship: text(formData, "relationship"),
        contact_name: text(formData, "contact_name"),
        contact_email: text(formData, "contact_email"),
        status: text(formData, "status") ?? "active",
      });
      break;
    }
    case "source/providers": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("service_providers").insert({
        organization_id: orgId,
        name,
        provider_type: text(formData, "provider_type") ?? "legal",
        contact_name: text(formData, "contact_name"),
        contact_email: text(formData, "contact_email"),
        status: text(formData, "status") ?? "active",
      });
      break;
    }
    case "source/debt": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("debt_facilities").insert({
        organization_id: orgId,
        name,
        facility_type: text(formData, "facility_type") ?? "term_loan",
        lender: text(formData, "lender"),
        commitment_amount: num(formData, "commitment_amount"),
        interest_rate: num(formData, "interest_rate"),
        currency: text(formData, "currency") ?? "USD",
        status: text(formData, "status") ?? "prospective",
      });
      break;
    }
    default:
      return;
  }

  revalidatePath(`/${hub}/${module}`);
}
